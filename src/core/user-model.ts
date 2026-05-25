import { getDb } from '../db/connection';
import { peerConclusions, agentTasks } from '../db/schema';
import { and, eq, sql, inArray, desc } from 'drizzle-orm';
import { generateEmbedding } from '../llm/embeddings';
import { Logger } from './logger';

/**
 * UserModel — pluggable peer/user knowledge layer (Fase 1 #78).
 *
 * Borrows from Hermes' memory_manager + Honcho's dialectic peer modeling
 * (see docs/specs/2026-05-24-chat-foundation-design.md). The chat layer
 * talks to this interface, not directly to peer_conclusions, so swapping
 * to a different backend (e.g. Honcho proper) is a single-file change.
 */

export type Scope = 'global' | { project: string };

export function scopeString(s: Scope): string {
  return typeof s === 'string' ? s : `project:${s.project}`;
}

export interface ConversationTurn {
  sessionId: number;
  userMessage: string;
  assistantMessage: string;
  scope: Scope;
}

export interface PeerConclusion {
  id: number;
  scope: string;
  topic: string;
  claim: string;
  confidence: number; // 0..100
  active: boolean;
  createdAt: Date;
}

export interface QueryResult {
  answer: string;
  sources: PeerConclusion[];
}

export interface UserModel {
  /** Enqueue async derivation from a completed turn. Returns immediately. */
  observe(turn: ConversationTurn): Promise<void>;

  /** Synthesize an answer about the user, drawn from active conclusions in scope. */
  query(question: string, scope: Scope): Promise<QueryResult>;

  /** Raw active conclusions for the /me page. */
  conclusions(scope: Scope, opts?: { topic?: string; limit?: number }): Promise<PeerConclusion[]>;

  /** Mark a conclusion inactive (the /me page 'forget' button). */
  forget(id: number, reason?: string): Promise<void>;
}

export class PostgresUserModel implements UserModel {
  private log = new Logger('user-model');

  async observe(turn: ConversationTurn): Promise<void> {
    // Fire-and-forget: enqueue a deriver task. The deriver subsystem
    // consumes admin tasks with type 'admin:deriver_process_turn'.
    const db = getDb();
    await db.insert(agentTasks).values({
      agentType: 'admin:deriver_process_turn',
      status: 'pending',
      priority: 0,
      payload: {
        sessionId: turn.sessionId,
        userMessage: turn.userMessage,
        assistantMessage: turn.assistantMessage,
        scope: scopeString(turn.scope),
      },
    });
  }

  async query(question: string, scope: Scope): Promise<QueryResult> {
    const scopeStr = scopeString(scope);

    let queryVector: number[];
    try {
      queryVector = await generateEmbedding(question);
    } catch (e) {
      this.log.warn(`embedding failed: ${e instanceof Error ? e.message : e}`);
      return { answer: '', sources: [] };
    }

    const db = getDb();
    // Global is always merged; project-scoped queries pull both.
    const candidateScopes = scopeStr === 'global' ? ['global'] : ['global', scopeStr];

    const rows = await db.execute<{ id: number; scope: string; topic: string; claim: string; confidence: number; created_at: Date }>(sql`
      SELECT id, scope, topic, claim, confidence, created_at
      FROM peer_conclusions
      WHERE active = true
        AND scope = ANY(${candidateScopes})
      ORDER BY embedding <=> ${JSON.stringify(queryVector)}::vector
      LIMIT 20
    `);

    const arr = (rows as unknown as { rows?: typeof rows }).rows ?? (Array.isArray(rows) ? rows : []);
    const sources: PeerConclusion[] = (arr as unknown as Array<{ id: number; scope: string; topic: string; claim: string; confidence: number; created_at: Date }>)
      .map(r => ({
        id: r.id,
        scope: r.scope,
        topic: r.topic,
        claim: r.claim,
        confidence: r.confidence,
        active: true,
        createdAt: r.created_at,
      }));

    // Lightweight synthesis: pick top 5 by similarity ordering already.
    // Full LLM synthesis is the chat subsystem's job; here we just return
    // the structured list so the prompt assembler can format it.
    const top = sources.slice(0, 5);
    const answer = top.length === 0
      ? 'No prior conclusions about the user in this scope.'
      : top.map(s => `- (${s.topic}, ${s.confidence}/100) ${s.claim}`).join('\n');

    return { answer, sources: top };
  }

  async conclusions(scope: Scope, opts: { topic?: string; limit?: number } = {}): Promise<PeerConclusion[]> {
    const scopeStr = scopeString(scope);
    const db = getDb();
    const candidateScopes = scopeStr === 'global' ? ['global'] : ['global', scopeStr];
    const limit = opts.limit ?? 100;

    const conditions = [
      eq(peerConclusions.active, true),
      inArray(peerConclusions.scope, candidateScopes),
    ];
    if (opts.topic) conditions.push(eq(peerConclusions.topic, opts.topic));

    const rows = await db
      .select()
      .from(peerConclusions)
      .where(and(...conditions))
      .orderBy(desc(peerConclusions.createdAt))
      .limit(limit);

    return rows.map(r => ({
      id: r.id,
      scope: r.scope,
      topic: r.topic,
      claim: r.claim,
      confidence: r.confidence,
      active: r.active,
      createdAt: r.createdAt,
    }));
  }

  async forget(id: number, reason?: string): Promise<void> {
    const db = getDb();
    await db.update(peerConclusions)
      .set({ active: false, updatedAt: new Date(), evidence: reason ? { forgottenReason: reason } : undefined })
      .where(eq(peerConclusions.id, id));
    this.log.info(`forgot conclusion ${id}${reason ? `: ${reason}` : ''}`);
  }
}

let defaultInstance: UserModel | null = null;

export function getDefaultUserModel(): UserModel {
  if (!defaultInstance) defaultInstance = new PostgresUserModel();
  return defaultInstance;
}
