CREATE TABLE `session_adaptations` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`session_id` integer NOT NULL,
	`session_date` text NOT NULL,
	`cause` text NOT NULL,
	`cursor` text,
	`constraints` text NOT NULL,
	`changes` text NOT NULL,
	`before_duration_sec` integer NOT NULL,
	`after_duration_sec` integer NOT NULL,
	`before_intensity` integer NOT NULL,
	`after_intensity` integer NOT NULL,
	`rule_version` text NOT NULL,
	`safety_notice_shown` integer DEFAULT false NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`session_id`) REFERENCES `sessions`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `session_adaptations_session_id_idx` ON `session_adaptations` (`session_id`);--> statement-breakpoint
CREATE INDEX `session_adaptations_session_date_idx` ON `session_adaptations` (`session_date`);--> statement-breakpoint
CREATE TABLE `session_check_ins` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`session_id` integer NOT NULL,
	`available_time_min` integer,
	`energy` integer DEFAULT 3 NOT NULL,
	`soreness_level` integer DEFAULT 0 NOT NULL,
	`soreness_locations` text DEFAULT '[]' NOT NULL,
	`pain_locations` text DEFAULT '[]' NOT NULL,
	`intention` text DEFAULT 'maintain' NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`session_id`) REFERENCES `sessions`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `session_check_ins_session_id_unique` ON `session_check_ins` (`session_id`);