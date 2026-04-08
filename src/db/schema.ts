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
} from 'drizzle-orm/pg-core';

// Task queue for agents
export const agentTasks = pgTable('agent_tasks', {
  id: serial('id').primaryKey(),
  agentType: varchar('agent_type', { length: 100 }).notNull(),
  status: varchar('status', { length: 20 }).notNull().default('pending'),
  priority: integer('priority').notNull().default(0),
  projectId: integer('project_id'),
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
  taskId: integer('task_id'),
  projectId: integer('project_id'),
  finding: text('finding').notNull(),
  evidenceStrength: varchar('evidence_strength', { length: 20 }).notNull(),
  reasoning: text('reasoning').notNull(),
  sources: jsonb('sources').notNull(),
  metadata: jsonb('metadata'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
}, (table) => [
  index('idx_findings_agent').on(table.agentType),
  index('idx_findings_strength').on(table.evidenceStrength),
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
  findingId: integer('finding_id').notNull(),
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
]);

// Documents — downloaded and catalogued research material
// Status pipeline: metadata → downloaded → extracted → classified → embedded
//                  or any stage can fail: failed_download, failed_extract, failed_classify, failed_embed
export const documents = pgTable('documents', {
  id: serial('id').primaryKey(),
  url: text('url'),
  title: text('title').notNull(),
  rawContent: text('raw_content'),                     // Raw downloaded content before text extraction
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
