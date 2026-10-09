CREATE TABLE "lazada_im_push_event_receipts" (
	"user_id" uuid NOT NULL,
	"event_key" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "lazada_im_push_event_receipts_user_event_uq" UNIQUE("user_id","event_key"),
	CONSTRAINT "lazada_im_push_event_receipts_key_hex" CHECK ("lazada_im_push_event_receipts"."event_key" ~ '^[0-9a-f]{64}$')
);
--> statement-breakpoint
ALTER TABLE "lazada_im_sessions" ADD COLUMN "sync_start_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "lazada_im_sessions" ADD COLUMN "sync_cursor_start_time" text;--> statement-breakpoint
ALTER TABLE "lazada_im_sessions" ADD COLUMN "sync_cursor_message_id" text;--> statement-breakpoint
ALTER TABLE "lazada_im_sessions" ADD COLUMN "sync_cursor_request_version" integer;--> statement-breakpoint
ALTER TABLE "lazada_im_sessions" ADD COLUMN "sync_cursor_history" text[] DEFAULT ARRAY[]::text[] NOT NULL;--> statement-breakpoint
ALTER TABLE "lazada_im_sessions" ADD COLUMN "sync_blocked_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "lazada_im_push_event_receipts" ADD CONSTRAINT "lazada_im_push_event_receipts_user_id_lazada_im_connections_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."lazada_im_connections"("user_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "lazada_im_push_event_receipts_created_idx" ON "lazada_im_push_event_receipts" USING btree ("created_at");--> statement-breakpoint
ALTER TABLE "lazada_im_sessions" ADD CONSTRAINT "lazada_im_sessions_sync_cursor_version_nonnegative" CHECK ("lazada_im_sessions"."sync_cursor_request_version" IS NULL OR "lazada_im_sessions"."sync_cursor_request_version" >= 0);--> statement-breakpoint
ALTER TABLE "lazada_im_sessions" ADD CONSTRAINT "lazada_im_sessions_sync_cursor_fields_consistent" CHECK ((
      "lazada_im_sessions"."sync_cursor_start_time" IS NULL
      AND "lazada_im_sessions"."sync_cursor_message_id" IS NULL
      AND "lazada_im_sessions"."sync_cursor_request_version" IS NULL
    ) OR (
      "lazada_im_sessions"."sync_cursor_start_time" IS NOT NULL
      AND "lazada_im_sessions"."sync_cursor_message_id" IS NOT NULL
      AND "lazada_im_sessions"."sync_cursor_request_version" IS NOT NULL
    ));