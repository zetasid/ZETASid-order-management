ALTER TABLE "orders" ALTER COLUMN "amount" SET DATA TYPE numeric(18, 2);--> statement-breakpoint
ALTER TABLE "orders" ALTER COLUMN "amount" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "lazada_data" jsonb;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "synced_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "order_items" ADD COLUMN "lazada_data" jsonb;