CREATE EXTENSION IF NOT EXISTS "pgcrypto";--> statement-breakpoint
CREATE TYPE "public"."dashboard_notification_severity" AS ENUM('info', 'warning', 'critical');--> statement-breakpoint
CREATE TYPE "public"."dashboard_notification_type" AS ENUM('streak_protection_used', 'system');--> statement-breakpoint
CREATE TYPE "public"."ledger_transaction_type" AS ENUM('earned', 'spent', 'bonus', 'adjusted');--> statement-breakpoint
CREATE TYPE "public"."oauth_provider" AS ENUM('todoist');--> statement-breakpoint
CREATE TYPE "public"."priority_level" AS ENUM('low', 'medium', 'high');--> statement-breakpoint
CREATE TYPE "public"."streak_bonus_strategy" AS ENUM('fixed', 'percentage');--> statement-breakpoint
CREATE TYPE "public"."streak_rule_type" AS ENUM('completed_items', 'points');--> statement-breakpoint
CREATE TYPE "public"."todoist_item_type" AS ENUM('project', 'task', 'subtask');--> statement-breakpoint
CREATE TABLE "dashboard_notifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"notification_type" "dashboard_notification_type" NOT NULL,
	"severity" "dashboard_notification_severity" DEFAULT 'info' NOT NULL,
	"title" varchar(255) NOT NULL,
	"message" text NOT NULL,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"acknowledged_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "global_settings" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"difficulty_multiplier_base" integer DEFAULT 10 NOT NULL,
	"low_priority_multiplier" numeric(5, 2) DEFAULT '1.00' NOT NULL,
	"medium_priority_multiplier" numeric(5, 2) DEFAULT '1.25' NOT NULL,
	"high_priority_multiplier" numeric(5, 2) DEFAULT '1.50' NOT NULL,
	"completion_bonus_percent" numeric(5, 2) DEFAULT '10.00' NOT NULL,
	"streak_rule_type" "streak_rule_type" DEFAULT 'completed_items' NOT NULL,
	"streak_rule_value" integer DEFAULT 1 NOT NULL,
	"streak_protection_enabled" boolean DEFAULT true NOT NULL,
	"streak_protection_starting_balance" integer DEFAULT 3 NOT NULL,
	"protection_reward_every_n_days" integer DEFAULT 10 NOT NULL,
	"protection_reward_amount" integer DEFAULT 1 NOT NULL,
	"milestone_bonus_strategy" "streak_bonus_strategy" DEFAULT 'fixed' NOT NULL,
	"milestone_percentage_window_days" integer DEFAULT 5 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "global_settings_difficulty_multiplier_positive_check" CHECK ("global_settings"."difficulty_multiplier_base" > 0),
	CONSTRAINT "global_settings_low_priority_positive_check" CHECK ("global_settings"."low_priority_multiplier" > 0),
	CONSTRAINT "global_settings_medium_priority_positive_check" CHECK ("global_settings"."medium_priority_multiplier" > 0),
	CONSTRAINT "global_settings_high_priority_positive_check" CHECK ("global_settings"."high_priority_multiplier" > 0),
	CONSTRAINT "global_settings_completion_bonus_non_negative_check" CHECK ("global_settings"."completion_bonus_percent" >= 0),
	CONSTRAINT "global_settings_streak_rule_value_positive_check" CHECK ("global_settings"."streak_rule_value" > 0),
	CONSTRAINT "global_settings_streak_protection_starting_balance_non_negative_check" CHECK ("global_settings"."streak_protection_starting_balance" >= 0),
	CONSTRAINT "global_settings_protection_reward_every_n_days_positive_check" CHECK ("global_settings"."protection_reward_every_n_days" > 0),
	CONSTRAINT "global_settings_protection_reward_amount_non_negative_check" CHECK ("global_settings"."protection_reward_amount" >= 0),
	CONSTRAINT "global_settings_milestone_percentage_window_days_positive_check" CHECK ("global_settings"."milestone_percentage_window_days" > 0)
);
--> statement-breakpoint
CREATE TABLE "milestone_awards" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"milestone_definition_id" uuid NOT NULL,
	"awarded_for_days" integer NOT NULL,
	"ledger_transaction_id" uuid,
	"awarded_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "milestone_awards_awarded_for_days_positive_check" CHECK ("milestone_awards"."awarded_for_days" > 0)
);
--> statement-breakpoint
CREATE TABLE "milestone_definitions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"days" integer NOT NULL,
	"fixed_bonus_points" integer DEFAULT 0 NOT NULL,
	"percentage_bonus" numeric(5, 2) DEFAULT '0.00' NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "milestone_definitions_days_positive_check" CHECK ("milestone_definitions"."days" > 0),
	CONSTRAINT "milestone_definitions_fixed_bonus_non_negative_check" CHECK ("milestone_definitions"."fixed_bonus_points" >= 0),
	CONSTRAINT "milestone_definitions_percentage_bonus_non_negative_check" CHECK ("milestone_definitions"."percentage_bonus" >= 0)
);
--> statement-breakpoint
CREATE TABLE "oauth_accounts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"provider" "oauth_provider" DEFAULT 'todoist' NOT NULL,
	"provider_user_id" varchar(128) NOT NULL,
	"access_token" text NOT NULL,
	"refresh_token" text,
	"scope" text,
	"token_type" varchar(32),
	"token_expires_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "point_balances" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"current_balance" integer DEFAULT 0 NOT NULL,
	"lifetime_earned" integer DEFAULT 0 NOT NULL,
	"lifetime_spent" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "point_balances_lifetime_earned_check" CHECK ("point_balances"."lifetime_earned" >= 0),
	CONSTRAINT "point_balances_lifetime_spent_check" CHECK ("point_balances"."lifetime_spent" >= 0)
);
--> statement-breakpoint
CREATE TABLE "point_ledger" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"transaction_type" "ledger_transaction_type" NOT NULL,
	"amount" integer NOT NULL,
	"description" text NOT NULL,
	"source" varchar(64) NOT NULL,
	"related_entity_type" varchar(64),
	"related_entity_id" varchar(128),
	"idempotency_key" varchar(255),
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "point_ledger_amount_non_zero_check" CHECK ("point_ledger"."amount" <> 0)
);
--> statement-breakpoint
CREATE TABLE "reward_redemptions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"reward_id" uuid NOT NULL,
	"cost_points" integer NOT NULL,
	"redemption_note" text,
	"redeemed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "reward_redemptions_cost_points_positive_check" CHECK ("reward_redemptions"."cost_points" > 0)
);
--> statement-breakpoint
CREATE TABLE "rewards" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"name" varchar(255) NOT NULL,
	"description" text,
	"category" varchar(64),
	"cost_points" integer NOT NULL,
	"is_archived" boolean DEFAULT false NOT NULL,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "rewards_cost_points_positive_check" CHECK ("rewards"."cost_points" > 0)
);
--> statement-breakpoint
CREATE TABLE "streak_history" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"activity_date" date NOT NULL,
	"qualified" boolean NOT NULL,
	"qualified_by" varchar(64),
	"points_earned" integer DEFAULT 0 NOT NULL,
	"completed_count" integer DEFAULT 0 NOT NULL,
	"streak_length" integer DEFAULT 0 NOT NULL,
	"protection_consumed" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "streak_history_points_earned_non_negative_check" CHECK ("streak_history"."points_earned" >= 0),
	CONSTRAINT "streak_history_completed_count_non_negative_check" CHECK ("streak_history"."completed_count" >= 0),
	CONSTRAINT "streak_history_streak_length_non_negative_check" CHECK ("streak_history"."streak_length" >= 0)
);
--> statement-breakpoint
CREATE TABLE "streak_protection" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"balance" integer DEFAULT 3 NOT NULL,
	"last_rewarded_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "streak_protection_balance_non_negative_check" CHECK ("streak_protection"."balance" >= 0)
);
--> statement-breakpoint
CREATE TABLE "streak_state" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"current_streak" integer DEFAULT 0 NOT NULL,
	"longest_streak" integer DEFAULT 0 NOT NULL,
	"last_qualified_date" date,
	"last_evaluated_date" date,
	"last_protection_used_date" date,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "streak_state_current_non_negative_check" CHECK ("streak_state"."current_streak" >= 0),
	CONSTRAINT "streak_state_longest_non_negative_check" CHECK ("streak_state"."longest_streak" >= 0)
);
--> statement-breakpoint
CREATE TABLE "task_metadata" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"todoist_item_mapping_id" uuid NOT NULL,
	"priority" "priority_level" DEFAULT 'medium' NOT NULL,
	"difficulty" integer DEFAULT 1 NOT NULL,
	"time_estimate_minutes" integer,
	"completion_bonus_enabled" boolean DEFAULT true NOT NULL,
	"completion_bonus_percent" numeric(5, 2) DEFAULT '10.00' NOT NULL,
	"badge" varchar(64),
	"custom_point_override" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "task_metadata_difficulty_check" CHECK ("task_metadata"."difficulty" >= 1 and "task_metadata"."difficulty" <= 10),
	CONSTRAINT "task_metadata_time_estimate_check" CHECK ("task_metadata"."time_estimate_minutes" is null or "task_metadata"."time_estimate_minutes" >= 0),
	CONSTRAINT "task_metadata_completion_bonus_percent_check" CHECK ("task_metadata"."completion_bonus_percent" >= 0)
);
--> statement-breakpoint
CREATE TABLE "todoist_item_mappings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"todoist_item_id" varchar(128) NOT NULL,
	"item_type" "todoist_item_type" NOT NULL,
	"parent_todoist_item_id" varchar(128),
	"project_todoist_id" varchar(128),
	"title" text NOT NULL,
	"due_at" timestamp with time zone,
	"is_completed" boolean DEFAULT false NOT NULL,
	"synced_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" varchar(320) NOT NULL,
	"todoist_user_id" varchar(128) NOT NULL,
	"display_name" varchar(255),
	"avatar_url" text,
	"timezone" varchar(64),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "webhook_deliveries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid,
	"delivery_key" varchar(255) NOT NULL,
	"event_key" varchar(255) NOT NULL,
	"status" varchar(32) DEFAULT 'processed' NOT NULL,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"processed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "dashboard_notifications" ADD CONSTRAINT "dashboard_notifications_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "global_settings" ADD CONSTRAINT "global_settings_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "milestone_awards" ADD CONSTRAINT "milestone_awards_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "milestone_awards" ADD CONSTRAINT "milestone_awards_milestone_definition_id_milestone_definitions_id_fk" FOREIGN KEY ("milestone_definition_id") REFERENCES "public"."milestone_definitions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "milestone_awards" ADD CONSTRAINT "milestone_awards_ledger_transaction_id_point_ledger_id_fk" FOREIGN KEY ("ledger_transaction_id") REFERENCES "public"."point_ledger"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "milestone_definitions" ADD CONSTRAINT "milestone_definitions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "oauth_accounts" ADD CONSTRAINT "oauth_accounts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "point_balances" ADD CONSTRAINT "point_balances_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "point_ledger" ADD CONSTRAINT "point_ledger_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reward_redemptions" ADD CONSTRAINT "reward_redemptions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reward_redemptions" ADD CONSTRAINT "reward_redemptions_reward_id_rewards_id_fk" FOREIGN KEY ("reward_id") REFERENCES "public"."rewards"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rewards" ADD CONSTRAINT "rewards_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "streak_history" ADD CONSTRAINT "streak_history_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "streak_protection" ADD CONSTRAINT "streak_protection_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "streak_state" ADD CONSTRAINT "streak_state_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_metadata" ADD CONSTRAINT "task_metadata_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_metadata" ADD CONSTRAINT "task_metadata_todoist_item_mapping_id_todoist_item_mappings_id_fk" FOREIGN KEY ("todoist_item_mapping_id") REFERENCES "public"."todoist_item_mappings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "todoist_item_mappings" ADD CONSTRAINT "todoist_item_mappings_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "webhook_deliveries" ADD CONSTRAINT "webhook_deliveries_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "dashboard_notifications_user_acknowledged_idx" ON "dashboard_notifications" USING btree ("user_id","acknowledged_at");--> statement-breakpoint
