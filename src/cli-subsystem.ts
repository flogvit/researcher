import type { Command } from 'commander';
import type { Subsystem, SubsystemContext, SubsystemStatus } from './core/subsystem';

interface CreateContextResult {
  ctx: SubsystemContext;
  cleanup: () => Promise<void>;
}

/**
 * Register the standard start/update/status subcommands for a subsystem (#62).
 *
 * Each of library/research/discovery/paper used to copy-paste ~75 lines for
 * these three commands. They're now generated from this factory; the only
 * subsystem-specific bit is the optional formatStatus callback for nicer
 * pretty-printing (library has stage-ordered output; others can use the
 * default key/value dump).
 */
export interface SubsystemCommandsOptions {
  name: string;
  /** "Library", "Research", etc. — used in human-facing log lines */
  label: string;
  createContext: () => Promise<CreateContextResult>;
  subsystem: () => Subsystem;
  descriptions?: {
    start?: string;
    update?: string;
    status?: string;
  };
  formatStatus?: (status: SubsystemStatus) => void;
}

function defaultFormatStatus(label: string, status: SubsystemStatus): void {
  console.log(`\n${label} Status: ${status.state}`);
  console.log('─'.repeat(40));
  for (const [key, value] of Object.entries(status.stats)) {
    console.log(`  ${String(key).padEnd(20)} ${value}`);
  }
  if (status.error) {
    console.log(`  ERROR: ${status.error}`);
  }
}

export function registerSubsystemCommands(parent: Command, opts: SubsystemCommandsOptions): void {
  parent
    .command('start')
    .description(opts.descriptions?.start ?? `Run ${opts.name} pipeline continuously`)
    .action(async () => {
      const { ctx, cleanup } = await opts.createContext();
      const sys = opts.subsystem();

      const shutdown = async () => {
        console.log(`\nShutting down ${opts.name}...`);
        await sys.stop();
        await cleanup();
        process.exit(0);
      };

      process.on('SIGINT', shutdown);
      process.on('SIGTERM', shutdown);

      console.log(`Starting ${opts.name} pipeline...`);
      await sys.start(ctx);
      await cleanup();
    });

  parent
    .command('update')
    .description(opts.descriptions?.update ?? `Run ${opts.name} pipeline once`)
    .action(async () => {
      const { ctx, cleanup } = await opts.createContext();
      const sys = opts.subsystem();

      console.log(`Running ${opts.name} update...`);
      await sys.update(ctx);
      await cleanup();
      console.log(`${opts.label} update complete.`);
    });

  parent
    .command('status')
    .description(opts.descriptions?.status ?? `Show ${opts.name} status`)
    .action(async () => {
      const { cleanup } = await opts.createContext();
      const sys = opts.subsystem();
      const status = await sys.status();
      if (opts.formatStatus) {
        opts.formatStatus(status);
      } else {
        defaultFormatStatus(opts.label, status);
      }
      await cleanup();
    });
}
