import type { Subsystem, SubsystemContext, SubsystemStatus } from './subsystem';
import { Logger } from './logger';

/**
 * Manages subsystem lifecycles. Each subsystem can be started/stopped independently.
 * Used by the web server to give users control over what's running.
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
    if (this.running.has(name)) return false; // already running

    this.log.info(`Starting subsystem: ${name}`);
    const promise = subsystem.start(ctx).catch(e => {
      this.log.error(`Subsystem ${name} crashed: ${e instanceof Error ? e.message : String(e)}`);
    }).finally(() => {
      this.running.delete(name);
    });

    this.running.set(name, promise);
    return true;
  }

  async stopSubsystem(name: string): Promise<boolean> {
    const subsystem = this.subsystems.get(name);
    if (!subsystem) return false;
    if (!this.running.has(name)) return false;

    this.log.info(`Stopping subsystem: ${name}`);
    await subsystem.stop();
    // Wait for the start promise to resolve
    const promise = this.running.get(name);
    if (promise) {
      await promise.catch(() => {}); // ignore errors during shutdown
    }
    return true;
  }

  async stopAll(): Promise<void> {
    const names = [...this.running.keys()];
    for (const name of names) {
      await this.stopSubsystem(name);
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
}
