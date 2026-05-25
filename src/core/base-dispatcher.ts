import type { SubsystemContext } from './subsystem';
import type { ModuleConfig } from './module-config';
import { loadModuleConfig } from './prompt-loader';
import { RateLimitError } from '../llm/llm';
import { Logger } from './logger';

/**
 * Shared driver loop for every dispatcher (#58).
 *
 * Before this, library/research/discovery/paper each reimplemented the same
 * while-running loop with try/catch/rate-limit-cap/sleep. Now they just
 * extend BaseDispatcher and supply:
 *
 *   moduleName  — the .json key under research/modules/
 *   tick(ctx, config) — the per-tick work
 *   defaultTickInterval — how long to sleep between ticks
 *
 * BaseDispatcher owns module-config caching, rate-limit cap handling,
 * shutdown signal, and structured logging — adding jitter or graceful-stop
 * later is a single-file change.
 */
export abstract class BaseDispatcher {
  protected running = false;
  protected log: Logger;
  protected moduleConfig: ModuleConfig | null = null;
  protected readonly moduleName: string;
  protected readonly defaultTickInterval: number;

  constructor(moduleName: string, defaultTickInterval = 2000) {
    this.moduleName = moduleName;
    this.defaultTickInterval = defaultTickInterval;
    this.log = new Logger(moduleName);
  }

  protected async getModuleConfig(): Promise<ModuleConfig> {
    if (!this.moduleConfig) {
      this.moduleConfig = await loadModuleConfig(process.cwd(), this.moduleName);
    }
    return this.moduleConfig;
  }

  protected abstract tick(ctx: SubsystemContext, config: ModuleConfig): Promise<void>;

  async start(ctx: SubsystemContext): Promise<void> {
    this.running = true;
    const config = await this.getModuleConfig();
    const tickInterval = config.tickInterval ?? this.defaultTickInterval;
    this.log.info(`${this.moduleName} dispatcher started`);

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
      await Bun.sleep(tickInterval);
    }

    this.log.info(`${this.moduleName} dispatcher stopped`);
  }

  async stop(): Promise<void> {
    this.running = false;
  }
}
