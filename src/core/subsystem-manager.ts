import type { Subsystem, SubsystemContext, SubsystemStatus } from './subsystem';
import { Logger } from './logger';

/**
 * Single coordinator for subsystem lifecycle (#59).
 *
 * Replaces the old split between Orchestrator (topological, CLI-only) and
 * SubsystemManager (individual start/stop, web-only). Both surfaces now
 * route through this class so:
 *   - dependency ordering is honored everywhere (the web UI used to ignore
 *     Subsystem.dependencies entirely)
 *   - there's one source of truth for "is X running?"
 *
 * Methods:
 *   startSubsystem(name)      — start one (after deps are ready)
 *   startAll()                — topological start
 *   stopSubsystem(name)       — stop one
 *   stopAll()                 — reverse-topological stop
 *   updateAll()               — sequential one-pass update for CLI 'update'
 *   statusAll()               — for both CLI 'status' and /api/subsystems
 */
export class SubsystemManager {
  private subsystems: Map<string, Subsystem> = new Map();
  private running: Map<string, Promise<void>> = new Map();
  private log = new Logger('manager');

  register(subsystem: Subsystem): void {
    this.subsystems.set(subsystem.name, subsystem);
  }

  getNames(): string[] {
    return [...this.subsystems.keys()];
  }

  isRunning(name: string): boolean {
    return this.running.has(name);
  }

  async startSubsystem(name: string, ctx: SubsystemContext): Promise<boolean> {
    const subsystem = this.subsystems.get(name);
    if (!subsystem) return false;
    if (this.running.has(name)) return false;

    // Wait for declared dependencies to be running before launching.
    for (const dep of subsystem.dependencies) {
      if (!this.running.has(dep)) {
        this.log.warn(`Cannot start ${name}: dependency ${dep} not running`);
        return false;
      }
    }

    this.log.info(`Starting subsystem: ${name}`);
    const promise = subsystem.start(ctx).catch(e => {
      this.log.error(`Subsystem ${name} crashed: ${e instanceof Error ? e.message : String(e)}`);
    }).finally(() => {
      this.running.delete(name);
    });

    this.running.set(name, promise);
    return true;
  }

  /**
   * Start every registered subsystem in dependency order.
   * Used by `researcher start` CLI and as a one-shot from the orchestrator
   * replacement path. Each subsystem.start() runs its own loop in the
   * background; this method returns once all have been *launched*.
   */
  async startAll(ctx: SubsystemContext): Promise<void> {
    const ordered = this.topologicalSort();
    for (const subsystem of ordered) {
      if (this.running.has(subsystem.name)) continue;
      // Race a short tick against start() so a synchronous init failure
      // unblocks before dependents are released (cf. #33).
      this.log.info(`Starting subsystem: ${subsystem.name}`);
      let crashed = false;
      const promise = subsystem.start(ctx).catch(e => {
        crashed = true;
        this.log.error(`Subsystem ${subsystem.name} crashed: ${e instanceof Error ? e.message : String(e)}`);
      }).finally(() => {
        this.running.delete(subsystem.name);
      });
      this.running.set(subsystem.name, promise);
      await Promise.race([promise, Bun.sleep(10)]);
      if (crashed) {
        this.log.error(`Aborting start of dependents of ${subsystem.name}`);
        return;
      }
    }
  }

  async stopSubsystem(name: string): Promise<boolean> {
    const subsystem = this.subsystems.get(name);
    if (!subsystem) return false;
    if (!this.running.has(name)) return false;

    this.log.info(`Stopping subsystem: ${name}`);
    await subsystem.stop();
    const promise = this.running.get(name);
    if (promise) await promise.catch(() => {});
    return true;
  }

  /** Stop every running subsystem in reverse dependency order. */
  async stopAll(): Promise<void> {
    const ordered = this.topologicalSort().reverse();
    for (const subsystem of ordered) {
      if (this.running.has(subsystem.name)) {
        await this.stopSubsystem(subsystem.name);
      }
    }
  }

  /** Run each subsystem's one-pass update() in dependency order. */
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

  async statusAll(): Promise<Array<SubsystemStatus & { managed: boolean }>> {
    const results: Array<SubsystemStatus & { managed: boolean }> = [];
    for (const subsystem of this.subsystems.values()) {
      const status = await subsystem.status();
      results.push({
        ...status,
        managed: true,
        state: this.running.has(subsystem.name) ? status.state : 'stopped',
      });
    }
    return results;
  }

  /** Topological sort by Subsystem.dependencies. Throws on cycles. */
  private topologicalSort(): Subsystem[] {
    const sorted: Subsystem[] = [];
    const visited = new Set<string>();
    const visiting = new Set<string>();

    const visit = (name: string): void => {
      if (visited.has(name)) return;
      if (visiting.has(name)) throw new Error(`Circular dependency detected: ${name}`);

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

    for (const name of this.subsystems.keys()) visit(name);
    return sorted;
  }
}
