CREATE TABLE "lesson_delivery" (
	"user_id" text NOT NULL,
	"skill_id" uuid NOT NULL,
	"pack_id" uuid NOT NULL,
	"delivered_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "lesson_delivery_user_id_skill_id_pk" PRIMARY KEY("user_id","skill_id")
);
--> statement-breakpoint
ALTER TABLE "lesson_delivery" ADD CONSTRAINT "lesson_delivery_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lesson_delivery" ADD CONSTRAINT "lesson_delivery_skill_id_skill_id_fk" FOREIGN KEY ("skill_id") REFERENCES "public"."skill"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lesson_delivery" ADD CONSTRAINT "lesson_delivery_pack_id_domain_pack_id_fk" FOREIGN KEY ("pack_id") REFERENCES "public"."domain_pack"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "lesson_delivery_user_pack_idx" ON "lesson_delivery" USING btree ("user_id","pack_id");