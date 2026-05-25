import type { Command } from 'commander';
import { loadConfig, getDatabaseUrl } from '../config';
import { initDatabase } from '../db/connection';
import { initEmbeddingConfig } from '../llm/embeddings';
import { createSession, getSessionMessages, handleTurn, listSessions } from '../subsystems/chat/conversation';

/**
 * `researcher chat` — interactive REPL + one-shot modes (Fase 1 #83).
 *
 * Two modes:
 *   researcher chat            interactive REPL
 *   researcher chat "..."      one-shot, prints assistant response
 *
 * Flags:
 *   --scope global|project:<name>
 *   --session <id>
 *   --list-sessions
 */
export function registerChatCommand(program: Command): void {
  program
    .command('chat [message]')
    .description('Talk to the research assistant (interactive REPL or one-shot)')
    .option('--scope <scope>', 'Session scope ("global" or "project:<name>")', 'global')
    .option('--session <id>', 'Continue an existing session by id')
    .option('--list-sessions', 'List recent sessions and exit')
    .action(async (message: string | undefined, opts: { scope: string; session?: string; listSessions?: boolean }) => {
      const projectDir = process.cwd();
      const config = await loadConfig(projectDir);
      initDatabase(getDatabaseUrl(config));
      initEmbeddingConfig(config);

      if (opts.listSessions) {
        const sessions = await listSessions(opts.scope);
        if (sessions.length === 0) {
          console.log(`No sessions in scope "${opts.scope}" yet.`);
          return;
        }
        for (const s of sessions) {
          console.log(`  [${s.id}] ${s.title ?? '(untitled)'} — ${s.scope} — ${new Date(s.lastTurnAt).toLocaleString()}`);
        }
        return;
      }

      const sessionId = opts.session
        ? parseInt(opts.session, 10)
        : await createSession(opts.scope);

      if (message) {
        const result = await handleTurn(config, sessionId, message);
        process.stdout.write(result.assistant + '\n');
        return;
      }

      // Interactive REPL
      const readline = await import('node:readline/promises');
      const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
      console.log(`Session ${sessionId} (${opts.scope}). Type /quit to exit, /sessions to list, /new for a new session.`);

      try {
        let activeSession = sessionId;
        while (true) {
          const line = (await rl.question('> ')).trim();
          if (!line) continue;
          if (line === '/quit' || line === '/exit') break;
          if (line === '/sessions') {
            const sessions = await listSessions(opts.scope);
            for (const s of sessions) {
              console.log(`  [${s.id}] ${s.title ?? '(untitled)'} — ${new Date(s.lastTurnAt).toLocaleString()}`);
            }
            continue;
          }
          if (line === '/new') {
            activeSession = await createSession(opts.scope);
            console.log(`New session: ${activeSession}`);
            continue;
          }
          if (line.startsWith('/scope ')) {
            opts.scope = line.slice('/scope '.length).trim();
            console.log(`Scope: ${opts.scope}`);
            continue;
          }
          try {
            const result = await handleTurn(config, activeSession, line);
            console.log(`\n${result.assistant}\n`);
          } catch (e) {
            console.error(`Error: ${e instanceof Error ? e.message : e}`);
          }
        }
      } finally {
        rl.close();
      }
    });
}
