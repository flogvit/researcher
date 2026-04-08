import { getDb } from '../../db/connection.js';
import { discoveries, researchLog } from '../../db/schema.js';
import { eq } from 'drizzle-orm';
import { LLM } from '../../llm/llm.js';
import { Logger } from '../../core/logger.js';
import { loadPrompt } from '../../core/prompt-loader.js';

interface DomainReviewResult {
  alignment: string;
  assessment: string;
  counterarguments: string[];
  methodologicalStrength: string;
  recommendation: string;
}

interface OriginalityResult {
  originalityScore: number;
  similarWorks: Array<{ title: string; author: string; similarity: string; url: string }>;
  genuinelyNew: string[];
  missingReferences: string[];
  plagiarismRisk: string;
  assessment: string;
}

interface RefCheckResult {
  references: Array<{ cited: string; verified: boolean; exists: boolean; correctAttribution: boolean; notes: string }>;
  fabricatedCount: number;
  unverifiableCount: number;
  verdict: string;
  recommendations: string[];
}

interface ReviewResult {
  verdict: string;
  overallQuality: string;
  strengths: string[];
  weaknesses: string[];
  requiredRevisions: string[];
  suggestedImprovements: string[];
}

interface LitSearchResult {
  existingResearch: Array<{ title: string; author: string; summary: string; url: string; relevance: string }>;
  conclusion: string;
  summary: string;
}

export class PaperPipeline {
  private log = new Logger('paper');

  constructor(private llm: LLM, private projectDir: string) {}

  async domainReview(discovery: typeof discoveries.$inferSelect): Promise<void> {
    this.log.info(`Domain review for: "${discovery.title}"...`);

    const db = getDb();
    const litSearch = discovery.literatureSearch as LitSearchResult | null;

    const template = await loadPrompt(this.projectDir, 'domain-review');
    const prompt = LLM.formatPrompt(template, {
      title: discovery.title,
      claim: discovery.claim,
      existingResearch: litSearch
        ? JSON.stringify(litSearch.existingResearch, null, 2)
        : '(no existing research found)',
    });

    try {
      const response = await this.llm.callJSON<DomainReviewResult>(prompt);

      await db.update(discoveries)
        .set({
          domainReview: response.data,
          status: response.data.recommendation === 'reject' ? 'rejected' : 'pending_paper',
          updatedAt: new Date(),
        })
        .where(eq(discoveries.id, discovery.id));

      await db.insert(researchLog).values({
        eventType: 'domain_review_complete',
        agentType: 'paper-pipeline',
        details: {
          discoveryId: discovery.id,
          title: discovery.title,
          alignment: response.data.alignment,
          recommendation: response.data.recommendation,
        },
      });

      this.log.info(`Domain review complete: "${discovery.title}" — ${response.data.recommendation}`);
    } catch (e) {
      this.log.error(`Domain review failed for "${discovery.title}": ${e instanceof Error ? e.message : e}`);
    }
  }

  async writePaper(discovery: typeof discoveries.$inferSelect): Promise<void> {
    this.log.info(`Writing paper for: "${discovery.title}"...`);

    const db = getDb();
    const [current] = await db.select().from(discoveries).where(eq(discoveries.id, discovery.id));

    const writeTemplate = await loadPrompt(this.projectDir, 'write-paper');
    const prompt = LLM.formatPrompt(writeTemplate, {
      title: current.title,
      claim: current.claim,
      literatureSearch: JSON.stringify(current.literatureSearch, null, 2),
      domainReview: JSON.stringify(current.domainReview, null, 2),
    });

    try {
      const response = await this.llm.call(prompt);

      await db.update(discoveries)
        .set({
          paper: response.text,
          paperStatus: 'draft',
          status: 'paper_written',
          updatedAt: new Date(),
        })
        .where(eq(discoveries.id, discovery.id));

      await db.insert(researchLog).values({
        eventType: 'paper_written',
        agentType: 'paper-pipeline',
        details: {
          discoveryId: discovery.id,
          title: current.title,
          paperLength: response.text.length,
        },
      });

      this.log.info(`Paper written for: "${current.title}" (${response.text.length} chars)`);
    } catch (e) {
      this.log.error(`Paper writing failed for "${discovery.title}": ${e instanceof Error ? e.message : e}`);
    }
  }

