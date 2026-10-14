CREATE TABLE "agent_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"run_id" uuid NOT NULL,
	"seq" integer NOT NULL,
	"type" text NOT NULL,
	"payload" jsonb DEFAULT '{}' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "agent_memories" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"scope" text NOT NULL,
	"owner_id" uuid NOT NULL,
	"key" text NOT NULL,
	"value" jsonb DEFAULT '{}' NOT NULL,
	"summary" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "credit_ledger" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"delta" numeric NOT NULL,
	"kind" text NOT NULL,
	"ref_type" text NOT NULL,
	"ref_id" uuid,
	"balance_after" numeric NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "agent_runs" ADD COLUMN "user_id" uuid NOT NULL;--> statement-breakpoint
ALTER TABLE "agent_runs" ADD COLUMN "conversation_id" uuid;--> statement-breakpoint
ALTER TABLE "agent_runs" ADD COLUMN "input" text NOT NULL;--> statement-breakpoint
ALTER TABLE "agent_runs" ADD COLUMN "plan" jsonb DEFAULT '{}' NOT NULL;--> statement-breakpoint
ALTER TABLE "agent_runs" ADD COLUMN "completed_steps" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "agent_runs" ADD COLUMN "total_steps" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "agent_runs" ADD COLUMN "cost_usd" numeric DEFAULT '0' NOT NULL;--> statement-breakpoint
ALTER TABLE "agent_runs" ADD COLUMN "budget_usd" numeric;--> statement-breakpoint
ALTER TABLE "agent_runs" ADD COLUMN "max_steps" integer DEFAULT 25 NOT NULL;--> statement-breakpoint
ALTER TABLE "agent_runs" ADD COLUMN "attempts" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "agent_runs" ADD COLUMN "idempotency_key" text;--> statement-breakpoint
ALTER TABLE "agent_runs" ADD COLUMN "error" text;--> statement-breakpoint
ALTER TABLE "agent_runs" ADD COLUMN "approval" jsonb;--> statement-breakpoint
ALTER TABLE "agent_runs" ADD COLUMN "claimed_by" text;--> statement-breakpoint
ALTER TABLE "agent_runs" ADD COLUMN "heartbeat_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "agent_runs" ADD COLUMN "started_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "agent_runs" ADD COLUMN "finished_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "agent_steps" ADD COLUMN "title" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "agent_steps" ADD COLUMN "detail" jsonb DEFAULT '{}' NOT NULL;--> statement-breakpoint
ALTER TABLE "agent_steps" ADD COLUMN "error" text;--> statement-breakpoint
ALTER TABLE "agent_steps" ADD COLUMN "tokens_in" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "agent_steps" ADD COLUMN "tokens_out" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "agent_steps" ADD COLUMN "started_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "agent_steps" ADD COLUMN "finished_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "agent_tool_calls" ADD COLUMN "args_hash" text;--> statement-breakpoint
ALTER TABLE "agent_tool_calls" ADD COLUMN "status" text DEFAULT 'pending' NOT NULL;--> statement-breakpoint
ALTER TABLE "agent_tool_calls" ADD COLUMN "error" text;--> statement-breakpoint
ALTER TABLE "agent_tool_calls" ADD COLUMN "duration_ms" integer;--> statement-breakpoint
ALTER TABLE "agent_tool_calls" ADD COLUMN "cost_usd" numeric;--> statement-breakpoint
ALTER TABLE "model_usage" ADD COLUMN "tool" text;--> statement-breakpoint
ALTER TABLE "model_usage" ADD COLUMN "duration_ms" integer;--> statement-breakpoint
ALTER TABLE "usage_quotas" ADD COLUMN "credits_balance" numeric DEFAULT '0' NOT NULL;--> statement-breakpoint
ALTER TABLE "usage_quotas" ADD COLUMN "ai_generations_used" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "usage_quotas" ADD COLUMN "ai_generations_limit" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "usage_quotas" ADD COLUMN "period_month" text;--> statement-breakpoint
ALTER TABLE "usage_quotas" ADD COLUMN "ai_enabled" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "agent_events" ADD CONSTRAINT "agent_events_run_id_agent_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."agent_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credit_ledger" ADD CONSTRAINT "credit_ledger_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "agent_events_run_seq_uidx" ON "agent_events" USING btree ("run_id","seq");--> statement-breakpoint
CREATE INDEX "agent_events_run_seq_idx" ON "agent_events" USING btree ("run_id","seq");--> statement-breakpoint
CREATE UNIQUE INDEX "agent_memories_scope_owner_key_uidx" ON "agent_memories" USING btree ("scope","owner_id","key");--> statement-breakpoint
CREATE INDEX "agent_memories_scope_owner_idx" ON "agent_memories" USING btree ("scope","owner_id");--> statement-breakpoint
CREATE INDEX "credit_ledger_workspace_created_idx" ON "credit_ledger" USING btree ("workspace_id","created_at");--> statement-breakpoint
ALTER TABLE "agent_runs" ADD CONSTRAINT "agent_runs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_runs" ADD CONSTRAINT "agent_runs_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "agent_runs_status_created_idx" ON "agent_runs" USING btree ("status","created_at");--> statement-breakpoint
CREATE INDEX "agent_runs_project_idx" ON "agent_runs" USING btree ("project_id");--> statement-breakpoint
CREATE UNIQUE INDEX "agent_runs_idempotency_key_uidx" ON "agent_runs" USING btree ("idempotency_key");--> statement-breakpoint
CREATE INDEX "agent_steps_run_idx" ON "agent_steps" USING btree ("run_id");--> statement-breakpoint
CREATE INDEX "agent_tool_calls_step_idx" ON "agent_tool_calls" USING btree ("step_id");--> statement-breakpoint
CREATE UNIQUE INDEX "agent_tool_calls_idem_uidx" ON "agent_tool_calls" USING btree ("step_id","tool","args_hash");--> statement-breakpoint
CREATE INDEX "model_usage_run_idx" ON "model_usage" USING btree ("run_id");--> statement-breakpoint
CREATE INDEX "model_usage_model_created_idx" ON "model_usage" USING btree ("model","created_at");