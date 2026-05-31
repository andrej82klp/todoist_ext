CREATE TABLE "webhook_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"logged_at" timestamp with time zone DEFAULT now() NOT NULL,
	"type" varchar(64) NOT NULL,
	"method" varchar(16),
	"url" text,
	"headers" jsonb,
	"payload" jsonb,
	"delivery_key" varchar(255),
	"status" varchar(64),
	"error" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "webhook_logs_logged_at_idx" ON "webhook_logs" USING btree ("logged_at");
--> statement-breakpoint
CREATE INDEX "webhook_logs_type_idx" ON "webhook_logs" USING btree ("type");
--> statement-breakpoint
CREATE INDEX "webhook_logs_delivery_key_idx" ON "webhook_logs" USING btree ("delivery_key");
