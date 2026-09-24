CREATE TABLE `generation_job_attempts` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`job_id` integer NOT NULL,
	`attempt_number` integer NOT NULL,
	`status` text DEFAULT 'running' NOT NULL,
	`error_kind` text,
	`error_code` text,
	`error_message` text,
	`backoff_ms` integer,
	`model_calls` integer DEFAULT 0 NOT NULL,
	`duration_ms` integer,
	`started_at` integer DEFAULT (unixepoch()) NOT NULL,
	`completed_at` integer,
	FOREIGN KEY (`job_id`) REFERENCES `generation_jobs`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `generation_job_attempts_job_attempt_unique` ON `generation_job_attempts` (`job_id`,`attempt_number`);--> statement-breakpoint
CREATE INDEX `generation_job_attempts_job_id_idx` ON `generation_job_attempts` (`job_id`);--> statement-breakpoint
CREATE TABLE `generation_jobs` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`session_date` text NOT NULL,
	`idempotency_key` text NOT NULL,
	`context_hash` text NOT NULL,
	`request` text NOT NULL,
	`source` text NOT NULL,
	`status` text DEFAULT 'queued' NOT NULL,
	`attempt_count` integer DEFAULT 0 NOT NULL,
	`max_attempts` integer DEFAULT 3 NOT NULL,
	`next_attempt_at` integer NOT NULL,
	`lease_owner` text,
	`lease_expires_at` integer,
	`last_error_kind` text,
	`last_error_code` text,
	`last_error_message` text,
	`actionable_message` text,
	`model_calls` integer DEFAULT 0 NOT NULL,
	`input_tokens` integer DEFAULT 0 NOT NULL,
	`output_tokens` integer DEFAULT 0 NOT NULL,
	`cache_creation_tokens` integer DEFAULT 0 NOT NULL,
	`cache_read_tokens` integer DEFAULT 0 NOT NULL,
	`estimated_cost_usd` real,
	`duration_ms` integer,
	`provider_latency_ms` integer DEFAULT 0 NOT NULL,
	`reuse_kind` text DEFAULT 'none' NOT NULL,
	`reused_block_count` integer DEFAULT 0 NOT NULL,
	`fallback_used` integer DEFAULT false NOT NULL,
	`queued_at` integer DEFAULT (unixepoch()) NOT NULL,
	`started_at` integer,
	`completed_at` integer,
	`failed_at` integer,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `generation_jobs_idempotency_key_unique` ON `generation_jobs` (`idempotency_key`);--> statement-breakpoint
CREATE INDEX `generation_jobs_session_date_idx` ON `generation_jobs` (`session_date`);--> statement-breakpoint
CREATE INDEX `generation_jobs_dispatch_idx` ON `generation_jobs` (`status`,`next_attempt_at`);--> statement-breakpoint
ALTER TABLE `sessions` ADD `generation_source` text DEFAULT 'model' NOT NULL;--> statement-breakpoint
ALTER TABLE `sessions` ADD `generation_context_hash` text;--> statement-breakpoint
ALTER TABLE `sessions` ADD `fallback_used` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `sessions` ADD `reused_from_session_id` integer;