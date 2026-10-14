ALTER TABLE "credit_ledger" ADD COLUMN "reservation_id" uuid;--> statement-breakpoint
CREATE UNIQUE INDEX "credit_ledger_reservation_uidx" ON "credit_ledger" USING btree ("reservation_id");