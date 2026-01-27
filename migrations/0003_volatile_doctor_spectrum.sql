CREATE TABLE "chapter_versions" (
	"id" serial PRIMARY KEY NOT NULL,
	"chapter_id" integer NOT NULL,
	"project_id" integer NOT NULL,
	"version_number" integer NOT NULL,
	"content" text NOT NULL,
	"change_reason" text,
	"created_at" timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE "consistency_violations" (
	"id" serial PRIMARY KEY NOT NULL,
	"project_id" integer NOT NULL,
	"chapter_number" integer NOT NULL,
	"violation_type" text NOT NULL,
	"severity" text DEFAULT 'major' NOT NULL,
	"description" text NOT NULL,
	"affected_entities" jsonb DEFAULT '[]'::jsonb,
	"broken_rule_id" integer,
	"was_auto_fixed" boolean DEFAULT false NOT NULL,
	"fix_description" text,
	"created_at" timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE "editing_queue" (
	"id" serial PRIMARY KEY NOT NULL,
	"project_id" integer NOT NULL,
	"chapter_id" integer NOT NULL,
	"chapter_number" integer NOT NULL,
	"issue_type" text NOT NULL,
	"severity" text DEFAULT 'medium' NOT NULL,
	"instruction" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"created_at" timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE "entity_relationships" (
	"id" serial PRIMARY KEY NOT NULL,
	"project_id" integer NOT NULL,
	"subject_id" integer NOT NULL,
	"target_id" integer NOT NULL,
	"relation_type" text NOT NULL,
	"meta" jsonb DEFAULT '{}'::jsonb,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"updated_at" timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE "plot_threads" (
	"id" serial PRIMARY KEY NOT NULL,
	"project_id" integer NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"goal" text,
	"status" text DEFAULT 'active' NOT NULL,
	"intensity_score" integer DEFAULT 5,
	"last_updated_chapter" integer DEFAULT 0,
	"created_at" timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE "reedit_issues" (
	"id" serial PRIMARY KEY NOT NULL,
	"project_id" integer NOT NULL,
	"chapter_number" integer NOT NULL,
	"category" text NOT NULL,
	"severity" text DEFAULT 'mayor' NOT NULL,
	"description" text NOT NULL,
	"text_citation" text,
	"correction_instruction" text,
	"source" text DEFAULT 'qa' NOT NULL,
	"review_cycle" integer DEFAULT 0,
	"status" text DEFAULT 'pending' NOT NULL,
	"resolved_at" timestamp,
	"rejection_reason" text,
	"issue_hash" text,
	"created_at" timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE "world_entities" (
	"id" serial PRIMARY KEY NOT NULL,
	"project_id" integer NOT NULL,
	"name" text NOT NULL,
	"type" text NOT NULL,
	"attributes" jsonb DEFAULT '{}'::jsonb,
	"last_seen_chapter" integer,
	"status" text DEFAULT 'active' NOT NULL,
	"created_at" timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"updated_at" timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE "world_rules" (
	"id" serial PRIMARY KEY NOT NULL,
	"project_id" integer NOT NULL,
	"rule_description" text NOT NULL,
	"category" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"source_chapter" integer,
	"created_at" timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
ALTER TABLE "ai_usage_events" ADD COLUMN "translation_id" integer;--> statement-breakpoint
ALTER TABLE "chapters" ADD COLUMN "scene_breakdown" jsonb;--> statement-breakpoint
ALTER TABLE "chapters" ADD COLUMN "summary" text;--> statement-breakpoint
ALTER TABLE "chapters" ADD COLUMN "editor_feedback" jsonb;--> statement-breakpoint
ALTER TABLE "chapters" ADD COLUMN "quality_score" integer;--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "pipeline_version" text DEFAULT 'v1';--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "beta_reader_report" jsonb;--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "beta_reader_score" integer;--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "commercial_viability" text;--> statement-breakpoint
ALTER TABLE "reedit_chapters" ADD COLUMN "original_index" integer;--> statement-breakpoint
ALTER TABLE "reedit_chapters" ADD COLUMN "final_index" integer;--> statement-breakpoint
ALTER TABLE "reedit_chapters" ADD COLUMN "summary" text;--> statement-breakpoint
ALTER TABLE "reedit_chapters" ADD COLUMN "action_type" text DEFAULT 'KEEP_AND_POLISH';--> statement-breakpoint
ALTER TABLE "reedit_chapters" ADD COLUMN "insert_prompt" text;--> statement-breakpoint
ALTER TABLE "reedit_chapters" ADD COLUMN "merge_with_next" boolean DEFAULT false;--> statement-breakpoint
ALTER TABLE "reedit_chapters" ADD COLUMN "anachronisms_found" jsonb DEFAULT '[]'::jsonb;--> statement-breakpoint
ALTER TABLE "reedit_projects" ADD COLUMN "setting_context" text;--> statement-breakpoint
ALTER TABLE "reedit_projects" ADD COLUMN "forensic_audit_result" jsonb;--> statement-breakpoint
ALTER TABLE "reedit_projects" ADD COLUMN "beta_reader_report" jsonb;--> statement-breakpoint
ALTER TABLE "reedit_projects" ADD COLUMN "beta_reader_score" integer;--> statement-breakpoint
ALTER TABLE "reedit_projects" ADD COLUMN "commercial_viability" text;--> statement-breakpoint
ALTER TABLE "reedit_projects" ADD COLUMN "structural_report" jsonb;--> statement-breakpoint
ALTER TABLE "reedit_projects" ADD COLUMN "reconstruction_plan" jsonb;--> statement-breakpoint
ALTER TABLE "reedit_projects" ADD COLUMN "plan_approved" boolean DEFAULT false;--> statement-breakpoint
ALTER TABLE "reedit_projects" ADD COLUMN "chapter_correction_counts" jsonb DEFAULT '{}'::jsonb;--> statement-breakpoint
ALTER TABLE "reedit_projects" ADD COLUMN "chapter_change_history" jsonb DEFAULT '{}'::jsonb;--> statement-breakpoint
ALTER TABLE "translations" ADD COLUMN "thinking_tokens" integer DEFAULT 0;--> statement-breakpoint
ALTER TABLE "translations" ADD COLUMN "glossary" jsonb DEFAULT '{}'::jsonb;--> statement-breakpoint
ALTER TABLE "translations" ADD COLUMN "typographical_rules" text;--> statement-breakpoint
ALTER TABLE "translations" ADD COLUMN "tone_instructions" text;--> statement-breakpoint
ALTER TABLE "translations" ADD COLUMN "layout_score" integer DEFAULT 0;--> statement-breakpoint
ALTER TABLE "translations" ADD COLUMN "naturalness_score" integer DEFAULT 0;--> statement-breakpoint
ALTER TABLE "translations" ADD COLUMN "current_chunk" integer DEFAULT 0;--> statement-breakpoint
ALTER TABLE "translations" ADD COLUMN "total_chunks" integer DEFAULT 0;--> statement-breakpoint
ALTER TABLE "chapter_versions" ADD CONSTRAINT "chapter_versions_chapter_id_chapters_id_fk" FOREIGN KEY ("chapter_id") REFERENCES "public"."chapters"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chapter_versions" ADD CONSTRAINT "chapter_versions_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "consistency_violations" ADD CONSTRAINT "consistency_violations_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "consistency_violations" ADD CONSTRAINT "consistency_violations_broken_rule_id_world_rules_id_fk" FOREIGN KEY ("broken_rule_id") REFERENCES "public"."world_rules"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "editing_queue" ADD CONSTRAINT "editing_queue_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "editing_queue" ADD CONSTRAINT "editing_queue_chapter_id_chapters_id_fk" FOREIGN KEY ("chapter_id") REFERENCES "public"."chapters"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "entity_relationships" ADD CONSTRAINT "entity_relationships_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "entity_relationships" ADD CONSTRAINT "entity_relationships_subject_id_world_entities_id_fk" FOREIGN KEY ("subject_id") REFERENCES "public"."world_entities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "entity_relationships" ADD CONSTRAINT "entity_relationships_target_id_world_entities_id_fk" FOREIGN KEY ("target_id") REFERENCES "public"."world_entities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plot_threads" ADD CONSTRAINT "plot_threads_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reedit_issues" ADD CONSTRAINT "reedit_issues_project_id_reedit_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."reedit_projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "world_entities" ADD CONSTRAINT "world_entities_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "world_rules" ADD CONSTRAINT "world_rules_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_usage_events" ADD CONSTRAINT "ai_usage_events_translation_id_translations_id_fk" FOREIGN KEY ("translation_id") REFERENCES "public"."translations"("id") ON DELETE cascade ON UPDATE no action;