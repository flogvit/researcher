import type { SubsystemContext } from '../../core/subsystem';
import type { ModuleConfig } from '../../core/module-config';
import { getDb } from '../../db/connection';
import { findings } from '../../db/schema';
import { sql } from 'drizzle-orm';
import { LLM, createLLM } from '../../llm/llm';
import { BaseDispatcher } from '../../core/base-dispatcher';
import { SynthesisAgent } from './synthesis';
import { NoveltyChecker } from './novelty-checker';

export class DiscoveryDispatcher extends BaseDispatcher {
  constructor() {
    super('discovery', 5000);
  }

  protected async tick(ctx: SubsystemContext, config: ModuleConfig): Promise<void> {
    if (LLM.isCurrentlyRateLimited()) return;

    const db = getDb();
    const llm = createLLM('discovery', ctx.config.llm, ctx.config.agents);
    const minFindings = config.minFindings ?? 5;

    const [findingCount] = await db.select({
      count: sql<number>`count(*)`,
    }).from(findings);

    if (Number(findingCount.count) < minFindings) return;

    const projectDir = process.cwd();
    const synthesis = new SynthesisAgent(llm, projectDir, config);
    await synthesis.synthesize();

    const noveltyChecker = new NoveltyChecker(llm, projectDir, config);
    await noveltyChecker.scanForDiscoveries();
    await noveltyChecker.searchLiteratureForPending();
  }
}