CREATE INDEX "dashboard_notifications_user_created_at_idx" ON "dashboard_notifications" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "milestone_awards_user_definition_unique" ON "milestone_awards" USING btree ("user_id","milestone_definition_id");--> statement-breakpoint
CREATE UNIQUE INDEX "milestone_definitions_user_days_unique" ON "milestone_definitions" USING btree ("user_id","days");--> statement-breakpoint
CREATE INDEX "milestone_definitions_user_active_idx" ON "milestone_definitions" USING btree ("user_id","is_active");--> statement-breakpoint
CREATE UNIQUE INDEX "oauth_accounts_provider_user_id_unique" ON "oauth_accounts" USING btree ("provider","provider_user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "oauth_accounts_user_provider_unique" ON "oauth_accounts" USING btree ("user_id","provider");--> statement-breakpoint
CREATE INDEX "oauth_accounts_user_id_idx" ON "oauth_accounts" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "point_ledger_user_created_at_idx" ON "point_ledger" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "point_ledger_user_idempotency_key_unique" ON "point_ledger" USING btree ("user_id","idempotency_key") WHERE "point_ledger"."idempotency_key" is not null;--> statement-breakpoint
CREATE INDEX "reward_redemptions_user_redeemed_at_idx" ON "reward_redemptions" USING btree ("user_id","redeemed_at");--> statement-breakpoint
CREATE INDEX "rewards_user_archived_idx" ON "rewards" USING btree ("user_id","is_archived");--> statement-breakpoint
CREATE UNIQUE INDEX "streak_history_user_activity_date_unique" ON "streak_history" USING btree ("user_id","activity_date");--> statement-breakpoint
CREATE INDEX "streak_history_user_activity_date_idx" ON "streak_history" USING btree ("user_id","activity_date");--> statement-breakpoint
CREATE UNIQUE INDEX "task_metadata_user_mapping_unique" ON "task_metadata" USING btree ("user_id","todoist_item_mapping_id");--> statement-breakpoint
CREATE INDEX "task_metadata_user_id_idx" ON "task_metadata" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "todoist_item_mappings_user_todoist_item_unique" ON "todoist_item_mappings" USING btree ("user_id","todoist_item_id");--> statement-breakpoint
CREATE INDEX "todoist_item_mappings_user_item_type_idx" ON "todoist_item_mappings" USING btree ("user_id","item_type");--> statement-breakpoint
CREATE INDEX "todoist_item_mappings_project_idx" ON "todoist_item_mappings" USING btree ("project_todoist_id");--> statement-breakpoint
CREATE UNIQUE INDEX "users_email_unique" ON "users" USING btree ("email");--> statement-breakpoint
CREATE UNIQUE INDEX "users_todoist_user_id_unique" ON "users" USING btree ("todoist_user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "webhook_deliveries_delivery_event_unique" ON "webhook_deliveries" USING btree ("delivery_key","event_key");--> statement-breakpoint
CREATE INDEX "webhook_deliveries_user_processed_idx" ON "webhook_deliveries" USING btree ("user_id","processed_at");