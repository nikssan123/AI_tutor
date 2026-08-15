CREATE TABLE "pack_resource" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"pack_id" uuid NOT NULL,
	"slug" text NOT NULL,
	"url" text NOT NULL,
	"title" text NOT NULL,
	"publisher" text NOT NULL,
	"kind" text NOT NULL,
	"skill_ids" jsonb NOT NULL,
	"assessment" text NOT NULL,
	"published_at" text,
	"checked_at" timestamp with time zone,
	"reachable" boolean DEFAULT true NOT NULL
);
--> statement-breakpoint
ALTER TABLE "pack_resource" ADD CONSTRAINT "pack_resource_pack_id_domain_pack_id_fk" FOREIGN KEY ("pack_id") REFERENCES "public"."domain_pack"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "pack_resource_pack_slug_idx" ON "pack_resource" USING btree ("pack_id","slug");--> statement-breakpoint
CREATE INDEX "pack_resource_checked_idx" ON "pack_resource" USING btree ("checked_at");