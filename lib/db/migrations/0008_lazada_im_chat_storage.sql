CREATE TABLE "lazada_im_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"lazada_session_id" text NOT NULL,
	"unread_count" integer DEFAULT 0 NOT NULL,
	"last_message_id" text,
	"last_message_at" timestamp with time zone,
	"site_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "lazada_im_sessions_user_provider_uq" UNIQUE("user_id","lazada_session_id"),
	CONSTRAINT "lazada_im_sessions_provider_id_not_blank" CHECK (length(btrim("lazada_im_sessions"."lazada_session_id")) > 0),
	CONSTRAINT "lazada_im_sessions_unread_nonnegative" CHECK ("lazada_im_sessions"."unread_count" >= 0)
);
--> statement-breakpoint
CREATE TABLE "lazada_im_messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"session_id" uuid NOT NULL,
	"lazada_message_id" text NOT NULL,
	"from_account_id" text,
	"to_account_id" text,
	"from_account_type" integer,
	"to_account_type" integer,
	"content" text,
	"template_id" integer,
	"message_type" integer,
	"sent_at" timestamp with time zone,
	"provider_status" text,
	"auto_reply" boolean,
	"is_read" boolean,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "lazada_im_messages_session_provider_uq" UNIQUE("session_id","lazada_message_id"),
	CONSTRAINT "lazada_im_messages_provider_id_not_blank" CHECK (length(btrim("lazada_im_messages"."lazada_message_id")) > 0)
);
--> statement-breakpoint
ALTER TABLE "lazada_im_sessions" ADD CONSTRAINT "lazada_im_sessions_user_id_lazada_im_connections_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."lazada_im_connections"("user_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lazada_im_messages" ADD CONSTRAINT "lazada_im_messages_session_id_lazada_im_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."lazada_im_sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "lazada_im_sessions_user_last_message_idx" ON "lazada_im_sessions" USING btree ("user_id","last_message_at");--> statement-breakpoint
CREATE INDEX "lazada_im_messages_session_sent_at_idx" ON "lazada_im_messages" USING btree ("session_id","sent_at");