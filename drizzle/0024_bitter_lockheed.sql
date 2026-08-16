CREATE TABLE "curriculum_build" (
	"goal_id" uuid PRIMARY KEY NOT NULL,
	"status" text DEFAULT 'building' NOT NULL,
	"stage" text,
	"detail" text,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "curriculum_build" ADD CONSTRAINT "curriculum_build_goal_id_learning_goal_id_fk" FOREIGN KEY ("goal_id") REFERENCES "public"."learning_goal"("id") ON DELETE cascade ON UPDATE no action;