  async reviewAndRevise(discovery: typeof discoveries.$inferSelect): Promise<void> {
    this.log.info(`Reviewing paper: "${discovery.title}"...`);

    const db = getDb();

    // Step 1: Originality check
    try {
      const origTemplate = await loadPrompt(this.projectDir, 'originality-check');
      const origPrompt = LLM.formatPrompt(origTemplate, {
        title: discovery.title,
        claim: discovery.claim,
        paper: (discovery.paper ?? '').slice(0, 4000),
      });

      const origResponse = await this.llm.callJSON<OriginalityResult>(origPrompt);
      const orig = origResponse.data;

      await db.insert(researchLog).values({
        eventType: 'originality_check',
        agentType: 'paper-pipeline',
        details: {
          discoveryId: discovery.id,
          title: discovery.title,
          originalityScore: orig.originalityScore,
          plagiarismRisk: orig.plagiarismRisk,
          similarWorks: orig.similarWorks.length,
          genuinelyNew: orig.genuinelyNew,
        },
      });

      if (orig.plagiarismRisk === 'high' || orig.originalityScore <= 2) {
        this.log.info(`Paper failed originality check: "${discovery.title}" (score: ${orig.originalityScore}, risk: ${orig.plagiarismRisk})`);
        await db.update(discoveries)
          .set({
            paperStatus: 'failed_originality',
            status: 'not_novel',
            noveltyAssessment: `Originality check: ${orig.assessment}. Similar works: ${orig.similarWorks.map(w => w.title).join(', ')}`,
            updatedAt: new Date(),
          })
          .where(eq(discoveries.id, discovery.id));
        return;
      }
    } catch (e) {
      this.log.error(`Originality check failed (proceeding): ${e instanceof Error ? e.message : e}`);
    }

    // Step 2: Reference verification
    try {
      const refTemplate = await loadPrompt(this.projectDir, 'reference-check');
      const refPrompt = LLM.formatPrompt(refTemplate, {
        paper: discovery.paper ?? '',
      });

      const refResponse = await this.llm.callJSON<RefCheckResult>(refPrompt);
      const refCheck = refResponse.data;

      await db.insert(researchLog).values({
        eventType: 'reference_check',
        agentType: 'paper-pipeline',
        details: {
          discoveryId: discovery.id,
          title: discovery.title,
          totalRefs: refCheck.references.length,
          verified: refCheck.references.filter(r => r.verified).length,
          fabricated: refCheck.fabricatedCount,
          unverifiable: refCheck.unverifiableCount,
          verdict: refCheck.verdict,
        },
      });

      if (refCheck.fabricatedCount > 0) {
        this.log.info(`Found ${refCheck.fabricatedCount} fabricated references in "${discovery.title}" — revising to remove them`);

        const fabricatedRefs = refCheck.references
          .filter(r => !r.exists)
          .map(r => r.cited)
          .join('\n- ');

        const cleanPrompt = `Revise this paper. Remove ALL of the following fabricated/non-existent references. Replace them with references you KNOW exist, or remove the claim that depends on them.

FABRICATED REFERENCES THAT MUST BE REMOVED:
- ${fabricatedRefs}

Verified references that can be kept:
${refCheck.references.filter(r => r.verified).map(r => '- ' + r.cited).join('\n')}

Recommendations from the reference checker:
${refCheck.recommendations.join('\n')}

Current paper:
${discovery.paper}

Rewrite the ENTIRE paper. Be honest — it is better to say "this requires further research" than to use fake references.`;

        const cleanResponse = await this.llm.call(cleanPrompt);

        await db.update(discoveries)
          .set({
            paper: cleanResponse.text,
            paperStatus: 'draft',
            updatedAt: new Date(),
          })
          .where(eq(discoveries.id, discovery.id));

        await db.insert(researchLog).values({
          eventType: 'paper_references_cleaned',
          agentType: 'paper-pipeline',
          details: {
            discoveryId: discovery.id,
            title: discovery.title,
            fabricatedRemoved: refCheck.fabricatedCount,
          },
        });
      }
    } catch (e) {
      this.log.error(`Reference check failed (proceeding): ${e instanceof Error ? e.message : e}`);
    }

    // Step 3: Peer review
    const reviewTemplate = await loadPrompt(this.projectDir, 'peer-review');
    const reviewPrompt = LLM.formatPrompt(reviewTemplate, {
      title: discovery.title,
      paper: (discovery.paper ?? '').slice(0, 8000),
      domainReview: JSON.stringify(discovery.domainReview, null, 2),
    });

    let review: ReviewResult;
    try {
      const response = await this.llm.callJSON<ReviewResult>(reviewPrompt);
      review = response.data;
    } catch (e) {
      this.log.error(`Peer review failed for "${discovery.title}": ${e instanceof Error ? e.message : e}`);
      return;
    }

    await db.insert(researchLog).values({
      eventType: 'paper_reviewed',
      agentType: 'paper-pipeline',
      details: {
        discoveryId: discovery.id,
        title: discovery.title,
        verdict: review.verdict,
        quality: review.overallQuality,
        strengths: review.strengths.length,
        weaknesses: review.weaknesses.length,
        revisions: review.requiredRevisions.length,
      },
    });

    if (review.verdict === 'approve') {
      await db.update(discoveries)
        .set({ paperStatus: 'approved', updatedAt: new Date() })
        .where(eq(discoveries.id, discovery.id));
      this.log.info(`Paper approved: "${discovery.title}"`);
      return;
    }

    if (review.verdict === 'reject') {
      await db.update(discoveries)
        .set({ paperStatus: 'rejected', status: 'rejected', updatedAt: new Date() })
        .where(eq(discoveries.id, discovery.id));
      this.log.info(`Paper rejected: "${discovery.title}"`);
      return;
    }

    // Step 4: Revision
    if (review.requiredRevisions.length === 0) {
      await db.update(discoveries)
        .set({ paperStatus: 'approved', updatedAt: new Date() })
        .where(eq(discoveries.id, discovery.id));
      this.log.info(`Paper approved (no revisions needed): "${discovery.title}"`);
      return;
    }

    this.log.info(`Revising paper: "${discovery.title}" (${review.requiredRevisions.length} revisions)...`);

    const reviseTemplate = await loadPrompt(this.projectDir, 'revise-paper');
    const revisePrompt = LLM.formatPrompt(reviseTemplate, {
      title: discovery.title,
      paper: discovery.paper ?? '',
      review: JSON.stringify(review, null, 2),
      requiredRevisions: review.requiredRevisions.join('\n- '),
    });

    try {
      const response = await this.llm.call(revisePrompt);

      await db.update(discoveries)
        .set({
          paper: response.text,
          paperStatus: 'revised',
          updatedAt: new Date(),
        })
        .where(eq(discoveries.id, discovery.id));

      await db.insert(researchLog).values({
        eventType: 'paper_revised',
        agentType: 'paper-pipeline',
        details: {
          discoveryId: discovery.id,
          title: discovery.title,
          revisionsApplied: review.requiredRevisions.length,
          newLength: response.text.length,
        },
      });

      this.log.info(`Paper revised: "${discovery.title}" (${response.text.length} chars)`);
    } catch (e) {
      this.log.error(`Paper revision failed for "${discovery.title}": ${e instanceof Error ? e.message : e}`);
    }
  }
}
