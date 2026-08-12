CREATE TABLE "account" (
	"id" text PRIMARY KEY NOT NULL,
	"account_id" text NOT NULL,
	"provider_id" text NOT NULL,
	"user_id" text NOT NULL,
	"access_token" text,
	"refresh_token" text,
	"id_token" text,
	"access_token_expires_at" timestamp with time zone,
	"refresh_token_expires_at" timestamp with time zone,
	"scope" text,
	"password" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "session" (
	"id" text PRIMARY KEY NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"token" text NOT NULL,
	"ip_address" text,
	"user_agent" text,
	"user_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"email_verified" boolean DEFAULT false NOT NULL,
	"image" text,
	"handle" text,
	"locale" text DEFAULT 'en' NOT NULL,
	"timezone" text DEFAULT 'UTC' NOT NULL,
	"plan" text DEFAULT 'free' NOT NULL,
	"stripe_customer_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "verification" (
	"id" text PRIMARY KEY NOT NULL,
	"identifier" text NOT NULL,
	"value" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "learner_profile" (
	"user_id" text PRIMARY KEY NOT NULL,
	"weekly_hours" real DEFAULT 3 NOT NULL,
	"preferred_session_length" real DEFAULT 30 NOT NULL,
	"learning_style_prefs" jsonb,
	"constraints" jsonb,
	"motivation" text,
	"notification_prefs" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "learning_goal" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"pack_id" uuid,
	"raw_goal_text" text NOT NULL,
	"goal_spec" jsonb,
	"target_outcome" text,
	"deadline" date,
	"status" text DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "domain_pack" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"taxonomy_parent" text,
	"maturity" text NOT NULL,
	"eval_tier" integer NOT NULL,
	"workspace" text NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"quality_score" real,
	"reviewed_by" text,
	"reviewed_at" timestamp with time zone,
	"evaluator_config" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "learner_skill_mastery" (
	"user_id" text NOT NULL,
	"skill_id" uuid NOT NULL,
	"mastery" double precision NOT NULL,
	"confidence" double precision NOT NULL,
	"evidence_count" integer DEFAULT 0 NOT NULL,
	"last_observed_at" timestamp with time zone,
	"last_practiced_at" timestamp with time zone,
	"decay_half_life_days" real DEFAULT 7 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "learner_skill_mastery_user_id_skill_id_pk" PRIMARY KEY("user_id","skill_id")
);
--> statement-breakpoint
CREATE TABLE "skill" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"pack_id" uuid NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"description" text NOT NULL,
	"level" text NOT NULL,
	"eval_tier" integer NOT NULL,
	"estimated_hours" real NOT NULL,
	"bkt_priors" jsonb NOT NULL,
	"can_do_statement" text NOT NULL,
	"observable_evidence" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "skill_dependency" (
	"from_skill_id" uuid NOT NULL,
	"to_skill_id" uuid NOT NULL,
	"type" text NOT NULL,
	"strength" real DEFAULT 1 NOT NULL,
	CONSTRAINT "skill_dependency_from_skill_id_to_skill_id_pk" PRIMARY KEY("from_skill_id","to_skill_id")
);
--> statement-breakpoint
CREATE TABLE "curriculum" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"goal_id" uuid NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"generated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"validator_report" jsonb,
	"status" text DEFAULT 'draft' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "curriculum_module" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"curriculum_id" uuid NOT NULL,
	"order" integer NOT NULL,
	"title" text NOT NULL,
	"target_skill_ids" jsonb NOT NULL,
	"estimated_hours" real NOT NULL,
	"output_artifact_type" text NOT NULL,
	"acceptance_criteria" jsonb,
	"rubric_id" uuid
);
--> statement-breakpoint
CREATE TABLE "exercise" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"skill_id" uuid NOT NULL,
	"prompt" text NOT NULL,
	"support_level" text DEFAULT 'independent' NOT NULL,
	"evidence_type" text NOT NULL,
	"rubric_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "learning_plan" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"goal_id" uuid NOT NULL,
	"planned_for" date NOT NULL,
	"session_spec" jsonb NOT NULL,
	"reason" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "learning_session" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"goal_id" uuid NOT NULL,
	"plan_id" uuid,
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"blocks" jsonb NOT NULL,
	"duration_minutes" real,
	"self_reported_difficulty" integer
);
--> statement-breakpoint
CREATE TABLE "lesson" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"skill_id" uuid NOT NULL,
	"level" text NOT NULL,
	"style_hash" text NOT NULL,
	"content" jsonb NOT NULL,
	"prompt_version" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "artifact" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"submission_id" uuid NOT NULL,
	"type" text NOT NULL,
	"storage_ref" text NOT NULL,
	"size_bytes" integer,
	"metadata" jsonb,
	"truncated" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE "assessment" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"goal_id" uuid,
	"kind" text DEFAULT 'diagnostic' NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone,
	"anonymous_id" text
);
--> statement-breakpoint
CREATE TABLE "assessment_item" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"pack_id" uuid NOT NULL,
	"skill_id" uuid NOT NULL,
	"slug" text NOT NULL,
	"type" text NOT NULL,
	"prompt" text NOT NULL,
	"options" jsonb,
	"answer_key" jsonb,
	"difficulty" double precision NOT NULL,
	"discrimination" double precision DEFAULT 1 NOT NULL,
	"times_served" integer DEFAULT 0 NOT NULL,
	"times_correct" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "assessment_result" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"assessment_id" uuid NOT NULL,
	"user_id" text,
	"item_id" uuid NOT NULL,
	"response" text,
	"correct" boolean,
	"partial" double precision,
	"confidence" double precision,
	"theta_estimate" double precision,
	"time_spent_seconds" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "evaluation" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"submission_id" uuid NOT NULL,
	"rubric_id" uuid NOT NULL,
	"rubric_version" integer NOT NULL,
	"overall_score" double precision NOT NULL,
	"confidence" double precision NOT NULL,
	"eval_tier" integer NOT NULL,
	"criterion_results" jsonb NOT NULL,
	"strengths" jsonb,
	"gaps" jsonb,
	"next_actions" jsonb,
	"proven_by" jsonb,
	"model_used" text NOT NULL,
	"prompt_version" text NOT NULL,
	"verifier_passed" boolean NOT NULL,
	"deterministic_checks" jsonb,
	"human_reviewed" boolean DEFAULT false NOT NULL,
	"disputed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "mastery_update" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"skill_id" uuid NOT NULL,
	"evaluation_id" uuid,
	"assessment_result_id" uuid,
	"prior_mastery" double precision NOT NULL,
	"posterior_mastery" double precision NOT NULL,
	"delta" double precision NOT NULL,
	"observation_confidence" double precision NOT NULL,
	"evidence_tier" integer NOT NULL,
	"reason" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "project" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"pack_id" uuid NOT NULL,
	"slug" text NOT NULL,
	"title" text NOT NULL,
	"brief" text NOT NULL,
	"rubric_id" uuid NOT NULL,
	"evidence_type" text NOT NULL,
	"difficulty" double precision NOT NULL,
	"target_skill_ids" jsonb NOT NULL,
	"acceptance_criteria" jsonb,
	"estimated_minutes" integer NOT NULL,
	"is_public" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE "retrieval_queue_item" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"skill_id" uuid NOT NULL,
	"item_id" uuid,
	"due_at" timestamp with time zone NOT NULL,
	"last_served_at" timestamp with time zone,
	"success_streak" integer DEFAULT 0 NOT NULL,
	"interval_days" real DEFAULT 7 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "rubric" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"pack_id" uuid NOT NULL,
	"slug" text NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"criteria" jsonb NOT NULL,
	"is_public" boolean DEFAULT true NOT NULL
);
--> statement-breakpoint
CREATE TABLE "submission" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"project_id" uuid,
	"exercise_id" uuid,
	"submitted_at" timestamp with time zone DEFAULT now() NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "agent_run" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text,
	"agent_name" text NOT NULL,
	"prompt_version" text NOT NULL,
	"model" text NOT NULL,
	"input" jsonb,
	"output" jsonb,
	"status" text NOT NULL,
	"cost_cents" real,
	"latency_ms" integer,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "feedback" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"target_type" text NOT NULL,
	"target_id" text NOT NULL,
	"rating" integer,
	"comment" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "interaction" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"session_id" uuid,
	"role" text NOT NULL,
	"content" text NOT NULL,
	"tokens_in" integer,
	"tokens_out" integer,
	"cache_read_tokens" integer,
	"model" text,
	"cost_cents" real,
	"latency_ms" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "misconception" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"skill_id" uuid NOT NULL,
	"description" text NOT NULL,
	"first_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"resolved_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "progress" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"goal_id" uuid NOT NULL,
	"week" text NOT NULL,
	"hours_logged" real DEFAULT 0 NOT NULL,
	"skills_advanced" integer DEFAULT 0 NOT NULL,
	"artifacts_produced" integer DEFAULT 0 NOT NULL,
	"retention_score" real
);
--> statement-breakpoint
CREATE TABLE "resource" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"url" text NOT NULL,
	"title" text NOT NULL,
	"type" text NOT NULL,
	"domain_authority" integer,
	"published_at" timestamp with time zone,
	"verified_at" timestamp with time zone,
	"skill_ids" jsonb,
	"quality_note" text,
	"embedding" vector(1536)
);
--> statement-breakpoint
CREATE TABLE "spend_ledger" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"period" text NOT NULL,
	"cost_cents" real DEFAULT 0 NOT NULL,
	"evaluations_used" integer DEFAULT 0 NOT NULL,
	"degraded" boolean DEFAULT false NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "faq" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"page_id" uuid NOT NULL,
	"question" text NOT NULL,
	"answer" text NOT NULL,
	"order" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE "internal_link" (
	"from_page_id" uuid NOT NULL,
	"to_page_id" uuid NOT NULL,
	"link_type" text NOT NULL,
	"anchor_text" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "learning_topic" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"skill_ids" jsonb,
	"related_topic_ids" jsonb,
	"search_intent" text,
	"estimated_hours" real
);
--> statement-breakpoint
CREATE TABLE "public_learning_path" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"goal_id" uuid NOT NULL,
	"slug" text NOT NULL,
	"visibility" text DEFAULT 'private' NOT NULL,
	"gate_passed" boolean DEFAULT false NOT NULL,
	"view_count" integer DEFAULT 0 NOT NULL,
	"redactions" jsonb,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "search_intent" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"keyword" text NOT NULL,
	"volume_band" text,
	"difficulty_band" text,
	"serp_type" text,
	"target_page_id" uuid,
	"verified_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "seo_page" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" text NOT NULL,
	"page_type" text NOT NULL,
	"locale" text DEFAULT 'en' NOT NULL,
	"title" text NOT NULL,
	"meta_description" text NOT NULL,
	"h1" text NOT NULL,
	"sections" jsonb NOT NULL,
	"quality_score" real,
	"indexable" boolean DEFAULT false NOT NULL,
	"published_at" timestamp with time zone,
	"last_reviewed_at" timestamp with time zone,
	"reviewed_by" text,
	"canonical_of" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "account" ADD CONSTRAINT "account_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session" ADD CONSTRAINT "session_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "learner_profile" ADD CONSTRAINT "learner_profile_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "learning_goal" ADD CONSTRAINT "learning_goal_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "learning_goal" ADD CONSTRAINT "learning_goal_pack_id_domain_pack_id_fk" FOREIGN KEY ("pack_id") REFERENCES "public"."domain_pack"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "learner_skill_mastery" ADD CONSTRAINT "learner_skill_mastery_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "learner_skill_mastery" ADD CONSTRAINT "learner_skill_mastery_skill_id_skill_id_fk" FOREIGN KEY ("skill_id") REFERENCES "public"."skill"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "skill" ADD CONSTRAINT "skill_pack_id_domain_pack_id_fk" FOREIGN KEY ("pack_id") REFERENCES "public"."domain_pack"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "skill_dependency" ADD CONSTRAINT "skill_dependency_from_skill_id_skill_id_fk" FOREIGN KEY ("from_skill_id") REFERENCES "public"."skill"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "skill_dependency" ADD CONSTRAINT "skill_dependency_to_skill_id_skill_id_fk" FOREIGN KEY ("to_skill_id") REFERENCES "public"."skill"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "curriculum" ADD CONSTRAINT "curriculum_goal_id_learning_goal_id_fk" FOREIGN KEY ("goal_id") REFERENCES "public"."learning_goal"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "curriculum_module" ADD CONSTRAINT "curriculum_module_curriculum_id_curriculum_id_fk" FOREIGN KEY ("curriculum_id") REFERENCES "public"."curriculum"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exercise" ADD CONSTRAINT "exercise_skill_id_skill_id_fk" FOREIGN KEY ("skill_id") REFERENCES "public"."skill"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "learning_plan" ADD CONSTRAINT "learning_plan_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "learning_plan" ADD CONSTRAINT "learning_plan_goal_id_learning_goal_id_fk" FOREIGN KEY ("goal_id") REFERENCES "public"."learning_goal"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "learning_session" ADD CONSTRAINT "learning_session_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "learning_session" ADD CONSTRAINT "learning_session_goal_id_learning_goal_id_fk" FOREIGN KEY ("goal_id") REFERENCES "public"."learning_goal"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "learning_session" ADD CONSTRAINT "learning_session_plan_id_learning_plan_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."learning_plan"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lesson" ADD CONSTRAINT "lesson_skill_id_skill_id_fk" FOREIGN KEY ("skill_id") REFERENCES "public"."skill"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "artifact" ADD CONSTRAINT "artifact_submission_id_submission_id_fk" FOREIGN KEY ("submission_id") REFERENCES "public"."submission"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assessment" ADD CONSTRAINT "assessment_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assessment" ADD CONSTRAINT "assessment_goal_id_learning_goal_id_fk" FOREIGN KEY ("goal_id") REFERENCES "public"."learning_goal"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assessment_item" ADD CONSTRAINT "assessment_item_pack_id_domain_pack_id_fk" FOREIGN KEY ("pack_id") REFERENCES "public"."domain_pack"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assessment_item" ADD CONSTRAINT "assessment_item_skill_id_skill_id_fk" FOREIGN KEY ("skill_id") REFERENCES "public"."skill"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assessment_result" ADD CONSTRAINT "assessment_result_assessment_id_assessment_id_fk" FOREIGN KEY ("assessment_id") REFERENCES "public"."assessment"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assessment_result" ADD CONSTRAINT "assessment_result_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assessment_result" ADD CONSTRAINT "assessment_result_item_id_assessment_item_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."assessment_item"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evaluation" ADD CONSTRAINT "evaluation_submission_id_submission_id_fk" FOREIGN KEY ("submission_id") REFERENCES "public"."submission"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evaluation" ADD CONSTRAINT "evaluation_rubric_id_rubric_id_fk" FOREIGN KEY ("rubric_id") REFERENCES "public"."rubric"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mastery_update" ADD CONSTRAINT "mastery_update_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mastery_update" ADD CONSTRAINT "mastery_update_skill_id_skill_id_fk" FOREIGN KEY ("skill_id") REFERENCES "public"."skill"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mastery_update" ADD CONSTRAINT "mastery_update_evaluation_id_evaluation_id_fk" FOREIGN KEY ("evaluation_id") REFERENCES "public"."evaluation"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mastery_update" ADD CONSTRAINT "mastery_update_assessment_result_id_assessment_result_id_fk" FOREIGN KEY ("assessment_result_id") REFERENCES "public"."assessment_result"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project" ADD CONSTRAINT "project_pack_id_domain_pack_id_fk" FOREIGN KEY ("pack_id") REFERENCES "public"."domain_pack"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project" ADD CONSTRAINT "project_rubric_id_rubric_id_fk" FOREIGN KEY ("rubric_id") REFERENCES "public"."rubric"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "retrieval_queue_item" ADD CONSTRAINT "retrieval_queue_item_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "retrieval_queue_item" ADD CONSTRAINT "retrieval_queue_item_skill_id_skill_id_fk" FOREIGN KEY ("skill_id") REFERENCES "public"."skill"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "retrieval_queue_item" ADD CONSTRAINT "retrieval_queue_item_item_id_assessment_item_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."assessment_item"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rubric" ADD CONSTRAINT "rubric_pack_id_domain_pack_id_fk" FOREIGN KEY ("pack_id") REFERENCES "public"."domain_pack"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "submission" ADD CONSTRAINT "submission_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "submission" ADD CONSTRAINT "submission_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "submission" ADD CONSTRAINT "submission_exercise_id_exercise_id_fk" FOREIGN KEY ("exercise_id") REFERENCES "public"."exercise"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_run" ADD CONSTRAINT "agent_run_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "feedback" ADD CONSTRAINT "feedback_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "interaction" ADD CONSTRAINT "interaction_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "interaction" ADD CONSTRAINT "interaction_session_id_learning_session_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."learning_session"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "misconception" ADD CONSTRAINT "misconception_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "misconception" ADD CONSTRAINT "misconception_skill_id_skill_id_fk" FOREIGN KEY ("skill_id") REFERENCES "public"."skill"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "progress" ADD CONSTRAINT "progress_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "progress" ADD CONSTRAINT "progress_goal_id_learning_goal_id_fk" FOREIGN KEY ("goal_id") REFERENCES "public"."learning_goal"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "spend_ledger" ADD CONSTRAINT "spend_ledger_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "faq" ADD CONSTRAINT "faq_page_id_seo_page_id_fk" FOREIGN KEY ("page_id") REFERENCES "public"."seo_page"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "internal_link" ADD CONSTRAINT "internal_link_from_page_id_seo_page_id_fk" FOREIGN KEY ("from_page_id") REFERENCES "public"."seo_page"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "internal_link" ADD CONSTRAINT "internal_link_to_page_id_seo_page_id_fk" FOREIGN KEY ("to_page_id") REFERENCES "public"."seo_page"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "public_learning_path" ADD CONSTRAINT "public_learning_path_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "public_learning_path" ADD CONSTRAINT "public_learning_path_goal_id_learning_goal_id_fk" FOREIGN KEY ("goal_id") REFERENCES "public"."learning_goal"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "search_intent" ADD CONSTRAINT "search_intent_target_page_id_seo_page_id_fk" FOREIGN KEY ("target_page_id") REFERENCES "public"."seo_page"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "session_token_idx" ON "session" USING btree ("token");--> statement-breakpoint
