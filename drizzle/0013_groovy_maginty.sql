ALTER TABLE `generation_job_attempts` ADD `lease_token` text;--> statement-breakpoint
ALTER TABLE `generation_jobs` ADD `lease_token` text;--> statement-breakpoint
ALTER TABLE `generation_jobs` ADD `attempt_started_at` integer;--> statement-breakpoint
ALTER TABLE `generation_jobs` ADD `current_stage` text;--> statement-breakpoint
ALTER TABLE `generation_jobs` ADD `stage_started_at` integer;--> statement-breakpoint
CREATE INDEX `generation_jobs_lease_expiry_idx` ON `generation_jobs` (`status`,`lease_expires_at`);--> statement-breakpoint
-- Les jobs déjà running restent récupérables après déploiement : leur token est partagé avec
-- l'essai courant, sans réinitialiser le lease ni perdre l'historique existant.
UPDATE `generation_jobs`
SET `lease_token` = lower(hex(randomblob(16))),
    `attempt_started_at` = COALESCE(`attempt_started_at`, `updated_at`, `started_at`)
WHERE `status` = 'running' AND `lease_token` IS NULL;--> statement-breakpoint
UPDATE `generation_job_attempts`
SET `lease_token` = (
  SELECT `generation_jobs`.`lease_token`
  FROM `generation_jobs`
  WHERE `generation_jobs`.`id` = `generation_job_attempts`.`job_id`
    AND `generation_jobs`.`attempt_count` = `generation_job_attempts`.`attempt_number`
)
WHERE `status` = 'running' AND `lease_token` IS NULL;
