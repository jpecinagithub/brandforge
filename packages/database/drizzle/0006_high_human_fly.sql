ALTER TABLE "landing_pages" ADD COLUMN IF NOT EXISTS "public_id" uuid;--> statement-breakpoint
ALTER TABLE "landing_pages" ADD COLUMN IF NOT EXISTS "published_at" timestamp with time zone;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "landing_pages_public_id_uidx" ON "landing_pages" USING btree ("public_id");
