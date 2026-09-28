PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_profile` (
	`id` integer PRIMARY KEY DEFAULT 1 NOT NULL,
	`discipline` text DEFAULT 'boxe-anglaise' NOT NULL,
	`level` text DEFAULT 'debutant' NOT NULL,
	`goal` text DEFAULT 'cardio-perte-de-gras' NOT NULL,
	`fitness_level` text,
	`experience` text,
	`age` integer,
	`height_cm` integer,
	`equipment` text DEFAULT '[]' NOT NULL,
	`personalization_version` text,
	`constraints` text,
	`notes` text,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
INSERT INTO `__new_profile`("id", "discipline", "level", "goal", "fitness_level", "experience", "age", "height_cm", "equipment", "constraints", "notes", "created_at", "updated_at") SELECT "id", "discipline", "level", "goal", "fitness_level", "experience", "age", "height_cm", "equipment", "constraints", "notes", "created_at", "updated_at" FROM `profile`;--> statement-breakpoint
DROP TABLE `profile`;--> statement-breakpoint
ALTER TABLE `__new_profile` RENAME TO `profile`;--> statement-breakpoint
PRAGMA foreign_keys=ON;
