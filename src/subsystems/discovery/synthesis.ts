import { getDb } from '../../db/connection.js';
import { findings, discoveries, researchLog } from '../../db/schema.js';
import { desc, sql } from 'drizzle-orm';
import { LLM } from '../../llm/llm.js';
import { SYNTHESIS_CLUSTER } from '../../prompts/discovery.js';
import { Logger } from '../../core/logger.js';

interface Cluster {
  title: string;
  thesis: string;
  findingIds: number[];
  maturity: 'emerging' | 'developing' | 'mature';
  reasoning: string;
  gaps: string[];
}

interface SynthesisResult {
  clusters: Cluster[];
  suggestedTasks: Array<{ agentType: string; description: string; priority: number }>;
}

export class SynthesisAgent {
  private llm: LLM;
  private log = new Logger('synthesis');

  constructor(llm: LLM) {
    this.llm = llm;
  }

  async synthesize(): Promise<SynthesisResult | null> {
    const db = getDb();

    const allFindings = await db
      .select()
      .from(findings)
      .orderBy(desc(findings.createdAt))
      .limit(50);

    if (allFindings.length < 5) return null;

    const findingSummaries = allFindings.map(f =>
      `[Finding #${f.id}] [${f.evidenceStrength}] ${f.agentType}: ${f.finding}`
    ).join('\n\n');

    const prompt = LLM.formatPrompt(SYNTHESIS_CLUSTER, {
      findings: findingSummaries,
    });

    try {
      const response = await this.llm.callJSON<SynthesisResult>(prompt);

      // Log clusters found
      for (const cluster of response.data.clusters) {
        await db.insert(researchLog).values({
          eventType: cluster.maturity === 'mature' ? 'cluster_mature' : 'cluster_found',
          agentType: 'synthesis',
          details: {
            title: cluster.title,
            thesis: cluster.thesis,
            findingIds: cluster.findingIds,
            maturity: cluster.maturity,
            gaps: cluster.gaps,
          },
        });
      }

      // Mature clusters -> create discovery for paper writing
      for (const cluster of response.data.clusters.filter(c => c.maturity === 'mature')) {
        // Check if we already have a discovery with similar title
        const existing = await db.select().from(discoveries)
          .where(sql`${discoveries.title} ILIKE ${'%' + cluster.title.slice(0, 30) + '%'}`)
          .limit(1);

        if (existing.length === 0) {
          await db.insert(discoveries).values({
            findingId: cluster.findingIds[0],
            title: cluster.title,
            claim: cluster.thesis,
            evidenceStrength: 'strong_evidence',
            status: 'pending_verification',
            noveltyAssessment: cluster.reasoning,
          });

          this.log.info(`Mature cluster -> discovery: "${cluster.title}"`);
        }
      }

      await db.insert(researchLog).values({
        eventType: 'synthesis_complete',
        agentType: 'synthesis',
        details: {
          clustersFound: response.data.clusters.length,
          matureClusters: response.data.clusters.filter(c => c.maturity === 'mature').length,
          suggestedTasks: response.data.suggestedTasks.length,
        },
      });

      return response.data;
    } catch (e) {
      this.log.error(`Synthesis failed: ${e instanceof Error ? e.message : e}`);
      return null;
    }
  }
}
