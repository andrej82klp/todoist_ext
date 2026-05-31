-- Migration: Replace per-task percentage bonus with a fixed integer bonus points field.
-- Also remove the global default completion bonus percent from global settings.
-- Existing metadata data is disposable (dev/test); this drops old fields cleanly.

-- task_metadata: add completionBonusPoints, drop old bonus fields
ALTER TABLE "task_metadata" ADD COLUMN "completion_bonus_points" integer NOT NULL DEFAULT 0;--> statement-breakpoint
ALTER TABLE "task_metadata" ADD CONSTRAINT "task_metadata_completion_bonus_points_check" CHECK ("task_metadata"."completion_bonus_points" >= 0);--> statement-breakpoint
ALTER TABLE "task_metadata" DROP CONSTRAINT IF EXISTS "task_metadata_completion_bonus_percent_check";--> statement-breakpoint
ALTER TABLE "task_metadata" DROP COLUMN "completion_bonus_enabled";--> statement-breakpoint
ALTER TABLE "task_metadata" DROP COLUMN "completion_bonus_percent";--> statement-breakpoint

-- global_settings: remove per-global completion bonus percent (bonuses are now per parent task)
ALTER TABLE "global_settings" DROP CONSTRAINT IF EXISTS "global_settings_completion_bonus_non_negative_check";--> statement-breakpoint
ALTER TABLE "global_settings" DROP COLUMN "completion_bonus_percent";
