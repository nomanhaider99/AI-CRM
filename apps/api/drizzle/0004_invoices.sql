DROP INDEX "invoice_items_invoice_idx";--> statement-breakpoint
ALTER TABLE "invoice_items" ADD COLUMN "position" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN "paid_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "workspaces" ADD COLUMN "invoice_seq" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
CREATE INDEX "invoice_items_invoice_idx" ON "invoice_items" USING btree ("invoice_id","position");