CREATE TABLE "pack_build" (
	"slug" text PRIMARY KEY NOT NULL,
	"subject" text NOT NULL,
	"requested_by" text,
	"status" text DEFAULT 'building' NOT NULL,
	"detail" text,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "pack_build" ADD CONSTRAINT "pack_build_requested_by_user_id_fk" FOREIGN KEY ("requested_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "pack_build_status_idx" ON "pack_build" USING btree ("status","started_at");