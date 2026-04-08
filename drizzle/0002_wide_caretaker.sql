CREATE TABLE "review_feedback" (
	"id" serial PRIMARY KEY NOT NULL,
	"discovery_id" integer NOT NULL,
	"paper_title" text NOT NULL,
	"verdict" varchar(20) NOT NULL,
	"quality" varchar(20),
	"strengths" jsonb,
	"weaknesses" jsonb,
	"required_revisions" jsonb,
	"agents_used" jsonb,
	"processed_by_learner" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
