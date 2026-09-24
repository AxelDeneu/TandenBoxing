ALTER TABLE `generation_jobs` ADD `policy_correction_count` integer;--> statement-breakpoint
ALTER TABLE `generation_jobs` ADD `policy_compliant` integer;--> statement-breakpoint
ALTER TABLE `session_feedback` ADD `skipped_block_count` integer;
