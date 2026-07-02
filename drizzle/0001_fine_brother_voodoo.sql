CREATE TABLE `dismissed_dates` (
	`date` text PRIMARY KEY NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL
);
