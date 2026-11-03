CREATE TABLE "agent_runs" (
	"id" serial PRIMARY KEY,
	"agent" text NOT NULL,
	"message_id" integer,
	"task_id" integer,
	"eval_run_id" integer,
	"status" text DEFAULT 'running' NOT NULL,
	"model" text NOT NULL,
	"step_count" integer DEFAULT 0 NOT NULL,
	"input_tokens" integer DEFAULT 0 NOT NULL,
	"output_tokens" integer DEFAULT 0 NOT NULL,
	"output" jsonb,
	"error" text,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "agent_steps" (
	"id" serial PRIMARY KEY,
	"run_id" integer NOT NULL,
	"step_no" integer NOT NULL,
	"kind" text NOT NULL,
	"title" text NOT NULL,
	"detail" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "audit_log" (
	"id" serial PRIMARY KEY,
	"actor" text NOT NULL,
	"action" text NOT NULL,
	"entity" text NOT NULL,
	"entity_id" text,
	"detail" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "automation_runs" (
	"id" serial PRIMARY KEY,
	"automation" text NOT NULL,
	"trigger" text NOT NULL,
	"status" text DEFAULT 'running' NOT NULL,
	"message_id" integer,
	"steps" jsonb DEFAULT '[]' NOT NULL,
	"summary" text,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "corrections" (
	"id" serial PRIMARY KEY,
	"task_id" integer NOT NULL,
	"message_text" text NOT NULL,
	"intent" text NOT NULL,
	"from_role" text NOT NULL,
	"to_role" text NOT NULL,
	"reason" text,
	"corrected_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "eval_runs" (
	"id" serial PRIMARY KEY,
	"status" text DEFAULT 'running' NOT NULL,
	"total" integer NOT NULL,
	"completed" integer DEFAULT 0 NOT NULL,
	"accuracy" real,
	"emergency_recall" real,
	"physician_pct" real,
	"corrections_available" integer DEFAULT 0 NOT NULL,
	"results" jsonb DEFAULT '[]' NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "messages" (
	"id" serial PRIMARY KEY,
	"patient_id" text NOT NULL,
	"portal_type" text NOT NULL,
	"subject" text NOT NULL,
	"body" text NOT NULL,
	"source" text DEFAULT 'portal' NOT NULL,
	"status" text DEFAULT 'received' NOT NULL,
	"is_emergency" boolean DEFAULT false NOT NULL,
	"red_flags" jsonb DEFAULT '[]' NOT NULL,
	"patient_auto_reply" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "notifications" (
	"id" serial PRIMARY KEY,
	"staff_id" text NOT NULL,
	"kind" text NOT NULL,
	"title" text NOT NULL,
	"body" text NOT NULL,
	"task_id" integer,
	"channel" text DEFAULT 'in_app' NOT NULL,
	"email_status" text,
	"read_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "patients" (
	"id" text PRIMARY KEY,
	"name" text NOT NULL,
	"dob" text NOT NULL,
	"sex" text NOT NULL,
	"mrn" text NOT NULL,
	"phone" text NOT NULL,
	"preferred_language" text DEFAULT 'English' NOT NULL,
	"pcp_id" text NOT NULL,
	"ma_id" text NOT NULL,
	"chart" jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "routing_rules" (
	"id" serial PRIMARY KEY,
	"text" text NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"created_by" text DEFAULT 'system' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "settings" (
	"key" text PRIMARY KEY,
	"value" jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "staff" (
	"id" text PRIMARY KEY,
	"name" text NOT NULL,
	"role" text NOT NULL,
	"title" text NOT NULL,
	"email" text NOT NULL,
	"pod" text,
	"available" boolean DEFAULT true NOT NULL,
	"on_duty" boolean DEFAULT true NOT NULL,
	"is_charge_nurse" boolean DEFAULT false NOT NULL,
	"backup_id" text,
	"shift" text DEFAULT '8:00–17:00' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tasks" (
	"id" serial PRIMARY KEY,
	"message_id" integer NOT NULL,
	"intent" text NOT NULL,
	"urgency" text NOT NULL,
	"assigned_role" text NOT NULL,
	"assigned_staff_id" text,
	"original_role" text NOT NULL,
	"reason" text NOT NULL,
	"confidence" real NOT NULL,
	"excerpt" text DEFAULT '' NOT NULL,
	"routed_by" text NOT NULL,
	"needs_review" boolean DEFAULT false NOT NULL,
	"review_note" text,
	"status" text DEFAULT 'open' NOT NULL,
	"priority" integer DEFAULT 0 NOT NULL,
	"sla_due_at" timestamp with time zone NOT NULL,
	"acknowledged_at" timestamp with time zone,
	"acknowledged_by" text,
	"escalation_count" integer DEFAULT 0 NOT NULL,
	"last_escalated_at" timestamp with time zone,
	"prep_status" text DEFAULT 'pending' NOT NULL,
	"prep_brief" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "agent_runs_message_idx" ON "agent_runs" ("message_id");--> statement-breakpoint
CREATE INDEX "agent_steps_run_idx" ON "agent_steps" ("run_id");--> statement-breakpoint
CREATE INDEX "messages_created_idx" ON "messages" ("created_at");--> statement-breakpoint
CREATE INDEX "tasks_message_idx" ON "tasks" ("message_id");--> statement-breakpoint
CREATE INDEX "tasks_role_status_idx" ON "tasks" ("assigned_role","status");