CREATE TABLE "lazada_order_automation" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"app_fingerprint" text NOT NULL,
	"last_push" timestamp with time zone,
	"last_processed_push" timestamp with time zone,
	"last_sync" timestamp with time zone,
	"last_error" text,
	"next_reconcile_at" timestamp with time zone DEFAULT now() NOT NULL,
	"reconciled_through" timestamp with time zone,
	"range_start" timestamp with time zone,
	"range_end" timestamp with time zone,
	"offset" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "lazada_order_push" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"event_hash" text NOT NULL,
	"user_id" uuid NOT NULL,
	"app_fingerprint" text NOT NULL,
	"order_id" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"next_attempt_at" timestamp with time zone DEFAULT now() NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	"processed_at" timestamp with time zone,
	"last_error" text,
	CONSTRAINT "lazada_order_push_event_hash_unique" UNIQUE("event_hash"),
	CONSTRAINT "lazada_order_push_status_check" CHECK ("lazada_order_push"."status" in ('pending', 'done')),
	CONSTRAINT "lazada_order_push_attempts_check" CHECK ("lazada_order_push"."attempts" >= 0)
);
--> statement-breakpoint
ALTER TABLE "lazada_order_automation" ADD CONSTRAINT "lazada_order_automation_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lazada_order_push" ADD CONSTRAINT "lazada_order_push_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "lazada_order_push_due_idx" ON "lazada_order_push" USING btree ("status","next_attempt_at");