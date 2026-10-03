CREATE TABLE "order_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"lazada_order_item_id" text NOT NULL,
	"order_id" uuid NOT NULL,
	"product_name" text NOT NULL,
	"digital_detail" jsonb,
	"status" "order_status" DEFAULT 'pending' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "order_items_lazada_order_item_id_unique" UNIQUE("lazada_order_item_id"),
	CONSTRAINT "order_items_lazada_id_not_blank" CHECK (length(btrim("order_items"."lazada_order_item_id")) > 0)
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"display_name" text,
	"external_auth_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_email_unique" UNIQUE("email"),
	CONSTRAINT "users_external_auth_id_unique" UNIQUE("external_auth_id")
);
--> statement-breakpoint
CREATE TABLE "sync_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source" text DEFAULT 'lazada' NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"records_count" integer DEFAULT 0 NOT NULL,
	"message" text,
	"metadata" jsonb,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sync_logs_status_valid" CHECK ("sync_logs"."status" in ('pending', 'running', 'completed', 'failed')),
	CONSTRAINT "sync_logs_records_count_nonnegative" CHECK ("sync_logs"."records_count" >= 0),
	CONSTRAINT "sync_logs_time_valid" CHECK ("sync_logs"."finished_at" is null or "sync_logs"."finished_at" >= "sync_logs"."started_at")
);
--> statement-breakpoint
CREATE TABLE "system_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"level" text DEFAULT 'info' NOT NULL,
	"message" text NOT NULL,
	"context" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "system_logs_level_valid" CHECK ("system_logs"."level" in ('debug', 'info', 'warn', 'error'))
);
--> statement-breakpoint
ALTER TABLE "orders" ALTER COLUMN "marketplace_order_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "orders" ALTER COLUMN "product_name" SET DEFAULT '';--> statement-breakpoint
ALTER TABLE "orders" ALTER COLUMN "amount" SET DEFAULT 0;--> statement-breakpoint
-- Add nullable first so populated databases can be upgraded without losing rows.
ALTER TABLE "orders" ADD COLUMN "lazada_order_id" text;--> statement-breakpoint
UPDATE "orders" SET "lazada_order_id" = "marketplace_order_id" WHERE "lazada_order_id" IS NULL;--> statement-breakpoint
ALTER TABLE "orders" ALTER COLUMN "lazada_order_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "order_items_order_id_idx" ON "order_items" USING btree ("order_id");--> statement-breakpoint
CREATE INDEX "sync_logs_created_at_idx" ON "sync_logs" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "system_logs_created_at_idx" ON "system_logs" USING btree ("created_at");--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_lazada_order_id_unique" UNIQUE("lazada_order_id");--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_lazada_id_not_blank" CHECK (length(btrim("orders"."lazada_order_id")) > 0);--> statement-breakpoint

-- Maintain timestamps for all writers, including SQL queries outside Drizzle.
CREATE FUNCTION "public"."zetas_touch_updated_at"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = clock_timestamp();
  RETURN NEW;
END;
$$;--> statement-breakpoint
CREATE TRIGGER "orders_touch_updated_at" BEFORE UPDATE ON "orders"
FOR EACH ROW EXECUTE FUNCTION "public"."zetas_touch_updated_at"();--> statement-breakpoint
CREATE TRIGGER "order_items_touch_updated_at" BEFORE UPDATE ON "order_items"
FOR EACH ROW EXECUTE FUNCTION "public"."zetas_touch_updated_at"();--> statement-breakpoint
CREATE TRIGGER "users_touch_updated_at" BEFORE UPDATE ON "users"
FOR EACH ROW EXECUTE FUNCTION "public"."zetas_touch_updated_at"();