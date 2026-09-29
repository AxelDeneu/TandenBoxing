import type { GenerationStage, PublicGenerationJob } from '~~/shared/generation-jobs'

const STAGE_LABELS: Record<GenerationStage, string> = {
  catalogue: 'Vérification du modèle',
  generation: 'Génération par le modèle',
  validation: 'Validation de la séance',
  correction: 'Correction structurée',
  fallback: 'Création de la séance de secours',
  persistence: 'Enregistrement de la séance',
}

export function generationStageLabel(stage: GenerationStage | null | undefined): string {
  return stage ? STAGE_LABELS[stage] : 'Démarrage du traitement'
}

export function formatGenerationElapsed(startedAt: number, now = Date.now()): string {
  const totalSeconds = Math.max(0, Math.floor((now - startedAt) / 1_000))
  if (totalSeconds < 60) return `${totalSeconds} s`
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  return seconds ? `${minutes} min ${seconds} s` : `${minutes} min`
}

export function generationProgressDescription(job: PublicGenerationJob, now = Date.now()): string {
  if (job.status === 'running' && job.currentAttempt) {
    return [
      `Tentative ${job.currentAttempt.number}/${job.maxAttempts}`,
      generationStageLabel(job.currentAttempt.stage),
      `depuis ${formatGenerationElapsed(job.currentAttempt.startedAt, now)}`,
    ].join(' · ')
  }
  if (job.status === 'retry_scheduled') {
    return `Tentative ${job.attemptCount}/${job.maxAttempts} terminée · nouvel essai programmé automatiquement.`
  }
  if (job.status === 'queued') {
    return `En attente · prochaine tentative ${Math.min(job.attemptCount + 1, job.maxAttempts)}/${job.maxAttempts}.`
  }
  return `Tentative ${job.attemptCount}/${job.maxAttempts}.`
}

export function generationPreviousAttemptDescription(
  job: PublicGenerationJob | null | undefined,
): string | null {
  const previous = job?.lastAttempt
  if (!previous) return null
  if (job.status === 'running' && previous.number >= (job.currentAttempt?.number ?? 0)) return null
  const result = previous.errorMessage ?? previous.errorCode ?? previous.status
  return `Essai précédent (${previous.number}/${job.maxAttempts}) : ${result}`
}
