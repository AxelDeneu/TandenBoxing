CREATE TABLE `exercise_preference_events` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`exercise_key` text NOT NULL,
	`exercise_name` text NOT NULL,
	`movement_family` text NOT NULL,
	`modality` text NOT NULL,
	`action` text NOT NULL,
	`reason_code` text NOT NULL,
	`signal_kind` text NOT NULL,
	`scope` text NOT NULL,
	`scope_key` text NOT NULL,
	`occurred_on` text NOT NULL,
	`source` text NOT NULL,
	`source_key` text,
	`context` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `exercise_preference_events_source_key_unique` ON `exercise_preference_events` (`source_key`);--> statement-breakpoint
CREATE INDEX `exercise_preference_events_exercise_key_idx` ON `exercise_preference_events` (`exercise_key`);--> statement-breakpoint
CREATE INDEX `exercise_preference_events_occurred_on_idx` ON `exercise_preference_events` (`occurred_on`);