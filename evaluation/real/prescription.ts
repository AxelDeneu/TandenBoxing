import { createHash } from 'node:crypto'
import { GENERATOR_VERSIONS } from '../../shared/generator-version'
import { buildSessionPrompt } from '../../shared/generation-prompt'
import { planWorkoutPrescription } from '../../shared/workout-prescription'
import type { EvaluationCase } from '../types'

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`
  if (value && typeof value === 'object') {
    return `{${Object.entries(value as Record<string, unknown>)
      .filter(([, entry]) => entry !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => `${JSON.stringify(key)}:${stableJson(entry)}`)
      .join(',')}}`
  }
  return JSON.stringify(value) ?? 'null'
}

export function sha256(value: unknown): string {
  return createHash('sha256')
    .update(typeof value === 'string' ? value : stableJson(value))
    .digest('hex')
}

export function buildSyntheticPrescription(evaluationCase: EvaluationCase) {
  const { context, expected } = evaluationCase
  return planWorkoutPrescription({
    today: context.date,
    targetDurationMin: context.targetDurationMin,
    constraints: context.profile.constraints.join(', ') || null,
    history: context.history.map((entry) => ({
      date: entry.date,
      category: entry.category,
      focus: entry.focus,
      completed: entry.completed,
      difficulty: entry.difficulty ?? null,
      energy: entry.energy ?? null,
    })),
    skipped: context.skippedSessions,
    request: {
      category: expected.category,
      focus: expected.focus,
      customFocus: context.request?.customFocus,
      durationMin: context.targetDurationMin,
      note: context.request?.note,
    },
  })
}

export function buildSyntheticProviderPrompt(evaluationCase: EvaluationCase): {
  prompt: string
  prescription: ReturnType<typeof buildSyntheticPrescription>
} {
  const prescription = buildSyntheticPrescription(evaluationCase)
  const request = evaluationCase.context.request
  const promptContext = {
    generatorVersions: GENERATOR_VERSIONS,
    dureeCibleMin: evaluationCase.context.targetDurationMin,
    prescription,
    profil: evaluationCase.context.profile,
    historique: evaluationCase.context.history,
    seancesSautees: evaluationCase.context.skippedSessions,
    signalFatigue: evaluationCase.context.fatigueSignal ?? null,
    demande: request
      ? {
          categorie: request.category,
          focus: request.focus,
          focusLibre: request.customFocus,
          note: request.note,
        }
      : undefined,
  }
  return {
    prescription,
    prompt: buildSessionPrompt({
      dateLabel: evaluationCase.context.date,
      context: promptContext,
    }),
  }
}
