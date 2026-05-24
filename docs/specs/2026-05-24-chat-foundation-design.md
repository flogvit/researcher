# Chat Foundation — Design (Fase 1)

**Status:** Draft for review
**Date:** 2026-05-24
**Author:** Brainstormed with Claude (model: claude-opus-4-7)
**Related milestone:** [Fase 1 — Chat Foundation](https://github.com/flogvit/researcher/milestone/2)
**Issues this spec covers:** #77–#86

---

## 1. Motivation

Researcher is autonomous today: subsystems run on a clock, dispatch tasks, write to the DB, and the user observes results via the dashboard. There is no conversation surface, and the only "learning" is the system learning from its own outputs (`src/core/learner.ts`).

The user wants a research assistant they can **talk to**, that **learns who they are** over time. Concrete goals:

- A conversation surface (web + CLI) where the user discusses research, asks about state, and briefs the system on what to change.
- A persistent user model that improves across sessions — the assistant should know preferences, interests, methodology, writing style, goals, trusted sources.
- A foundation that supports later phases: brief-mode (assistant takes actions on the user's behalf, Fase 2) and proactive notifications across multiple channels (Fase 3).

Fase 1 is the **foundation**: reactive chat + UserModel + introspection page. No action-taking yet (that's Fase 2). No outbound notifications (that's Fase 3).

## 2. Design influences

The architecture borrows three patterns from [Hermes Agent](https://github.com/NousResearch/hermes-agent) and [Honcho](https://github.com/plastic-labs/honcho):

1. **Pluggable memory with lifecycle hooks** (Hermes `memory_manager`): the chat layer talks to a `UserModel` interface with `observe(turn)` and `query(question)` methods. We can swap implementations without touching the chat code.

2. **Dialectic peer modeling** (Honcho): instead of typed user fields, we store free-text "conclusions" tagged with a coarse topic, with confidence and supersedes chains. New evidence refines or contradicts old conclusions instead of overwriting them.

3. **Separation of read and write paths** (Hermes "deriver" worker): the chat turn doesn't wait for memory derivation. `observe` enqueues an admin task; a background deriver subsystem processes turns asynchronously, calling an LLM to extract new conclusions. The chat read-path (`query`) is fast pgvector similarity + LLM synthesis.

We do **not** adopt Honcho's full schema (Workspace → Peer → Session → Message with `(observer, observed)` collection keying) — that's overkill for a single-user system. Our `peer_conclusions(scope, topic, claim, embedding)` is the simplified equivalent.

## 3. Architecture

```
┌────────────────────────────────────────────────────────────────┐
│ Surfaces (clients)                                              │
│  ├── Web UI: /chat panel in Next.js admin app                   │
│  └── CLI: `researcher chat` (interactive + one-shot)            │
└────────────────────────────────────────────────────────────────┘
                            ↕  SSE for streaming, REST for state
┌────────────────────────────────────────────────────────────────┐
│ Chat API (`web/app/api/chat/*`, `web/app/api/me/*`)             │
│  POST /api/chat/send          (SSE)                             │
│  GET/POST /api/chat/sessions                                    │
│  GET /api/chat/sessions/:id                                     │
│  GET /api/me                  (list peer conclusions)           │
│  POST /api/me/query           (natural-language UserModel query)│
└────────────────────────────────────────────────────────────────┘
                            ↕
┌────────────────────────────────────────────────────────────────┐
│ Chat subsystem (`src/subsystems/chat/`)                         │
│  ├── conversation.ts   handleTurn(sessionId, msg) → AsyncIter   │
│  ├── context-builder.ts assemble system + memory + history      │
│  ├── compression.ts    summarize old turns when over budget     │
│  └── prompts: research/prompts/agents/chat.md                   │
│                                                                  │
│  Tools (read-only in Fase 1):                                    │
│    query_findings, query_documents, query_discoveries,           │
│    query_user_model                                              │
└────────────────────────────────────────────────────────────────┘
                            ↕
┌────────────────────────────────────────────────────────────────┐
│ UserModel interface (`src/core/user-model.ts`)                   │
│  observe(turn) — async, enqueues deriver:process_turn            │
│  query(question, scope) — pgvector + LLM synthesis               │
│  conclusions(ctx) — raw list for /me page                        │
│                                                                  │
│ PostgresUserModel impl (`src/core/user-model/postgres.ts`)       │
└────────────────────────────────────────────────────────────────┘
                            ↕
┌────────────────────────────────────────────────────────────────┐
│ Deriver subsystem (`src/subsystems/deriver/`)                   │
│  Consumes deriver:process_turn admin tasks.                     │
│  For each turn: load context → LLM extracts {add, refine,       │
│  supersede} → mutate peer_conclusions accordingly.              │
└────────────────────────────────────────────────────────────────┘
                            ↕
┌────────────────────────────────────────────────────────────────┐
│ Persistence (Postgres + pgvector — extends existing schema)     │
│  chat_sessions, chat_messages                                   │
│  peer_conclusions (with embedding, supersedes chain, scope)     │
│  notification_subscriptions (schema only; used in Fase 3)       │
│  agent_tasks (existing; deriver uses it as queue)               │
└────────────────────────────────────────────────────────────────┘
```

## 4. Components

### 4.1 Schema additions (issue #77)

Four new tables. Detailed DDL in #77. Key points:

- `chat_sessions(id, scope, title, started_at, last_turn_at)` — one row per conversation. `scope` is `'global'` or `'project:<name>'`.
- `chat_messages(id, session_id, role, content, metadata jsonb, created_at)` — turns. `metadata` carries tool calls, token counts, channel.
- `peer_conclusions(id, scope, topic, claim, evidence jsonb, embedding vector(768), confidence real, supersedes int, active bool, …)` — the user model. Indexed by `(scope, active)` partial + ivfflat on embedding.
- `notification_subscriptions(id, channel, config jsonb, filters jsonb, enabled bool)` — empty in Fase 1; schema added now so Fase 3 is purely additive.

The pgvector index uses `ivfflat` with `lists=50` initially. Will be revisited per-data once we have real volume (issue #36 has the broader ANN-index discussion).

### 4.2 UserModel interface (issue #78)

```ts
// src/core/user-model.ts
export type Scope = 'global' | { project: string };

export interface UserModel {
  observe(turn: ConversationTurn): Promise<void>;
  query(question: string, scope: Scope): Promise<{
    answer: string;
    sources: PeerConclusion[];
  }>;
  conclusions(ctx: ConclusionContext): Promise<PeerConclusion[]>;
}
```

`PostgresUserModel` implements this. The interface boundary is the whole point: if we later prefer Honcho, we ship `HonchoUserModel` and swap. No chat code changes.

### 4.3 Deriver subsystem (issue #79)

A new subsystem registered alongside library/research/discovery/paper. Picks up `deriver:process_turn` admin tasks. For each turn:

1. Load context: last 5 turns of the same session + nearest 10 conclusions by embedding similarity.
2. LLM call with structured-output prompt (uses `callJSON` — depends on bug fix #18 landing first or guarded).
3. Returns `{add: [{topic, claim, confidence}], refine: [{id, newClaim, reason}], supersede: [{id, reason}]}`.
4. Apply: embed new claims (Ollama), insert; for refines, insert with `supersedes` pointer and deactivate old; for supersedes, set `active=false`.

Default model: Ollama (cheap, runs always). Configurable to Claude per agent config for higher-quality extraction. Frequency: per-turn initially; batched (every-N-turns) is a later optimization if cost dominates.

### 4.4 Chat subsystem (issue #80)

`handleTurn(sessionId, userMessage): AsyncIterator<chunk>` is the core loop:

1. Load session + recent messages.
2. Call `userModel.query(userMessage, session.scope)` to retrieve relevant conclusions.
3. Assemble prompt (next section).
4. Stream LLM response. Accumulate full text.
5. Persist user message + assistant message.
6. Fire-and-forget `userModel.observe({sessionId, userMessage, assistantMessage, scope})`.

### 4.5 Context assembly (part of #80)

Following Hermes' streaming-safe pattern:

```
<system-prompt>You are a research assistant for Vegard...</system-prompt>

<memory-context>
[The following is recalled memory context. Do NOT echo to the user.]
- Vegard prefers Norwegian responses
- Focus area: comparative study of Septuagint and Masoretic text
- Tends to favor close-reading methodology over statistical
- Currently writing a paper on textual variants in the Twelve Prophets
</memory-context>

<conversation>
[last N turns, truncated oldest-first if over budget]
</conversation>

<user>{current message}</user>
```

The `<memory-context>` block is a sentinel the model is instructed never to reproduce verbatim. A **streaming-context scrubber** (a small state machine on the SSE output) discards any output that falls inside `<memory-context>...</memory-context>` tags, even when chunked across SSE frames. This is non-negotiable: prompt-injection in memory content must never reach the user channel.

### 4.6 Chat API (issue #81)

SSE for streaming, REST for everything else. All routes auth-gated (depends on security fix #1 being prerequisite). Format:

```
data: {"type":"chunk","content":"Hei Vegard,"}\n\n
data: {"type":"tool_call","tool":"query_findings","args":{...}}\n\n
data: {"type":"tool_result","tool":"query_findings","result":[...]}\n\n
data: {"type":"done","turnId":42}\n\n
```

On client disconnect mid-stream: assistant content accumulated so far is still persisted (so reconnect shows it).

### 4.7 Web UI (issue #82)

Route `/chat`. Two-pane: session list + message thread. Composer at bottom (Cmd-Enter to send). Scope toggle at top (global / project). Tool calls render as collapsible cards inline. Markdown rendering. Cmd/Ctrl-K opens a quick-chat sidebar from any page.

### 4.8 CLI (issue #83)

`researcher chat` interactive REPL. `researcher chat "..."` one-shot. `--scope`, `--session`, `--list-sessions` flags. Slash commands inside the REPL: `/help /scope /sessions /new /quit`. Auth token from `.researcher-state.json` or `RESEARCHER_TOKEN` env.

### 4.9 Hybrid persistence config (issue #85)

`researcher.json` extends with:

```json
{
  "chat": {
    "globalUserModel": true,
    "scopeOverride": null
  }
}
```

When `globalUserModel: true` (default), `UserModel.query` for a project scope merges global + project conclusions (project ranks higher on ties). The deriver also has a "promote to global" rule for high-confidence project conclusions (configurable threshold). Opt-out via `scopeOverride: 'project-only'`.

### 4.10 Session compression (issue #86)

When tokens exceed threshold, drop oldest K turns from the in-context prompt and replace with an LLM-generated summary stored as a `role='system'` message with `metadata.compressed=true`. Original turns remain in DB and visible in UI history. The deriver still sees the original full content.

### 4.11 /me page (issue #84)

Read-only. Lists active conclusions for current scope, grouped by topic, with confidence bars and last-updated timestamps. Each entry links back to its originating chat turn. A "forget this" button enqueues a `deriver:forget` task that creates a counter-conclusion (the dialectic equivalent of deletion). No field editing — corrections happen through chat.

## 5. Data flow

### 5.1 Turn happy path (read-write sequence)

```
User types message in /chat
  │
  ├─→ POST /api/chat/send {sessionId, message, scope}
  │     │
  │     ├─→ persist user message
  │     │
  │     ├─→ UserModel.query(message, scope)
  │     │     ├─→ embed(message)
  │     │     ├─→ pgvector cosine search on peer_conclusions
  │     │     │     filtered by scope (with global merged)
  │     │     ├─→ LLM synthesizes "context paragraph"
  │     │     └─→ return {answer, sources}
  │     │
  │     ├─→ assemble prompt (system + memory-context + history + user)
  │     │
  │     ├─→ stream LLM response
  │     │     ├─→ tool calls execute (query_findings etc.)
  │     │     ├─→ scrubber strips <memory-context> from stream
  │     │     └─→ SSE chunks → client
  │     │
  │     ├─→ persist assistant message (full text)
  │     │
  │     └─→ fire-and-forget UserModel.observe({...})
  │           │
  │           └─→ enqueue admin task 'deriver:process_turn'
  │                 │
  │                 [returns; client done]
  │                 │
  │                 ↓ (later, in deriver subsystem)
  │                 ├─→ load context
  │                 ├─→ LLM extracts {add, refine, supersede}
  │                 ├─→ embed new claims
  │                 └─→ mutate peer_conclusions
```

### 5.2 Scope merge for query

For `scope = {project: 'bibel-forskning'}` with `globalUserModel: true`:

```sql
SELECT * FROM peer_conclusions
WHERE active = TRUE
  AND scope IN ('global', 'project:bibel-forskning')
ORDER BY embedding <=> $queryVector
LIMIT 20
```

Then a re-rank pass prefers `project:*` over `global` on ties, and the LLM synthesizer is told both about the scope of each source.

### 5.3 Dialectic update flow

User says: "Faktisk er jeg ikke så opptatt av Septuaginta lenger — jeg fokuserer på Targumene."

Deriver sees the new turn, queries similar conclusions, finds:
- `claim`: "Vegard is focused on Septuagint vs Masoretic comparison" (confidence 0.85)
- `claim`: "Vegard prefers close-reading methodology" (confidence 0.7)

LLM returns:
```json
{
  "supersede": [
    {"id": 42, "reason": "User explicitly shifted focus away from Septuagint"}
  ],
  "add": [
    {"topic": "interests", "claim": "Vegard focuses on Targumic literature", "confidence": 0.7}
  ]
}
```

The Septuagint conclusion is set `active=false`. A new Targumic conclusion is inserted. `/me` page reflects the change on next load.

## 6. Error handling

| Failure | Behavior |
|---|---|
| LLM CLI hangs during chat turn | Timeout (configurable, default 60s). User sees `{type:"error","message":"Assistant timed out"}` SSE frame. Partial response persisted. Depends on fix #16 (Bun.spawn timeouts). |
| Deriver fails on a turn | Admin task marked `failed` with error. Other turns continue; user model misses that turn. No retry initially (retry policy is a future tweak). |
| pgvector query times out | UserModel.query returns empty `sources`, LLM proceeds without memory context. User sees a degraded but functional response. |
| User disconnects mid-stream | Assistant message accumulated so far is persisted (server keeps streaming the LLM and writing). Reconnect shows the in-progress content. |
| Ollama embedding model returns wrong dim | Reject the insert, log error, **don't** mark anything failed permanently (avoid the embedder antipattern in #29). |
| Scope mismatch (project that doesn't exist) | Return 404 from API. |
| Auth missing on Chat API | 401, no body. Same gate as the rest of the admin surface (depends on #1). |
| memory-context tag leaks past scrubber | Test fixture catches it. If it ever happens in prod: the streaming-context scrubber bug is treated as P0 — it's a prompt-injection escape. |

## 7. Testing strategy

| Component | Test types |
|---|---|
| Schema | Migration runs clean on fresh + upgraded DB. |
| UserModel | Unit: scope merging, embedding query shape. Integration: full observe→derive→query round-trip against test DB. |
| Deriver | Unit: each of add/refine/supersede mutations. Fixture: 10-turn conversation produces a reasonable conclusion set (snapshot test). |
| Chat subsystem | Unit: context assembly with various history lengths (token budget enforcement). Unit: streaming-context scrubber across split chunks. |
| Compression | Fixture: 30-turn session compresses correctly, summary preserves intent. |
| Chat API | E2E: SSE stream completes; partial save on disconnect; auth rejection. |
| Web UI | Manual + Playwright smoke: open chat, send message, see streaming response, scope toggle persists. |
| CLI | Manual: interactive + one-shot work; auth via env. |
| /me page | Manual: lists conclusions, forget button works. |

Critical tests that must exist before we ship:
- **Streaming-context scrubber** — adversarial inputs with tags split across chunks. This is the prompt-injection containment.
- **Dialectic chain integrity** — supersedes pointer correct; active flag correct; no orphan chains.
- **Scope merge** — global + project queries return both; opt-out projects never touch global.

## 8. Dependencies on other issues

These should land before or during Fase 1 implementation:

| Dependency | Why |
|---|---|
| #1 (auth on admin API) | Chat API must not be unauthenticated. We extend the same auth model. |
| #18 (callJSON greedy regex) | Deriver uses callJSON. Without the fix, structured-output extraction will corrupt silently. |
| #14, #15 (task race + recovery) | Deriver consumes admin tasks; the queue must be sound. |
| #36 (pgvector ANN index pattern) | peer_conclusions has the same ANN-index need as embeddings. Same approach. |
| #51 (queue partition) | Deriver tasks (`deriver:*`) must not be picked up by research dispatcher. |
| #54 (admin task handler registry) | Cleaner extension surface; deriver registers handlers via the same registry. |

We can ship Fase 1 without all of these resolved (workarounds noted in each issue), but the security ones (#1) really should be done first.

## 9. Out of scope (Fase 2+)

- Intent classification (sparring/brief/fortolker) — Fase 2
- Action-taking from chat (write tools, admin task enqueue with risk-mode) — Fase 2
- Proposal queue UI — Fase 2
- Proactive notifications, event bus, channel plugins — Fase 3
- Multi-user (this is a single-user system; UserModel = Vegard)
- Honcho integration — designed-for but not built; future swap if motivated

## 10. Open questions

1. **Default deriver model.** Ollama is cheap and always available, but extraction quality is worse than Claude. Should we ship with Claude default and let users downgrade? Or Ollama default for cost and let users upgrade? — Decision: Ollama default for cost (researcher already runs Ollama for embeddings; adding a chat model is one config step). Document the trade-off clearly.

2. **Conclusion topic taxonomy.** We seed with `'interests' | 'style' | 'goals' | 'sources' | 'misc'`. Is this enough, or should the deriver invent new topics? — Decision: start with a closed set + `misc`. If `misc` grows past N%, revisit.

3. **Promote-to-global threshold.** When does a project-scoped conclusion get promoted to global? Confidence > 0.9 + observed in N project sessions? — Decision: defer to implementation. Default high (0.95, observed-in-2-sessions). Tuneable in config.

4. **Compression threshold.** 80% of context window? 50%? — Decision: 75%, tuneable. With Claude Opus 4.7 (200k context, used here) this is rarely hit; relevant for smaller models.

5. **CLI auth UX.** First-time CLI run with no token — do we run a login flow? Or document `RESEARCHER_TOKEN=$(researcher token print)` style? — Decision: simple env var first, login flow if friction proves real.

## 11. Files we expect to create or modify

**New:**
- `src/core/user-model.ts`
- `src/core/user-model/postgres.ts`
- `src/subsystems/chat/index.ts`
- `src/subsystems/chat/conversation.ts`
- `src/subsystems/chat/context-builder.ts`
- `src/subsystems/chat/compression.ts`
- `src/subsystems/chat/scrubber.ts`
- `src/subsystems/deriver/index.ts`
- `src/subsystems/deriver/dispatcher.ts`
- `src/subsystems/deriver/extractor.ts`
- `src/commands/chat.ts`
- `research/prompts/agents/chat.md`
- `research/prompts/agents/deriver.md`
- `web/app/chat/page.tsx`
- `web/app/chat/components/{SessionList,MessageThread,Composer}.tsx`
- `web/app/chat/hooks/useStreamingChat.ts`
- `web/app/me/page.tsx`
- `web/app/api/chat/send/route.ts`
- `web/app/api/chat/sessions/route.ts`
- `web/app/api/chat/sessions/[id]/route.ts`
- `web/app/api/me/route.ts`
- `web/app/api/me/query/route.ts`
- `web/app/api/me/forget/route.ts`
- new migration in `drizzle/`

**Modify:**
- `src/db/schema.ts` (add 4 tables)
- `src/cli.ts` (register chat command, register deriver subsystem in status)
- `src/core/subsystem-manager.ts` and/or `src/core/orchestrator.ts` (register deriver + chat)
- `src/core/upgrade.ts` (handle migration for existing projects)
- `src/config.ts` (add `chat` config section)

## 12. Rollout

Fase 1 lands via the standard upgrade path. Existing projects run `researcher upgrade`:

1. Migration adds the four tables.
2. New `chat` section is appended to `researcher.json` with defaults (the existing `deepMergeDefaults` in `src/core/upgrade.ts` handles this — note its crash-safety issue in #20 is a prereq for safe rollout).
3. Subsystem registry gains `chat` and `deriver` (both default-enabled; subsystem-manager already supports stop/start from the dashboard if user wants to turn them off).
4. Web UI gets `/chat` and `/me` routes; existing pages unchanged.

Existing functionality is unaffected. Users discover chat via the new nav entry.

---

## Appendix: References

- Hermes Agent: https://github.com/NousResearch/hermes-agent
- Honcho: https://github.com/plastic-labs/honcho
- agentskills.io standard: https://agentskills.io
- pgvector indexing guide: https://github.com/pgvector/pgvector
