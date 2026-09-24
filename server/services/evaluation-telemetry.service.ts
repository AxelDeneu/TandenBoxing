import {
  aggregateProductionTelemetry,
  type ProductionTelemetryRecord,
} from '../../shared/evaluation-telemetry'
import type { GeneratorVersions } from '../../shared/generator-version'

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function stringField(value: Record<string, unknown>, key: keyof GeneratorVersions): string {
  return typeof value[key] === 'string' ? value[key] : `legacy:unknown-${key}`
}

function versionsFromContext(context: unknown): GeneratorVersions {
  const versions =
    isRecord(context) && isRecord(context.generatorVersions) ? context.generatorVersions : {}
  return {
    planner: stringField(versions, 'planner'),
    policy: stringField(versions, 'policy'),
    prompt: stringField(versions, 'prompt'),
    prescription: stringField(versions, 'prescription'),
    outputContract: stringField(versions, 'outputContract'),
    preferences: stringField(versions, 'preferences'),
    autoregulation: stringField(versions, 'autoregulation'),
  }
}

function plannedDifficulty(context: unknown): number | null {
  if (!isRecord(context) || !isRecord(context.prescription)) return null
  const intensity = context.prescription.intensity
  return typeof intensity === 'number' && intensity >= 1 && intensity <= 5 ? intensity : null
}

/** Vue agrégée reliant les versions hors ligne aux résultats structurés réellement observés. */
export function getEvaluationTelemetry(from: string, to: string, minimumGroupSize = 3) {
  const sessionsInWindow = listSessionsSince(from).filter((session) => session.date <= to)
  const ids = sessionsInWindow.map((session) => session.id)
  const feedbackBySession = new Map(
    listSessionFeedbackByIds(ids).map((feedback) => [feedback.sessionId, feedback]),
  )
  const jobsByDate = new Map(
    listLatestGenerationJobsBetween(from, to).map((job) => [job.sessionDate, job]),
  )
  const adaptationsBySession = new Map<number, number>()
  for (const adaptation of listSessionAdaptationsBetween(from, to)) {
    adaptationsBySession.set(
      adaptation.sessionId,
      (adaptationsBySession.get(adaptation.sessionId) ?? 0) + 1,
    )
  }
  const replacementsByDate = new Map<string, number>()
  for (const event of listExercisePreferenceEvents(to)) {
    if (event.occurredOn < from || event.action !== 'replaced') continue
    const sessionDate = event.context.sessionDate
    if (!sessionDate) continue
    replacementsByDate.set(sessionDate, (replacementsByDate.get(sessionDate) ?? 0) + 1)
  }

  const records: ProductionTelemetryRecord[] = sessionsInWindow.map((session) => {
    const feedback = feedbackBySession.get(session.id)
    const job = jobsByDate.get(session.date)
    return {
      model: session.aiModel,
      versions: versionsFromContext(session.generationContext),
      policyCompliant: job?.status === 'succeeded' ? job.policyCompliant : null,
      automaticCorrectionCount: job?.status === 'succeeded' ? job.policyCorrectionCount : null,
      plannedDurationSeconds: session.targetDurationMin * 60,
      actualDurationSeconds: feedback?.actualDurationSec ?? session.actualDurationSec ?? null,
      completed: session.status === 'completed' || feedback?.completed === true,
      skippedBlockCount: feedback?.skippedBlockCount ?? null,
      plannedDifficulty: plannedDifficulty(session.generationContext),
      feltDifficulty: feedback?.overallDifficulty ?? null,
      enjoyment: feedback?.enjoyment ?? null,
      replacementCount: replacementsByDate.get(session.date) ?? 0,
      adaptationCount: adaptationsBySession.get(session.id) ?? 0,
      providerLatencyMilliseconds: job?.providerLatencyMs ?? null,
      estimatedCostUsd: job?.estimatedCostUsd ?? null,
    }
  })
  return aggregateProductionTelemetry(records, { from, to }, minimumGroupSize)
}
