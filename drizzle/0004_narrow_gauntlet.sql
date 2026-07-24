PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_session_plans` (
	`date` text PRIMARY KEY NOT NULL,
	`category` text,
	`focus` text,
	`custom_focus` text,
	`duration_min` integer,
	`note` text,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
INSERT INTO `__new_session_plans`("date", "category", "focus", "custom_focus", "duration_min", "note", "created_at", "updated_at") SELECT "date", "category", "focus", NULL, NULL, "note", "created_at", "updated_at" FROM `session_plans`;--> statement-breakpoint
DROP TABLE `session_plans`;--> statement-breakpoint
ALTER TABLE `__new_session_plans` RENAME TO `session_plans`;--> statement-breakpoint
PRAGMA foreign_keys=ON;