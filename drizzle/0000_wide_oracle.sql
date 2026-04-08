CREATE TABLE "agent_state" (
	"id" serial PRIMARY KEY NOT NULL,
	"agent_type" varchar(100) NOT NULL,
	"state" jsonb NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "agent_state_agent_type_unique" UNIQUE("agent_type")
);
--> statement-breakpoint
CREATE TABLE "agent_tasks" (
	"id" serial PRIMARY KEY NOT NULL,
	"agent_type" varchar(100) NOT NULL,
	"status" varchar(20) DEFAULT 'pending' NOT NULL,
	"priority" integer DEFAULT 0 NOT NULL,
	"payload" jsonb NOT NULL,
	"result" jsonb,
	"error" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"started_at" timestamp,
	"completed_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "discoveries" (
	"id" serial PRIMARY KEY NOT NULL,
	"finding_id" integer NOT NULL,
	"title" text NOT NULL,
	"claim" text NOT NULL,
	"evidence_strength" varchar(20) NOT NULL,
	"status" varchar(30) DEFAULT 'pending_verification' NOT NULL,
	"literature_search" jsonb,
	"domain_review" jsonb,
	"novelty_assessment" text,
	"paper" text,
	"paper_status" varchar(20),
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "documents" (
	"id" serial PRIMARY KEY NOT NULL,
	"url" text,
	"title" text NOT NULL,
	"raw_content" text,
	"content" text,
	"content_type" varchar(50) NOT NULL,
	"language" varchar(10) DEFAULT 'en',
	"source_plugin" varchar(50) NOT NULL,
	"tags" jsonb,
	"topics" jsonb,
	"relevant_approaches" jsonb,
	"domain_metadata" jsonb,
	"quality_score" integer,
	"peer_reviewed" varchar(20),
	"source_credibility" varchar(20),
	"author" text,
	"publication_year" integer,
	"summary" text,
	"status" varchar(30) DEFAULT 'metadata' NOT NULL,
	"scouted_at" timestamp DEFAULT now() NOT NULL,
	"downloaded_at" timestamp,
	"extracted_at" timestamp,
	"classified_at" timestamp,
	"embedded_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "embeddings" (
	"id" serial PRIMARY KEY NOT NULL,
	"source_type" varchar(50) NOT NULL,
	"source_id" integer,
	"content" text NOT NULL,
	"embedding" vector(768),
	"metadata" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "findings" (
	"id" serial PRIMARY KEY NOT NULL,
	"agent_type" varchar(100) NOT NULL,
	"task_id" integer,
	"finding" text NOT NULL,
	"evidence_strength" varchar(20) NOT NULL,
	"reasoning" text NOT NULL,
	"sources" jsonb NOT NULL,
	"metadata" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "research_log" (
	"id" serial PRIMARY KEY NOT NULL,
	"event_type" varchar(50) NOT NULL,
	"agent_type" varchar(100),
	"details" jsonb NOT NULL,
	"tokens_used" integer,
	"model" varchar(100),
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "idx_tasks_status" ON "agent_tasks" USING btree ("status");--> statement-breakpoint
CREATE INDEX "idx_tasks_agent_type" ON "agent_tasks" USING btree ("agent_type");--> statement-breakpoint
CREATE INDEX "idx_discoveries_status" ON "discoveries" USING btree ("status");--> statement-breakpoint
CREATE INDEX "idx_documents_status" ON "documents" USING btree ("status");--> statement-breakpoint
CREATE INDEX "idx_documents_type" ON "documents" USING btree ("content_type");--> statement-breakpoint
CREATE INDEX "idx_documents_plugin" ON "documents" USING btree ("source_plugin");--> statement-breakpoint
CREATE INDEX "idx_embeddings_source" ON "embeddings" USING btree ("source_type","source_id");--> statement-breakpoint
CREATE INDEX "idx_findings_agent" ON "findings" USING btree ("agent_type");--> statement-breakpoint
CREATE INDEX "idx_findings_strength" ON "findings" USING btree ("evidence_strength");--> statement-breakpoint
CREATE INDEX "idx_log_event" ON "research_log" USING btree ("event_type");--> statement-breakpoint
CREATE INDEX "idx_log_created" ON "research_log" USING btree ("created_at");