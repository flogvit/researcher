import { getDb } from '../../db/connection';
import { chatMessages } from '../../db/schema';
import { eq, asc, desc } from 'drizzle-orm';
import { LLM } from '../../llm/llm';
import { Logger } from '../../core/logger';

/**
 * Session compression: summarize old turns when the in-context history
 * exceeds the budget (Fase 1 #86). Original messages remain in the DB;
 * a compact summary is inserted as role='system' with metadata.compressed=true.
 *
 * Trigger when total characters across the session exceed `tokenBudget`
 * (~1 char ≈ 1 token for English/Norwegian rough estimate; tune later).
 */

const log = new Logger('chat-compress');
const DEFAULT_CHAR_BUDGET = 75_000; // ~75% of 100k token model context
const KEEP_RECENT = 6;              // last N turns stay verbatim

export async function maybeCompressSession(
  llm: LLM,
  sessionId: number,
  charBudget = DEFAULT_CHAR_BUDGET,
): Promise<{ compressed: boolean; summarized?: number }> {
  const db = getDb();
  const all = await db.select().from(chatMessages)
    .where(eq(chatMessages.sessionId, sessionId))
    .orderBy(asc(chatMessages.createdAt));

  const totalChars = all.reduce((n, m) => n + m.content.length, 0);
  if (totalChars < charBudget) return { compressed: false };

  // Already compressed? Skip if we already have a recent compression marker.
  const recentCompression = all.find(m => {
    const meta = m.metadata as { compressed?: boolean } | null;
    return meta?.compressed === true;
  });

  // Take everything older than the last KEEP_RECENT turns
  const cutoff = all.length - KEEP_RECENT;
  if (cutoff <= 0) return { compressed: false };
  const olderThanCutoff = all.slice(0, cutoff);
  if (olderThanCutoff.length === 0) return { compressed: false };

  // If we already have a compression that covers everything before the
  // last KEEP_RECENT, no need to redo.
  if (recentCompression && recentCompression.id >= olderThanCutoff[olderThanCutoff.length - 1].id) {
    return { compressed: false };
  }

  const transcript = olderThanCutoff
    .map(m => `${m.role}: ${m.content}`)
    .join('\n\n');

  const prompt = `Summarize this conversation in 4-8 bullet points. Preserve any persistent facts the user revealed (interests, methodology, goals, sources), key decisions, and open questions. Keep direct quotes ONLY for the user's verbatim instructions.

Conversation:
${transcript}`;

  let summary: string;
  try {
    const response = await llm.call(prompt);
    summary = response.text.trim();
  } catch (e) {
    log.warn(`compression LLM call failed: ${e instanceof Error ? e.message : e}`);
    return { compressed: false };
  }

  await db.insert(chatMessages).values({
    sessionId,
    role: 'system',
    content: `[Compressed summary of ${olderThanCutoff.length} earlier turns]\n${summary}`,
    metadata: {
      compressed: true,
      coveredMessageIds: olderThanCutoff.map(m => m.id),
      coveredChars: olderThanCutoff.reduce((n, m) => n + m.content.length, 0),
    },
  });

  log.info(`compressed ${olderThanCutoff.length} turns of session ${sessionId} (${totalChars} chars)`);
  return { compressed: true, summarized: olderThanCutoff.length };
}
