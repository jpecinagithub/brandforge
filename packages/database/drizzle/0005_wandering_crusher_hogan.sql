CREATE UNIQUE INDEX IF NOT EXISTS "campaigns_project_uidx" ON "campaigns" USING btree ("project_id");
