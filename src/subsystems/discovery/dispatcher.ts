import type { SubsystemContext } from '../../core/subsystem';
import type { ModuleConfig } from '../../core/module-config';
import { loadModuleConfig } from '../../core/prompt-loader';
import { getDb } from '../../db/connection';
import { findings, discoveries } from '../../db/schema';
import { sql } from 'drizzle-orm';
import { LLM, RateLimitError, createLLM } from '../../llm/llm';
import { Logger } from '../../core/logger';
import { SynthesisAgent } from './synthesis';
import { NoveltyChecker } from './novelty-checker';

export class DiscoveryDispatcher {
  private running = false;
  private tickInterval = 5000;
  private log = new Logger('discovery');
  private moduleConfig: ModuleConfig | null = null;

  private async getModuleConfig(): Promise<ModuleConfig> {
    if (!this.moduleConfig) {
      this.moduleConfig = await loadModuleConfig(process.cwd(), 'discovery');
    }
    return this.moduleConfig;
  }

  async start(ctx: SubsystemContext): Promise<void> {
    this.running = true;
    const config = await this.getModuleConfig();
    this.tickInterval = config.tickInterval ?? 5000;
    this.log.info('Discovery dispatcher started');

    while (this.running) {
      try {
        await this.tick(ctx, config);
      } catch (e) {
        if (e instanceof RateLimitError) {
          const cap = config.rateLimitRecoveryCap ?? 60000;
          this.log.warn(`Rate limited. Waiting ${Math.ceil(e.waitMs / 60000)} min...`);
          await Bun.sleep(Math.min(e.waitMs, cap));
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

  private async tick(ctx: SubsystemContext, config: ModuleConfig): Promise<void> {
    if (LLM.isCurrentlyRateLimited()) return;

    const db = getDb();
    const llm = createLLM('discovery', ctx.config.llm, ctx.config.agents);
    const minFindings = config.minFindings ?? 5;

    // Check if we have enough findings to do anything
    const [findingCount] = await db.select({
      count: sql<number>`count(*)`,
    }).from(findings);

    if (Number(findingCount.count) < minFindings) return;

    const projectDir = process.cwd();

    // 1. Run synthesis to find clusters
    const synthesis = new SynthesisAgent(llm, projectDir, config);
    await synthesis.synthesize();

    // 2. Run novelty checker on strong findings not yet evaluated
    const noveltyChecker = new NoveltyChecker(llm, projectDir, config);
    await noveltyChecker.scanForDiscoveries();

    // 3. Run literature search on discoveries pending verification
    await noveltyChecker.searchLiteratureForPending();
  }
}
