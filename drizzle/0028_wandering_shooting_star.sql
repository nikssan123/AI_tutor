ALTER TABLE "project" ADD COLUMN "evidence" jsonb DEFAULT '{"image":"none","images":1}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "project" DROP COLUMN "evidence_type";
