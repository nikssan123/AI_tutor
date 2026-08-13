DROP INDEX "spend_ledger_user_period_idx";--> statement-breakpoint
CREATE UNIQUE INDEX "spend_ledger_user_period_idx" ON "spend_ledger" USING btree ("user_id","period");