CREATE UNIQUE INDEX "user_email_idx" ON "user" USING btree ("email");--> statement-breakpoint
CREATE UNIQUE INDEX "user_handle_idx" ON "user" USING btree ("handle");--> statement-breakpoint
CREATE UNIQUE INDEX "domain_pack_slug_idx" ON "domain_pack" USING btree ("slug");--> statement-breakpoint
CREATE INDEX "learner_skill_mastery_user_idx" ON "learner_skill_mastery" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "skill_pack_slug_idx" ON "skill" USING btree ("pack_id","slug");--> statement-breakpoint
CREATE INDEX "skill_dependency_to_idx" ON "skill_dependency" USING btree ("to_skill_id");--> statement-breakpoint
CREATE UNIQUE INDEX "curriculum_module_order_idx" ON "curriculum_module" USING btree ("curriculum_id","order");--> statement-breakpoint
CREATE UNIQUE INDEX "learning_plan_user_goal_day_idx" ON "learning_plan" USING btree ("user_id","goal_id","planned_for");--> statement-breakpoint
CREATE INDEX "learning_session_user_idx" ON "learning_session" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "lesson_cache_idx" ON "lesson" USING btree ("skill_id","level","style_hash");--> statement-breakpoint
CREATE UNIQUE INDEX "assessment_item_pack_slug_idx" ON "assessment_item" USING btree ("pack_id","slug");--> statement-breakpoint
CREATE INDEX "assessment_item_skill_idx" ON "assessment_item" USING btree ("skill_id");--> statement-breakpoint
CREATE INDEX "assessment_result_assessment_idx" ON "assessment_result" USING btree ("assessment_id");--> statement-breakpoint
CREATE INDEX "evaluation_submission_idx" ON "evaluation" USING btree ("submission_id");--> statement-breakpoint
CREATE INDEX "mastery_update_user_skill_idx" ON "mastery_update" USING btree ("user_id","skill_id");--> statement-breakpoint
CREATE UNIQUE INDEX "project_pack_slug_idx" ON "project" USING btree ("pack_id","slug");--> statement-breakpoint
CREATE INDEX "retrieval_queue_due_idx" ON "retrieval_queue_item" USING btree ("user_id","due_at");--> statement-breakpoint
CREATE UNIQUE INDEX "rubric_pack_slug_idx" ON "rubric" USING btree ("pack_id","slug");--> statement-breakpoint
CREATE INDEX "submission_user_idx" ON "submission" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "agent_run_agent_idx" ON "agent_run" USING btree ("agent_name","created_at");--> statement-breakpoint
CREATE INDEX "interaction_user_idx" ON "interaction" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "resource_url_idx" ON "resource" USING btree ("url");--> statement-breakpoint
CREATE INDEX "spend_ledger_user_period_idx" ON "spend_ledger" USING btree ("user_id","period");--> statement-breakpoint
CREATE UNIQUE INDEX "internal_link_pair_idx" ON "internal_link" USING btree ("from_page_id","to_page_id","link_type");--> statement-breakpoint
CREATE UNIQUE INDEX "learning_topic_slug_idx" ON "learning_topic" USING btree ("slug");--> statement-breakpoint
CREATE UNIQUE INDEX "public_learning_path_slug_idx" ON "public_learning_path" USING btree ("user_id","slug");--> statement-breakpoint
CREATE UNIQUE INDEX "seo_page_slug_locale_idx" ON "seo_page" USING btree ("slug","locale");--> statement-breakpoint
CREATE INDEX "seo_page_indexable_idx" ON "seo_page" USING btree ("indexable");