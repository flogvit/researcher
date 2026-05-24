import type { SubsystemContext } from '../../core/subsystem';
import type { ModuleConfig } from '../../core/module-config';
import { loadModuleConfig } from '../../core/prompt-loader';
import { getSourcePlugin } from './sources';
import { indexLocalSource } from './sources/local';
import * as downloader from './stages/downloader';
import * as extractor from './stages/text-extractor';
import * as classifier from './stages/classifier';
import * as embedder from './stages/embedder';
import { LLM } from '../../llm/llm';
import { Logger } from '../../core/logger';

export class LibraryDispatcher {
  private running = false;
  private tickInterval = 2000;
  private lastSourceRun: Record<string, number> = {};
  private lastLocalSourceRun = 0;
  private log = new Logger('library');
  private moduleConfig: ModuleConfig | null = null;

  private async getModuleConfig(): Promise<ModuleConfig> {
    if (!this.moduleConfig) {
      this.moduleConfig = await loadModuleConfig(process.cwd(), 'library');
    }
    return this.moduleConfig;
  }

  async start(ctx: SubsystemContext): Promise<void> {
    this.running = true;
    const config = await this.getModuleConfig();
    this.tickInterval = config.tickInterval ?? 2000;
    this.log.info('Library pipeline started');

    // Run sources on startup
    await this.runSources(ctx, config);
    await this.maybeRunLocalSources(ctx);

    // Mark documents without URLs as failed (can't download them)
    const noUrl = await downloader.markNoUrl();
    if (noUrl > 0) this.log.info(`Marked ${noUrl} documents without URL as failed`);

    while (this.running) {
      await this.tick(ctx, config);
      await Bun.sleep(this.tickInterval);
    }

    this.log.info('Library pipeline stopped');
  }

  async runOnce(ctx: SubsystemContext): Promise<void> {
    this.log.info('Running library pipeline (one pass)');
    const config = await this.getModuleConfig();

    // 1. Run all sources
    await this.runSources(ctx, config);
    await this.runLocalSources(ctx);

    // 2. Mark documents without URLs
    const noUrl = await downloader.markNoUrl();
    if (noUrl > 0) this.log.info(`Marked ${noUrl} documents without URL as failed`);

    // 3. Process all pipeline stages until nothing left
    let processed = true;
    while (processed) {
      processed = false;

      // Download
      if (await downloader.processNext(config)) { processed = true; continue; }

      // Extract
      if (await extractor.processNext(config)) { processed = true; continue; }

      // Classify
      const llm = ctx.llm as LLM;
      if (await classifier.processNext(llm, process.cwd(), config)) { processed = true; continue; }

      // Embed
      if (await embedder.processNext(config)) { processed = true; continue; }
    }

    this.log.info('Library pipeline pass complete');
  }

  private async tick(ctx: SubsystemContext, config: ModuleConfig): Promise<void> {
    // Check if any source needs to run
    await this.maybeRunSources(ctx, config);
    await this.maybeRunLocalSources(ctx);

    // Stages touch disjoint document statuses ('metadata' → 'downloading' →
    // 'downloaded' → 'extracted' → 'classified' → 'embedded') and the
    // claim queries use FOR UPDATE SKIP LOCKED (#14), so it's safe to run
    // them in parallel within a tick. Quadruples per-tick throughput (#40).
    const llm = ctx.llm;
    const stages: Array<Promise<unknown>> = [
      downloader.processNext(config),
      extractor.processNext(config),
      embedder.processNext(config),
    ];
    if (!LLM.isCurrentlyRateLimited()) {
      stages.push(classifier.processNext(llm, process.cwd(), config));
    }
    await Promise.all(stages.map(p => p.catch(e => {
      this.log.error(`Stage error: ${e instanceof Error ? e.message : String(e)}`);
    })));
  }

  private async runSources(ctx: SubsystemContext, config: ModuleConfig): Promise<void> {
    const sources = ctx.config.library.sources.filter(s => s.enabled);

    for (const sourceConfig of sources) {
      const plugin = getSourcePlugin(sourceConfig.type);
      if (!plugin) {
        this.log.warn(`Unknown source plugin: ${sourceConfig.type}`);
        continue;
      }

      try {
        this.log.info(`Running source: ${plugin.name}`);
        const result = await plugin.fetch(sourceConfig.settings, config);
        this.log.info(`Source ${plugin.name}: ${result.added} new, ${result.total} total`);
        this.lastSourceRun[sourceConfig.type] = Date.now();
      } catch (e) {
        this.log.error(`Source ${plugin.name} failed: ${e instanceof Error ? e.message : e}`);
      }
    }
  }

  private async maybeRunSources(ctx: SubsystemContext, config: ModuleConfig): Promise<void> {
    const sources = ctx.config.library.sources.filter(s => s.enabled);
    const now = Date.now();

    for (const sourceConfig of sources) {
      const lastRun = this.lastSourceRun[sourceConfig.type] ?? 0;
      const intervalMs = (sourceConfig.interval ?? 86400) * 1000;

      if (now - lastRun >= intervalMs) {
        const plugin = getSourcePlugin(sourceConfig.type);
        if (!plugin) continue;

        try {
          this.log.info(`Running source: ${plugin.name} (interval elapsed)`);
          const result = await plugin.fetch(sourceConfig.settings, config);
          this.log.info(`Source ${plugin.name}: ${result.added} new`);
          this.lastSourceRun[sourceConfig.type] = now;
        } catch (e) {
          this.log.error(`Source ${plugin.name} failed: ${e instanceof Error ? e.message : e}`);
        }
      }
    }
  }

  private async runLocalSources(ctx: SubsystemContext): Promise<void> {
    const localSources = ctx.config.library.localSources ?? [];
    for (const source of localSources.filter(s => s.enabled)) {
      try {
        this.log.info(`Indexing local source: ${source.name ?? source.path}`);
        const result = await indexLocalSource(source);
        this.log.info(`Local source ${source.name ?? source.path}: ${result.added} new, ${result.updated} updated`);
      } catch (e) {
        this.log.error(`Local source failed: ${e instanceof Error ? e.message : e}`);
      }
    }
    this.lastLocalSourceRun = Date.now();
  }

  private async maybeRunLocalSources(ctx: SubsystemContext): Promise<void> {
    const localSources = ctx.config.library.localSources ?? [];
    if (localSources.length === 0) return;
    const now = Date.now();
    const minInterval = Math.min(...localSources.map(s => (s.interval ?? 3600) * 1000));
    if (now - this.lastLocalSourceRun >= minInterval) {
      await this.runLocalSources(ctx);
    }
  }

  async stop(): Promise<void> {
    this.running = false;
  }
}
