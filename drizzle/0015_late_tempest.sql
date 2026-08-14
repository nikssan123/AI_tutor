CREATE TABLE "mail_message" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"thread_id" uuid NOT NULL,
	"direction" text NOT NULL,
	"from_address" text NOT NULL,
	"to_address" text NOT NULL,
	"subject" text NOT NULL,
	"body" text NOT NULL,
	"html" text,
	"provider_id" text,
	"message_id" text,
	"in_reply_to" text,
	"template" text,
	"locale" text DEFAULT 'en' NOT NULL,
	"sent_by_email" text,
	"status" text NOT NULL,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "mail_thread" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"participant_email" text NOT NULL,
	"participant_name" text,
	"user_id" text,
	"subject" text NOT NULL,
	"locale" text DEFAULT 'en' NOT NULL,
	"kind" text NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"needs_reply" boolean DEFAULT false NOT NULL,
	"last_message_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "mail_message" ADD CONSTRAINT "mail_message_thread_id_mail_thread_id_fk" FOREIGN KEY ("thread_id") REFERENCES "public"."mail_thread"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mail_thread" ADD CONSTRAINT "mail_thread_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "mail_message_thread_idx" ON "mail_message" USING btree ("thread_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "mail_message_provider_idx" ON "mail_message" USING btree ("provider_id");--> statement-breakpoint
CREATE INDEX "mail_message_reference_idx" ON "mail_message" USING btree ("message_id");--> statement-breakpoint
CREATE INDEX "mail_thread_inbox_idx" ON "mail_thread" USING btree ("needs_reply","last_message_at");--> statement-breakpoint
CREATE INDEX "mail_thread_participant_idx" ON "mail_thread" USING btree ("participant_email");