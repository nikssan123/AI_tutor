CREATE TABLE "goal_intake" (
	"user_id" text PRIMARY KEY NOT NULL,
	"messages" jsonb NOT NULL,
	"captured" jsonb,
	"chips" jsonb,
	"clarity" real DEFAULT 0 NOT NULL,
	"done" boolean DEFAULT false NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "goal_intake" ADD CONSTRAINT "goal_intake_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;