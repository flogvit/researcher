import type { Command } from 'commander';
import { loadConfig, getDatabaseUrl } from '../config';
import { initDatabase, getClient } from '../db/connection';
import { initEmbeddingConfig } from '../llm/embeddings';
import { createDraft, listDrafts, getDraft, listProposals, acceptProposal, rejectProposal, updateDraftBody } from '../subsystems/drafts/store';
import { generateDraft } from '../subsystems/drafts/generator';
import { proposeEdit } from '../subsystems/drafts/proposer';
import { exportDraftsToGit } from '../subsystems/drafts/git-export';

/**
 * `researcher drafts` subcommands (#109, plus #111 export).
 *   drafts list
 *   drafts show <id>
 *   drafts create <title>
 *   drafts edit <id> --body-file path.md
 *   drafts gen <id>
 *   drafts propose <id> "<request>"
 *   drafts proposals <id>
 *   drafts accept <pid>
 *   drafts reject <pid>
 *   drafts export <dir>
 */
export function registerDraftsCommand(program: Command): void {
  const cmd = program.command('drafts').description('Authoring drafts');

  async function init(): Promise<void> {
    const config = await loadConfig(process.cwd());
    initDatabase(getDatabaseUrl(config));
    initEmbeddingConfig(config);
  }

  cmd.command('list').action(async () => {
    await init();
    const all = await listDrafts();
    if (all.length === 0) { console.log('No drafts.'); getClient().close(); return; }
    for (const d of all) console.log(`  [${d.id}] ${d.title} — ${d.status} — ${new Date(d.updatedAt).toLocaleString()}`);
    getClient().close();
  });

  cmd.command('show <id>').action(async (id: string) => {
    await init();
    const d = await getDraft(parseInt(id, 10));
    if (!d) { console.error('Not found'); getClient().close(); process.exit(1); return; }
    console.log(`# ${d.title}\n`);
    console.log(d.bodyMd);
    getClient().close();
  });

  cmd.command('create <title>').action(async (title: string) => {
    await init();
    const d = await createDraft({ title });
    console.log(`Created draft [${d.id}] "${d.title}"`);
    getClient().close();
  });

  cmd.command('edit <id>')
    .option('--body-file <path>', 'Read new body from a file')
    .action(async (id: string, opts: { bodyFile?: string }) => {
      await init();
      if (!opts.bodyFile) { console.error('--body-file required'); getClient().close(); process.exit(1); return; }
      const { readFile } = await import('node:fs/promises');
      const body = await readFile(opts.bodyFile, 'utf-8');
      await updateDraftBody(parseInt(id, 10), body, 'manual');
      console.log('Saved.');
      getClient().close();
    });

  cmd.command('gen <id>').action(async (id: string) => {
    const config = await loadConfig(process.cwd());
    initDatabase(getDatabaseUrl(config));
    initEmbeddingConfig(config);
    const r = await generateDraft(config, process.cwd(), parseInt(id, 10));
    console.log(r.ok ? 'Generated.' : `Error: ${r.error}`);
    getClient().close();
  });

  cmd.command('propose <id> <request...>').action(async (id: string, requestParts: string[]) => {
    const config = await loadConfig(process.cwd());
    initDatabase(getDatabaseUrl(config));
    initEmbeddingConfig(config);
    const request = requestParts.join(' ');
    const p = await proposeEdit(config, parseInt(id, 10), request);
    if (!p) { console.log('No proposal generated.'); }
    else { console.log(`Proposal ${p.proposalId}: ${p.rationale}`); }
    getClient().close();
  });

  cmd.command('proposals <id>').action(async (id: string) => {
    await init();
    const proposals = await listProposals(parseInt(id, 10));
    if (proposals.length === 0) { console.log('No pending proposals.'); getClient().close(); return; }
    for (const p of proposals) {
      console.log(`\n  [${p.id}] ${p.kind} — source: ${p.source ?? 'manual'}`);
      if (p.rationale) console.log(`    rationale: "${p.rationale}"`);
    }
    getClient().close();
  });

  cmd.command('accept <pid>').action(async (pid: string) => {
    await init();
    const r = await acceptProposal(parseInt(pid, 10));
    console.log(`Proposal ${pid}: ${r.status}${r.revisionId ? ` (revision ${r.revisionId})` : ''}`);
    getClient().close();
  });

  cmd.command('reject <pid>').action(async (pid: string) => {
    await init();
    const ok = await rejectProposal(parseInt(pid, 10));
    console.log(ok ? 'Rejected.' : 'Not found.');
    getClient().close();
  });

  cmd.command('export <dir>')
    .description('Export drafts to a git repo as folder of .md files (#111)')
    .action(async (dir: string) => {
      await init();
      const summary = await exportDraftsToGit(dir);
      console.log(`Exported ${summary.exported} draft(s) to ${dir}`);
      getClient().close();
    });
}
