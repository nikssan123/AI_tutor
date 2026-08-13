ALTER TABLE "learning_session" ADD COLUMN "block_index" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "learning_session" ADD COLUMN "responses" jsonb DEFAULT '[]'::jsonb NOT NULL;