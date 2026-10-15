ALTER TABLE "campaigns" ADD COLUMN IF NOT EXISTS "brief" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "campaigns" ADD COLUMN IF NOT EXISTS "audience" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "campaigns" ADD COLUMN IF NOT EXISTS "deliverables" jsonb DEFAULT '[]' NOT NULL;
