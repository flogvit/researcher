import type { Subsystem, SubsystemContext, SubsystemStatus } from './subsystem';
import { Logger } from './logger';

export class Orchestrator {
  private subsystems: Map<string, Subsystem> = new Map();
  private readySet: Set<string> = new Set();
  private log = new Logger('orchestrator');

  register(subsystem: Subsystem): void {
    this.subsystems.set(subsystem.name, subsystem);
  }

  /**
   * Start all subsystems in dependency order.
   * Each subsystem's start() runs until stop() is called.
   */
  async startAll(ctx: SubsystemContext): Promise<void> {
    const ordered = this.topologicalSort();
    const running: Promise<void>[] = [];

    for (const subsystem of ordered) {
      const timeout = ctx.config.orchestrator?.dependencyTimeout ?? 60000;
      const pollInterval = ctx.config.orchestrator?.dependencyPollInterval ?? 500;

      // Wait for dependencies to be ready before starting
      for (const dep of subsystem.dependencies) {
        if (!this.readySet.has(dep)) {
          this.log.info(`Waiting for ${dep} to be ready before starting ${subsystem.name}`);
          await this.waitForReady(dep, timeout, pollInterval);
        }
      }

      this.log.info(`Starting subsystem: ${subsystem.name}`);

      let crashed = false;
      const promise = subsystem.start(ctx).catch(e => {
        crashed = true;
        this.readySet.delete(subsystem.name);
        this.log.error(`Subsystem ${subsystem.name} crashed: ${e instanceof Error ? e.message : String(e)}`);
      });
      running.push(promise);

      // The previous version marked the subsystem ready *immediately* after
      // launch, so a sync-throwing init left dependents starting against a
      // dead parent (#33). We now race a short delay against the start
      // promise so a synchronous init failure surfaces before we mark ready;
      // sync-successful starts pass through with ~10ms latency.
      await Promise.race([
        promise,
        Bun.sleep(10),
      ]);
      if (!crashed) {
        this.readySet.add(subsystem.name);
      } else {
        this.log.error(`Skipping dependents of ${subsystem.name} — start() failed during init`);
      }
    }

    // Wait for all subsystems to stop
    await Promise.all(running);
  }

  /**
   * Run each subsystem's update() in dependency order, sequentially.
   * Each update() runs one pass and returns.
   */
  async updateAll(ctx: SubsystemContext): Promise<void> {
    const ordered = this.topologicalSort();

    for (const subsystem of ordered) {
      this.log.info(`Updating subsystem: ${subsystem.name}`);
      try {
        await subsystem.update(ctx);
      } catch (e) {
        this.log.error(`Update failed for ${subsystem.name}: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
  }

  async stopAll(): Promise<void> {
    // Stop in reverse dependency order
    const ordered = this.topologicalSort().reverse();
    for (const subsystem of ordered) {
      this.log.info(`Stopping subsystem: ${subsystem.name}`);
      try {
        await subsystem.stop();
      } catch (e) {
        this.log.error(`Stop failed for ${subsystem.name}: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
    this.readySet.clear();
  }

  async statusAll(): Promise<SubsystemStatus[]> {
    const results: SubsystemStatus[] = [];
    for (const subsystem of this.subsystems.values()) {
      results.push(await subsystem.status());
    }
    return results;
  }

  private topologicalSort(): Subsystem[] {
    const sorted: Subsystem[] = [];
    const visited = new Set<string>();
    const visiting = new Set<string>();

    const visit = (name: string): void => {
      if (visited.has(name)) return;
      if (visiting.has(name)) {
        throw new Error(`Circular dependency detected: ${name}`);
      }

      visiting.add(name);
      const subsystem = this.subsystems.get(name);
      if (!subsystem) throw new Error(`Unknown subsystem: ${name}`);

      for (const dep of subsystem.dependencies) {
        visit(dep);
      }

      visiting.delete(name);
      visited.add(name);
      sorted.push(subsystem);
    };

    for (const name of this.subsystems.keys()) {
      visit(name);
    }

    return sorted;
  }

  private async waitForReady(name: string, timeoutMs = 60000, pollIntervalMs = 500): Promise<void> {
    const start = Date.now();
    while (!this.readySet.has(name)) {
      if (Date.now() - start > timeoutMs) {
        throw new Error(`Timeout waiting for ${name} to be ready`);
      }
      await Bun.sleep(pollIntervalMs);
    }
  }
}
