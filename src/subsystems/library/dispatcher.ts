import type { SubsystemContext } from '../../core/subsystem.js';
import type { SourcePlugin } from './sources/types.js';
import { doajSource } from './sources/doaj.js';
import * as downloader from './stages/downloader.js';
import * as extractor from './stages/text-extractor.js';
import * as classifier from './stages/classifier.js';
import * as embedder from './stages/embedder.js';
import { LLM } from '../../llm/llm.js';
import { Logger } from '../../core/logger.js';

// Source plugin registry
const SOURCE_PLUGINS: Record<string, SourcePlugin> = {
  doaj: doajSource,
};

export class LibraryDispatcher {
  private running = false;
  private tickInterval = 2000;
  private lastSourceRun: Record<string, number> = {};
  private log = new Logger('library');

  async start(ctx: SubsystemContext): Promise<void> {
    this.running = true;
    this.log.info('Library pipeline started');

    // Run sources on startup
    await this.runSources(ctx);

    // Mark documents without URLs as failed (can't download them)
    const noUrl = await downloader.markNoUrl();
    if (noUrl > 0) this.log.info(`Marked ${noUrl} documents without URL as failed`);

    while (this.running) {
      await this.tick(ctx);
      await Bun.sleep(this.tickInterval);
    }

    this.log.info('Library pipeline stopped');
  }

  async runOnce(ctx: SubsystemContext): Promise<void> {
    this.log.info('Running library pipeline (one pass)');

    // 1. Run all sources
    await this.runSources(ctx);

    // 2. Mark documents without URLs
    const noUrl = await downloader.markNoUrl();
    if (noUrl > 0) this.log.info(`Marked ${noUrl} documents without URL as failed`);

    // 3. Process all pipeline stages until nothing left
    let processed = true;
    while (processed) {
      processed = false;

      // Download
      if (await downloader.processNext()) { processed = true; continue; }

      // Extract
      if (await extractor.processNext()) { processed = true; continue; }

      // Classify
      const llm = ctx.llm as LLM;
      if (await classifier.processNext(llm, process.cwd())) { processed = true; continue; }

      // Embed
      if (await embedder.processNext()) { processed = true; continue; }
    }

    this.log.info('Library pipeline pass complete');
  }

  private async tick(ctx: SubsystemContext): Promise<void> {
    // Check if any source needs to run
    await this.maybeRunSources(ctx);

    // Process one item from each stage (priority: download first, embed last)
    await downloader.processNext();
    await extractor.processNext();
    const llm = ctx.llm as LLM;
    if (!LLM.isCurrentlyRateLimited()) {
      await classifier.processNext(llm, process.cwd());
    }
    await embedder.processNext();
  }

  private async runSources(ctx: SubsystemContext): Promise<void> {
    const sources = ctx.config.library.sources.filter(s => s.enabled);

    for (const sourceConfig of sources) {
      const plugin = SOURCE_PLUGINS[sourceConfig.type];
      if (!plugin) {
        this.log.warn(`Unknown source plugin: ${sourceConfig.type}`);
        continue;
      }

      try {
        this.log.info(`Running source: ${plugin.name}`);
        const result = await plugin.fetch(sourceConfig.settings);
        this.log.info(`Source ${plugin.name}: ${result.added} new, ${result.total} total`);
        this.lastSourceRun[sourceConfig.type] = Date.now();
      } catch (e) {
        this.log.error(`Source ${plugin.name} failed: ${e instanceof Error ? e.message : e}`);
      }
    }
  }

  private async maybeRunSources(ctx: SubsystemContext): Promise<void> {
    const sources = ctx.config.library.sources.filter(s => s.enabled);
    const now = Date.now();

    for (const sourceConfig of sources) {
      const lastRun = this.lastSourceRun[sourceConfig.type] ?? 0;
      const intervalMs = (sourceConfig.interval ?? 86400) * 1000;

      if (now - lastRun >= intervalMs) {
        const plugin = SOURCE_PLUGINS[sourceConfig.type];
        if (!plugin) continue;

        try {
          this.log.info(`Running source: ${plugin.name} (interval elapsed)`);
          const result = await plugin.fetch(sourceConfig.settings);
          this.log.info(`Source ${plugin.name}: ${result.added} new`);
          this.lastSourceRun[sourceConfig.type] = now;
        } catch (e) {
          this.log.error(`Source ${plugin.name} failed: ${e instanceof Error ? e.message : e}`);
        }
      }
    }
  }

  async stop(): Promise<void> {
    this.running = false;
  }
}
