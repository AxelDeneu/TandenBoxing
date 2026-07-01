CREATE TABLE `exercise_feedback` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`session_id` integer NOT NULL,
	`block_index` integer NOT NULL,
	`exercise_index` integer NOT NULL,
	`exercise_name` text NOT NULL,
	`difficulty` integer,
	`comment` text,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`session_id`) REFERENCES `sessions`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `profile` (
	`id` integer PRIMARY KEY DEFAULT 1 NOT NULL,
	`discipline` text DEFAULT 'boxe-anglaise' NOT NULL,
	`level` text DEFAULT 'debutant' NOT NULL,
	`goal` text DEFAULT 'cardio-perte-de-gras' NOT NULL,
	`fitness_level` text,
	`experience` text,
	`age` integer,
	`height_cm` integer,
	`equipment` text DEFAULT '["gants","bandes"]' NOT NULL,
	`constraints` text,
	`notes` text,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `session_feedback` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`session_id` integer NOT NULL,
	`completed` integer DEFAULT true NOT NULL,
	`overall_difficulty` integer,
	`energy_level` integer,
	`soreness` text DEFAULT '[]' NOT NULL,
	`enjoyment` integer,
	`comment` text,
	`actual_duration_sec` integer,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`session_id`) REFERENCES `sessions`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `session_feedback_session_id_unique` ON `session_feedback` (`session_id`);--> statement-breakpoint
CREATE TABLE `sessions` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`date` text NOT NULL,
	`status` text DEFAULT 'generated' NOT NULL,
	`title` text NOT NULL,
	`focus` text NOT NULL,
	`summary` text NOT NULL,
	`coach_note` text DEFAULT '' NOT NULL,
	`target_duration_min` integer NOT NULL,
	`estimated_duration_min` integer NOT NULL,
	`structure` text NOT NULL,
	`ai_model` text NOT NULL,
	`generation_context` text,
	`generated_at` integer,
	`started_at` integer,
	`completed_at` integer,
	`actual_duration_sec` integer,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `sessions_date_unique` ON `sessions` (`date`);--> statement-breakpoint
CREATE TABLE `settings` (
	`id` integer PRIMARY KEY DEFAULT 1 NOT NULL,
	`training_days` text DEFAULT '[1,3,5]' NOT NULL,
	`generation_time` text DEFAULT '07:00' NOT NULL,
	`target_duration_min` integer DEFAULT 45 NOT NULL,
	`timezone` text DEFAULT 'Europe/Paris' NOT NULL,
	`ai_model` text DEFAULT 'claude-opus-4-8' NOT NULL,
	`weight_tracking_enabled` integer DEFAULT true NOT NULL,
	`auth_enabled` integer DEFAULT false NOT NULL,
	`onboarding_completed` integer DEFAULT false NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `weights` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`date` text NOT NULL,
	`weight_kg` real NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `weights_date_unique` ON `weights` (`date`);