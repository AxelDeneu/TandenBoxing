PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_settings` (
	`id` integer PRIMARY KEY DEFAULT 1 NOT NULL,
	`training_days` text DEFAULT '[1,3,5]' NOT NULL,
	`generation_time` text DEFAULT '07:00' NOT NULL,
	`target_duration_min` integer DEFAULT 45 NOT NULL,
	`timezone` text DEFAULT 'Europe/Paris' NOT NULL,
	`ai_model` text DEFAULT 'anthropic/claude-opus-4.8' NOT NULL,
	`weight_tracking_enabled` integer DEFAULT true NOT NULL,
	`auth_enabled` integer DEFAULT false NOT NULL,
	`onboarding_completed` integer DEFAULT false NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
INSERT INTO `__new_settings`("id", "training_days", "generation_time", "target_duration_min", "timezone", "ai_model", "weight_tracking_enabled", "auth_enabled", "onboarding_completed", "created_at", "updated_at") SELECT "id", "training_days", "generation_time", "target_duration_min", "timezone", "ai_model", "weight_tracking_enabled", "auth_enabled", "onboarding_completed", "created_at", "updated_at" FROM `settings`;--> statement-breakpoint
DROP TABLE `settings`;--> statement-breakpoint
ALTER TABLE `__new_settings` RENAME TO `settings`;--> statement-breakpoint
UPDATE `settings`
SET `ai_model` = CASE `ai_model`
	WHEN 'claude-opus-4-8' THEN 'anthropic/claude-opus-4.8'
	WHEN 'claude-sonnet-5' THEN 'anthropic/claude-sonnet-5'
	WHEN 'claude-haiku-4-5-20251001' THEN 'anthropic/claude-haiku-4.5'
	ELSE `ai_model`
END
WHERE `ai_model` IN ('claude-opus-4-8', 'claude-sonnet-5', 'claude-haiku-4-5-20251001');--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
ALTER TABLE `ai_usage` ADD `cost_usd` real;
