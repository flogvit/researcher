import type { Command } from 'commander';
import { loadConfig, getDatabaseUrl } from '../config';
import { initDatabase, getDb, getClient } from '../db/connection';
import { agentTasks } from '../db/schema';
import { sql, desc, eq } from 'drizzle-orm';
import { approveProposal, rejectProposal } from '../subsystems/chat/action-executor';

/**
 * `researcher proposals` — review/approve/reject brief-mode proposals (#90).
 *
 * Subcommands:
 *   proposals list             — show pending blocked/review-needed tasks
 *   proposals approve <id>     — approve a blocked task (status → pending)
 *   proposals reject <id>      — mark a proposal failed with reason
 */
export function registerProposalsCommand(program: Command): void {
  const cmd = program
    .command('proposals')
    .description('Review brief-mode action proposals');

  cmd.command('list')
    .description('List pending proposals')
    .action(async () => {
      const config = await loadConfig(process.cwd());
      initDatabase(getDatabaseUrl(config));
      const db = getDb();

      const rows = await db.select()
        .from(agentTasks)
        .where(sql`status IN ('blocked','pending') AND payload->>'_proposal' IS NOT NULL`)
        .orderBy(desc(agentTasks.createdAt))
        .limit(50);

      if (rows.length === 0) {
        console.log('No pending proposals.');
        getClient().close();
        return;
      }

      for (const r of rows) {
        const taskType = r.agentType.replace(/^admin:/, '');
        const proposal = (r.payload as { _proposal?: { rationale?: string; scope?: string } })._proposal ?? {};
        console.log(`\n  [${r.id}] ${taskType} — ${r.status}`);
        if (proposal.scope) console.log(`    scope: ${proposal.scope}`);
        if (proposal.rationale) console.log(`    rationale: "${proposal.rationale}"`);
      }
      getClient().close();
    });

  cmd.command('approve <id>')
    .description('Approve a blocked proposal (status → pending)')
    .action(async (id: string) => {
      const config = await loadConfig(process.cwd());
      initDatabase(getDatabaseUrl(config));
      const ok = await approveProposal(parseInt(id, 10));
      console.log(ok ? `Approved task ${id}.` : `Task ${id} not found.`);
      getClient().close();
    });

  cmd.command('reject <id>')
    .description('Reject a proposal')
    .option('--reason <text>', 'Optional reject reason', 'rejected via CLI')
    .action(async (id: string, opts: { reason: string }) => {
      const config = await loadConfig(process.cwd());
      initDatabase(getDatabaseUrl(config));
      const ok = await rejectProposal(parseInt(id, 10), opts.reason);
      console.log(ok ? `Rejected task ${id}.` : `Task ${id} not found.`);
      getClient().close();
    });
}
