CREATE TABLE `session_plans` (
	`date` text PRIMARY KEY NOT NULL,
	`category` text NOT NULL,
	`focus` text,
	`note` text,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
ALTER TABLE `sessions` ADD `category` text;