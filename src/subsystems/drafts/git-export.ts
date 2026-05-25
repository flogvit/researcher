import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { listDrafts, listRevisions } from './store';
import { getDb } from '../../db/connection';
import { draftRevisions } from '../../db/schema';
import { eq, asc } from 'drizzle-orm';
import { atomicWrite } from '../../core/upgrade';
import { Logger } from '../../core/logger';

/**
 * Git export of drafts (Fase 4 #111).
 *
 * Each draft becomes `<slug>.md` in the target directory. The earliest
 * revision is the first commit (source='initial'); accepted edit proposals
 * become subsequent commits with the proposal id in the message. Manual
 * edits become commits with source='manual'.
 *
 * If the target dir is not a git repo, we init one. If git isn't on
 * PATH, we just write the files (no commits).
 */

const log = new Logger('draft-export');

export interface ExportSummary {
  exported: number;
  commits: number;
  hasGit: boolean;
}

function slugify(title: string): string {
  return title.toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
}

function hasGit(): boolean {
  try {
    return spawnSync('git', ['--version']).status === 0;
  } catch { return false; }
}

function runGit(cwd: string, args: string[]): boolean {
  const r = spawnSync('git', args, { cwd, stdio: 'pipe' });
  return r.status === 0;
}

export async function exportDraftsToGit(targetDir: string): Promise<ExportSummary> {
  mkdirSync(targetDir, { recursive: true });
  const git = hasGit();

  if (git && !runGit(targetDir, ['rev-parse', '--is-inside-work-tree'])) {
    runGit(targetDir, ['init']);
    log.info(`initialized git repo at ${targetDir}`);
  }

  const drafts = await listDrafts();
  let commits = 0;

  for (const draft of drafts) {
    const slug = slugify(draft.title) || `draft-${draft.id}`;
    const filename = `${slug}.md`;
    const filePath = resolve(targetDir, filename);

    if (git) {
      // Replay history: write each revision sequentially, commit each one.
      const db = getDb();
      const revs = await db.select().from(draftRevisions)
        .where(eq(draftRevisions.draftId, draft.id))
        .orderBy(asc(draftRevisions.createdAt));

      for (const rev of revs) {
        await atomicWrite(filePath, rev.bodyMd);
        runGit(targetDir, ['add', filename]);
        const msg = rev.source.startsWith('proposal:')
          ? `${draft.title}: ${rev.summary ?? 'accepted proposal'} (${rev.source})`
          : rev.source === 'generator'
            ? `${draft.title}: generated v1`
            : `${draft.title}: ${rev.summary ?? 'manual edit'}`;
        const env = { ...process.env, GIT_COMMITTER_DATE: rev.createdAt.toISOString(), GIT_AUTHOR_DATE: rev.createdAt.toISOString() };
        const ok = spawnSync('git', ['commit', '-m', msg], { cwd: targetDir, env, stdio: 'pipe' }).status === 0;
        if (ok) commits++;
      }
      // Final write of the current body in case revisions are missing the latest.
      await atomicWrite(filePath, draft.bodyMd);
      runGit(targetDir, ['add', filename]);
      spawnSync('git', ['commit', '-m', `${draft.title}: current state`], { cwd: targetDir, stdio: 'pipe' });
    } else {
      await atomicWrite(filePath, draft.bodyMd);
    }
  }

  return { exported: drafts.length, commits, hasGit: git };
}
