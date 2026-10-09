ALTER TABLE "lazada_im_sessions" ADD COLUMN "sync_requested_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "lazada_im_sessions" ADD COLUMN "sync_next_attempt_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "lazada_im_sessions" ADD COLUMN "sync_attempts" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "lazada_im_sessions" ADD COLUMN "sync_lease_until" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "lazada_im_sessions" ADD COLUMN "sync_lease_token" uuid;--> statement-breakpoint
CREATE INDEX "lazada_im_sessions_sync_due_idx" ON "lazada_im_sessions" USING btree ("sync_next_attempt_at","sync_requested_at") WHERE "lazada_im_sessions"."sync_requested_at" is not null;--> statement-breakpoint
ALTER TABLE "lazada_im_sessions" ADD CONSTRAINT "lazada_im_sessions_sync_attempts_nonnegative" CHECK ("lazada_im_sessions"."sync_attempts" >= 0);