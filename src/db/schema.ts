import {
  pgTable,
  serial,
  text,
  timestamp,
  jsonb,
  integer,
  varchar,
  index,
  vector,
  boolean,
  customType,
} from 'drizzle-orm/pg-core';

const bytea = customType<{ data: Buffer; driverData: Buffer }>({
  dataType() { return 'bytea'; },
});

// Forward declarations resolved at module init — projects is defined below
// but the agentTasks FK references it. Drizzle handles the cycle via the
// arrow function in references().

// Task queue for agents
export const agentTasks = pgTable('agent_tasks', {
  id: serial('id').primaryKey(),
  agentType: varchar('agent_type', { length: 100 }).notNull(),
  status: varchar('status', { length: 20 }).notNull().default('pending'),
  priority: integer('priority').notNull().default(0),
  projectId: integer('project_id').references((): any => projects.id, { onDelete: 'cascade' }),
  payload: jsonb('payload').notNull(),
  result: jsonb('result'),
  error: text('error'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  startedAt: timestamp('started_at'),
  completedAt: timestamp('completed_at'),
}, (table) => [
  index('idx_tasks_status').on(table.status),
  index('idx_tasks_agent_type').on(table.agentType),
  index('idx_tasks_project').on(table.projectId),
]);

// Research findings — immutable append-only log of everything discovered
export const findings = pgTable('findings', {
  id: serial('id').primaryKey(),
  agentType: varchar('agent_type', { length: 100 }).notNull(),
  taskId: integer('task_id').references((): any => agentTasks.id, { onDelete: 'set null' }),
  projectId: integer('project_id').references((): any => projects.id, { onDelete: 'cascade' }),
  finding: text('finding').notNull(),
  evidenceStrength: varchar('evidence_strength', { length: 20 }).notNull(),
  reasoning: text('reasoning').notNull(),
  sources: jsonb('sources').notNull(),
  metadata: jsonb('metadata'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
}, (table) => [
  index('idx_findings_agent').on(table.agentType),
  index('idx_findings_strength').on(table.evidenceStrength),
  index('findings_project_id_idx').on(table.projectId),
]);

// Immutable event log — everything that happens, never deleted
export const researchLog = pgTable('research_log', {
  id: serial('id').primaryKey(),
  eventType: varchar('event_type', { length: 50 }).notNull(),
  agentType: varchar('agent_type', { length: 100 }),
  details: jsonb('details').notNull(),
  tokensUsed: integer('tokens_used'),
  model: varchar('model', { length: 100 }),
  createdAt: timestamp('created_at').notNull().defaultNow(),
}, (table) => [
  index('idx_log_event').on(table.eventType),
  index('idx_log_created').on(table.createdAt),
]);

// Agent state — for graceful shutdown/restart
export const agentState = pgTable('agent_state', {
  id: serial('id').primaryKey(),
  agentType: varchar('agent_type', { length: 100 }).notNull().unique(),
  state: jsonb('state').notNull(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
});

// Discoveries — potentially unique findings that go through verification pipeline
export const discoveries = pgTable('discoveries', {
  id: serial('id').primaryKey(),
  // Migration 0006 relaxed this to nullable so ON DELETE SET NULL is legal.
  findingId: integer('finding_id').references(() => findings.id, { onDelete: 'set null' }),
  title: text('title').notNull(),
  claim: text('claim').notNull(),
  evidenceStrength: varchar('evidence_strength', { length: 20 }).notNull(),
  status: varchar('status', { length: 30 }).notNull().default('pending_verification'),
  literatureSearch: jsonb('literature_search'),
  domainReview: jsonb('domain_review'),
  noveltyAssessment: text('novelty_assessment'),
  paper: text('paper'),
  paperStatus: varchar('paper_status', { length: 20 }),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
}, (table) => [
  index('idx_discoveries_status').on(table.status),
  index('discoveries_finding_id_idx').on(table.findingId),
]);

// Embeddings for RAG — semantic search across all knowledge
export const embeddings = pgTable('embeddings', {
  id: serial('id').primaryKey(),
  sourceType: varchar('source_type', { length: 50 }).notNull(), // 'finding', 'document', 'method'
  sourceId: integer('source_id'),
  content: text('content').notNull(),
  embedding: vector('embedding', { dimensions: 768 }),  // nomic-embed-text dimension
  metadata: jsonb('metadata'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
}, (table) => [
  index('idx_embeddings_source').on(table.sourceType, table.sourceId),
  // ANN index added in 0003_performance_indexes migration. Drizzle's vector
  // index DSL is limited; declared here so drizzle-kit generate doesn't try
  // to re-create it.
  index('embeddings_vec_cosine_idx').using('ivfflat', table.embedding.op('vector_cosine_ops')),
]);

// Documents — downloaded and catalogued research material
// Status pipeline: metadata → downloaded → extracted → classified → embedded
//                  or any stage can fail: failed_download, failed_extract, failed_classify, failed_embed
export const documents = pgTable('documents', {
  id: serial('id').primaryKey(),
  url: text('url'),
  title: text('title').notNull(),
  rawContent: text('raw_content'),                     // HTML/text downloaded content
  rawBytes: bytea('raw_bytes'),                         // PDF (and other binary) bytes — replaces base64 in raw_content (#24, #39)
  content: text('content'),                            // Extracted text content
  contentType: varchar('content_type', { length: 50 }).notNull(), // 'article', 'book_chapter', 'encyclopedia', 'methodology', etc.
  language: varchar('language', { length: 10 }).default('en'),
  sourcePlugin: varchar('source_plugin', { length: 50 }).notNull(), // Which source plugin added this document
  // Cataloguing metadata (filled by cataloguer agent)
  tags: jsonb('tags'),                                 // ['hermeneutics', 'textual-criticism', ...]
  topics: jsonb('topics'),                             // ['covenant theology', 'hesed', ...]
  relevantApproaches: jsonb('relevant_approaches'),    // ['grounded-theory', 'discourse-analysis']
  domainMetadata: jsonb('domain_metadata'),            // Domain-specific classification data
  qualityScore: integer('quality_score'),              // 1-5, set by cataloguer
  peerReviewed: varchar('peer_reviewed', { length: 20 }),  // 'yes', 'no', 'unknown'
  sourceCredibility: varchar('source_credibility', { length: 20 }), // 'academic', 'encyclopedia', 'popular', 'blog', 'unknown'
  author: text('author'),
  publicationYear: integer('publication_year'),
  summary: text('summary'),                            // Cataloguer's summary
  status: varchar('status', { length: 30 }).notNull().default('metadata'), // see pipeline above
  scoutedAt: timestamp('scouted_at').notNull().defaultNow(),
  downloadedAt: timestamp('downloaded_at'),
  extractedAt: timestamp('extracted_at'),
  classifiedAt: timestamp('classified_at'),
  embeddedAt: timestamp('embedded_at'),
}, (table) => [
  index('idx_documents_status').on(table.status),
  index('idx_documents_type').on(table.contentType),
  index('idx_documents_plugin').on(table.sourcePlugin),
  index('documents_url_idx').on(table.url),
  index('documents_title_idx').on(table.title),
  index('documents_scouted_at_idx').on(table.scoutedAt.desc()),
]);

// Research projects — focused research on a specific topic
// Phases: literature_search → literature_review → identify_gaps → research → paper
export const projects = pgTable('projects', {
  id: serial('id').primaryKey(),
  title: text('title').notNull(),
  description: text('description'),
  status: varchar('status', { length: 20 }).notNull().default('active'),
  phase: varchar('phase', { length: 30 }).notNull().default('literature_search'),
  workers: integer('workers').notNull().default(2),
  literatureReview: text('literature_review'),
  identifiedGaps: jsonb('identified_gaps'),
  findingsCount: integer('findings_count').notNull().default(0),
  paperDraft: text('paper_draft'),
  paperStatus: varchar('paper_status', { length: 20 }),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
});

// Review feedback — accumulated paper review results for learning loop
export const reviewFeedback = pgTable('review_feedback', {
  id: serial('id').primaryKey(),
  discoveryId: integer('discovery_id').notNull(),
  paperTitle: text('paper_title').notNull(),
  verdict: varchar('verdict', { length: 20 }).notNull(),
  quality: varchar('quality', { length: 20 }),
  strengths: jsonb('strengths'),
  weaknesses: jsonb('weaknesses'),
  requiredRevisions: jsonb('required_revisions'),
  agentsUsed: jsonb('agents_used'),
  processedByLearner: boolean('processed_by_learner').notNull().default(false),
  createdAt: timestamp('created_at').notNull().defaultNow(),
}, (table) => [
  index('review_feedback_processed_idx').on(table.processedByLearner),
]);

// ─── Chat Foundation (Fase 1, #77) ──────────────────────────────────────────

export const chatSessions = pgTable('chat_sessions', {
  id: serial('id').primaryKey(),
  scope: varchar('scope', { length: 100 }).notNull().default('global'),
  title: text('title'),
  startedAt: timestamp('started_at').notNull().defaultNow(),
  lastTurnAt: timestamp('last_turn_at').notNull().defaultNow(),
}, (table) => [
  index('chat_sessions_scope_idx').on(table.scope),
  index('chat_sessions_last_turn_idx').on(table.lastTurnAt.desc()),
]);

export const chatMessages = pgTable('chat_messages', {
  id: serial('id').primaryKey(),
  sessionId: integer('session_id').notNull().references(() => chatSessions.id, { onDelete: 'cascade' }),
  role: varchar('role', { length: 20 }).notNull(),
  content: text('content').notNull(),
  metadata: jsonb('metadata'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
}, (table) => [
  index('chat_messages_session_idx').on(table.sessionId, table.createdAt),
]);

export const peerConclusions = pgTable('peer_conclusions', {
  id: serial('id').primaryKey(),
  scope: varchar('scope', { length: 100 }).notNull().default('global'),
  topic: varchar('topic', { length: 50 }).notNull(),
  claim: text('claim').notNull(),
  evidence: jsonb('evidence'),
  embedding: vector('embedding', { dimensions: 768 }),
  confidence: integer('confidence').notNull().default(50), // 0-100 (stored as int to keep schema simple)
  supersedes: integer('supersedes'),
  active: boolean('active').notNull().default(true),
  sourceSessionId: integer('source_session_id').references(() => chatSessions.id, { onDelete: 'set null' }),
  sourceMessageId: integer('source_message_id').references(() => chatMessages.id, { onDelete: 'set null' }),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
}, (table) => [
  index('peer_conclusions_active_idx').on(table.scope, table.active),
  index('peer_conclusions_topic_idx').on(table.topic),
  index('peer_conclusions_vec_idx').using('ivfflat', table.embedding.op('vector_cosine_ops')),
]);

export const notificationSubscriptions = pgTable('notification_subscriptions', {
  id: serial('id').primaryKey(),
  channel: varchar('channel', { length: 50 }).notNull(),
  config: jsonb('config').notNull(),
  filters: jsonb('filters'),
  enabled: boolean('enabled').notNull().default(true),
  createdAt: timestamp('created_at').notNull().defaultNow(),
}, (table) => [
  index('notification_subscriptions_enabled_idx').on(table.enabled),
]);
