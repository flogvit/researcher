import { getDb } from '../../db/connection.js';
import { findings, discoveries, researchLog } from '../../db/schema.js';
import { eq, desc, sql, and } from 'drizzle-orm';
import { LLM } from '../../llm/llm.js';
import { loadPrompt } from '../../core/prompt-loader.js';
import { Logger } from '../../core/logger.js';

interface NoveltyResult {
  isNovel: boolean;
  title: string;
  noveltyLevel: string;
  reasoning: string;
  searchQueries: string[];
}

interface LitSearchResult {
  existingResearch: Array<{ title: string; author: string; summary: string; url: string; relevance: string }>;
  conclusion: string;
  summary: string;
}

export class NoveltyChecker {
  private llm: LLM;
  private projectDir: string;
  private log = new Logger('novelty');

  constructor(llm: LLM, projectDir: string) {
    this.llm = llm;
    this.projectDir = projectDir;
  }

  /**
   * Scan recent findings for potential discoveries
   */
  async scanForDiscoveries(): Promise<void> {
    const db = getDb();

    // Find strong findings that haven't been evaluated yet
    const strongFindings = await db
      .select()
      .from(findings)
      .where(
        and(
          sql`${findings.evidenceStrength} IN ('strong_evidence', 'proven')`,
          sql`${findings.id} NOT IN (SELECT finding_id FROM discoveries)`,
        ),
      )
      .orderBy(desc(findings.createdAt))
      .limit(5);

    for (const finding of strongFindings) {
      await this.evaluateFinding(finding);
    }
  }

  /**
   * Evaluate a single finding for novelty
   */
  private async evaluateFinding(finding: typeof findings.$inferSelect): Promise<void> {
    const db = getDb();
    this.log.info(`Evaluating finding ${finding.id} for novelty...`);

    const noveltyTemplate = await loadPrompt(this.projectDir, 'novelty-check');
    const noveltyPrompt = LLM.formatPrompt(noveltyTemplate, {
      finding: finding.finding,
      evidenceStrength: finding.evidenceStrength,
      reasoning: finding.reasoning,
    });

    let novelty: NoveltyResult;
    try {
      const response = await this.llm.callJSON<NoveltyResult>(noveltyPrompt);
      novelty = response.data;
    } catch (e) {
      this.log.error(`Novelty check failed: ${e instanceof Error ? e.message : e}`);
      return;
    }

    if (!novelty.isNovel) {
      await db.insert(researchLog).values({
        eventType: 'novelty_rejected',
        details: { findingId: finding.id, title: novelty.title, reason: novelty.reasoning },
      });
      // Still create a discovery record so we don't re-check
      await db.insert(discoveries).values({
        findingId: finding.id,
        title: novelty.title,
        claim: finding.finding,
        evidenceStrength: finding.evidenceStrength,
        status: 'not_novel',
        noveltyAssessment: novelty.reasoning,
      });
      return;
    }

    // Create discovery with pending status
    const [discovery] = await db.insert(discoveries).values({
      findingId: finding.id,
      title: novelty.title,
      claim: finding.finding,
      evidenceStrength: finding.evidenceStrength,
      status: 'pending_verification',
      noveltyAssessment: novelty.reasoning,
    }).returning();

    await db.insert(researchLog).values({
      eventType: 'discovery_identified',
      details: {
        discoveryId: discovery.id,
        findingId: finding.id,
        title: novelty.title,
        noveltyLevel: novelty.noveltyLevel,
      },
    });

    this.log.info(`Discovery identified: "${novelty.title}" (${novelty.noveltyLevel})`);
  }

  /**
   * Run literature search on discoveries that are pending verification
   */
  async searchLiteratureForPending(): Promise<void> {
    const db = getDb();

    const pendingDiscoveries = await db
      .select()
      .from(discoveries)
      .where(eq(discoveries.status, 'pending_verification'))
      .limit(3);

    for (const discovery of pendingDiscoveries) {
      await this.searchLiterature(discovery);
    }
  }

  /**
   * Search existing literature for a discovery
   */
  private async searchLiterature(discovery: typeof discoveries.$inferSelect): Promise<void> {
    const db = getDb();
    this.log.info(`Searching literature for: "${discovery.title}"...`);

    const template = await loadPrompt(this.projectDir, 'literature-search');
    const prompt = LLM.formatPrompt(template, {
      title: discovery.title,
      claim: discovery.claim,
    });

    try {
      const response = await this.llm.callJSON<LitSearchResult>(prompt);

      await db.update(discoveries)
        .set({
          literatureSearch: response.data,
          status: response.data.conclusion === 'already_published' ? 'already_published' : 'pending_domain_review',
          updatedAt: new Date(),
        })
        .where(eq(discoveries.id, discovery.id));

      await db.insert(researchLog).values({
        eventType: 'literature_search_complete',
        details: {
          discoveryId: discovery.id,
          title: discovery.title,
          conclusion: response.data.conclusion,
          sourcesFound: response.data.existingResearch.length,
        },
      });
    } catch (e) {
      this.log.error(`Literature search failed: ${e instanceof Error ? e.message : e}`);
      // Move forward even if search fails
      await db.update(discoveries)
        .set({ status: 'pending_domain_review', updatedAt: new Date() })
        .where(eq(discoveries.id, discovery.id));
    }
  }
}
