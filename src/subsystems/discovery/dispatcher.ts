import type { SubsystemContext } from '../../core/subsystem.js';
import { getDb } from '../../db/connection.js';
import { findings, discoveries } from '../../db/schema.js';
import { sql } from 'drizzle-orm';
import { LLM, RateLimitError } from '../../llm/llm.js';
import { Logger } from '../../core/logger.js';
import { SynthesisAgent } from './synthesis.js';
import { NoveltyChecker } from './novelty-checker.js';

export class DiscoveryDispatcher {
  private running = false;
  private tickInterval = 5000;
  private log = new Logger('discovery');

  async start(ctx: SubsystemContext): Promise<void> {
    this.running = true;
    this.log.info('Discovery dispatcher started');

    while (this.running) {
      try {
        await this.tick(ctx);
      } catch (e) {
        if (e instanceof RateLimitError) {
          this.log.warn(`Rate limited. Waiting ${Math.ceil(e.waitMs / 60000)} min...`);
          await Bun.sleep(Math.min(e.waitMs, 60000));
        } else {
          this.log.error(`Tick error: ${e instanceof Error ? e.message : e}`);
        }
      }
      await Bun.sleep(this.tickInterval);
    }

    this.log.info('Discovery dispatcher stopped');
  }

  async stop(): Promise<void> {
    this.running = false;
  }

  private async tick(ctx: SubsystemContext): Promise<void> {
    if (LLM.isCurrentlyRateLimited()) return;

    const db = getDb();
    const llm = new LLM(ctx.config.llm);

    // Check if we have enough findings to do anything
    const [findingCount] = await db.select({
      count: sql<number>`count(*)`,
    }).from(findings);

    if (Number(findingCount.count) < 5) return;

    // 1. Run synthesis to find clusters
    const synthesis = new SynthesisAgent(llm);
    await synthesis.synthesize();

    // 2. Run novelty checker on strong findings not yet evaluated
    const noveltyChecker = new NoveltyChecker(llm);
    await noveltyChecker.scanForDiscoveries();

    // 3. Run literature search on discoveries pending verification
    await noveltyChecker.searchLiteratureForPending();
  }
}
