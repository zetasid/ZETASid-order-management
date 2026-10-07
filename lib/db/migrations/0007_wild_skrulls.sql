CREATE TABLE "lazada_im_connections" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"encrypted_tokens" text NOT NULL,
	"app_fingerprint" text NOT NULL,
	"country" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"refresh_expires_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "lazada_im_oauth_states" (
	"state_hash" text PRIMARY KEY NOT NULL,
	"browser_hash" text NOT NULL,
	"user_id" uuid NOT NULL,
	"session_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "lazada_im_connections" ADD CONSTRAINT "lazada_im_connections_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lazada_im_oauth_states" ADD CONSTRAINT "lazada_im_oauth_states_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lazada_im_oauth_states" ADD CONSTRAINT "lazada_im_oauth_states_session_hash_auth_sessions_token_hash_fk" FOREIGN KEY ("session_hash") REFERENCES "public"."auth_sessions"("token_hash") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "lazada_im_oauth_expiry_idx" ON "lazada_im_oauth_states" USING btree ("expires_at");