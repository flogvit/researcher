import { loadConfig, getDatabaseUrl, type ProjectConfig } from '@researcher/config';
import { initDatabase, getDb } from '@researcher/db/connection';
import { initEmbeddingConfig } from '@researcher/llm/embeddings';
import { LLM } from '@researcher/llm/llm';
import { SubsystemManager } from '@researcher/core/subsystem-manager';
import { LibrarySubsystem } from '@researcher/subsystems/library/index';
import { ResearchSubsystem } from '@researcher/subsystems/research/index';
import { DiscoverySubsystem } from '@researcher/subsystems/discovery/index';
import { PaperSubsystem } from '@researcher/subsystems/paper/index';
import { processAdminTasks } from '@researcher/core/admin-tasks';
import { recoverStaleTasks, recoverStaleDownloads } from '@researcher/core/task-queue';
import type { SubsystemContext } from '@researcher/core/subsystem';
import { EventEmitter } from 'node:events';
import { resolve } from 'node:path';

interface ServerContext {
  initialized: boolean;
  config: ProjectConfig;
  manager: SubsystemManager;
  ctx: SubsystemContext;
  projectDir: string;
  db: ReturnType<typeof getDb>;
}

let _context: ServerContext | null = null;
let _initPromise: Promise<ServerContext> | null = null;
let _adminInterval: ReturnType<typeof setInterval> | null = null;

function findProjectDir(): string {
  if (process.env.RESEARCHER_PROJECT_DIR) return process.env.RESEARCHER_PROJECT_DIR;
  // If running from web/ subdir, go up one level
  const cwd = process.cwd();
  if (cwd.endsWith('/web') || cwd.endsWith('\\web')) return resolve(cwd, '..');
  return cwd;
}

async function initialize(): Promise<ServerContext> {
  const projectDir = findProjectDir();

  // Change working directory so subsystems using process.cwd() find the project
  if (process.cwd() !== projectDir) {
    process.chdir(projectDir);
  }

  const config = await loadConfig(projectDir);
  const dbUrl = getDatabaseUrl(config);

  initDatabase(dbUrl);
  initEmbeddingConfig(config);

  // Reset tasks/downloads stranded in transient states by a previous crash
  // before any subsystem starts claiming new work (issue #15).
  await recoverStaleTasks();
  await recoverStaleDownloads();

  const db = getDb();
  const llm = new LLM(config.llm);

  const emitter = new EventEmitter();
  const manager = new SubsystemManager();
  manager.register(new LibrarySubsystem());
  manager.register(new ResearchSubsystem());
  manager.register(new DiscoverySubsystem());
  manager.register(new PaperSubsystem());

  const ctx: SubsystemContext = {
    config,
    db,
    llm,
    isReady(name: string) {
      return manager.isRunning(name);
    },
    emit(event: string, data: unknown) {
      emitter.emit(event, data);
    },
    on(event: string, handler: (data: unknown) => void) {
      emitter.on(event, handler);
    },
  };

  // Start admin queue processor
  if (!_adminInterval) {
    _adminInterval = setInterval(async () => {
      try {
        await processAdminTasks(config, projectDir);
      } catch {
        // silently ignore admin task errors
      }
    }, 5000);
  }

  return { initialized: true, config, manager, ctx, projectDir, db };
}

export async function getServerContext(): Promise<ServerContext> {
  if (_context) return _context;

  if (!_initPromise) {
    _initPromise = initialize().then((ctx) => {
      _context = ctx;
      return ctx;
    }).catch((e) => {
      _initPromise = null;
      throw e;
    });
  }

  return _initPromise;
}

export function isInitialized(): boolean {
  return _context !== null;
}

export function getProjectDir(): string {
  return findProjectDir();
}
