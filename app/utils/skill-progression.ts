import {
  SKILL_DISPLAY_STATES,
  type SkillDisplayState,
  type SkillProgressionApiItem,
  type SkillProgressionApiResponse,
} from '../../shared/skill-progression-api'

export type { SkillDisplayState, SkillProgressionApiItem, SkillProgressionApiResponse }

export interface SkillProgressionViewModel extends SkillProgressionApiResponse {
  partial: boolean
}

export const SKILL_STATE_META: Record<
  SkillDisplayState,
  { label: string; icon: string; color: 'success' | 'warning' | 'primary' | 'neutral' }
> = {
  acquired: {
    label: 'Acquises',
    icon: 'i-lucide-circle-check-big',
    color: 'success',
  },
  consolidating: {
    label: 'En consolidation',
    icon: 'i-lucide-refresh-cw',
    color: 'warning',
  },
  eligible: {
    label: 'Prochaines',
    icon: 'i-lucide-sparkles',
    color: 'primary',
  },
  blocked: {
    label: 'Bloquées',
    icon: 'i-lucide-lock-keyhole',
    color: 'neutral',
  },
}

export class SkillProgressionLoadError extends Error {
  constructor(options?: ErrorOptions) {
    super('Impossible de charger le parcours de progression.', options)
    this.name = 'SkillProgressionLoadError'
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isDisplayState(value: unknown): value is SkillDisplayState {
  return typeof value === 'string' && (SKILL_DISPLAY_STATES as readonly string[]).includes(value)
}

function isSkillItem(value: unknown): value is SkillProgressionApiItem {
  if (!isRecord(value) || !isDisplayState(value.state)) return false
  return (
    typeof value.id === 'string' &&
    typeof value.label === 'string' &&
    typeof value.description === 'string' &&
    typeof value.stateLabel === 'string' &&
    typeof value.criteria === 'string' &&
    isRecord(value.progress) &&
    typeof value.progress.percent === 'number' &&
    typeof value.progress.label === 'string' &&
    Array.isArray(value.missingPrerequisites) &&
    isRecord(value.targeting) &&
    typeof value.targeting.explanation === 'string'
  )
}

/**
 * Frontière API/UI volontairement sans règle métier : elle valide, ordonne et signale les trous,
 * mais reprend toujours l'état et les explications calculés par le serveur.
 */
export function mapSkillProgressionApi(payload: unknown): SkillProgressionViewModel {
  if (!isRecord(payload) || payload.schemaVersion !== 1) {
    throw new SkillProgressionLoadError()
  }

  const warnings =
    isRecord(payload.dataQuality) && Array.isArray(payload.dataQuality.warnings)
      ? payload.dataQuality.warnings.filter(
          (warning): warning is string => typeof warning === 'string',
        )
      : []
  const rawSkills = Array.isArray(payload.skills) ? payload.skills : []
  const skills = rawSkills.filter(isSkillItem).sort((a, b) => a.order - b.order)
  const invalidCount = rawSkills.length - skills.length
  if (invalidCount) warnings.push(`${invalidCount} compétence(s) ignorée(s) car incomplète(s).`)

  const curriculum = payload.curriculum
  const criteria = payload.criteria
  const summary = payload.summary
  if (!isRecord(curriculum) || !isRecord(criteria) || !isRecord(summary)) {
    throw new SkillProgressionLoadError()
  }

  const expectedSkillCount = Number(curriculum.expectedSkillCount)
  if (Number.isFinite(expectedSkillCount) && expectedSkillCount !== skills.length) {
    warnings.push(`${skills.length} compétence(s) reçue(s) sur ${expectedSkillCount} attendue(s).`)
  }

  const completeFromApi = isRecord(payload.dataQuality) && payload.dataQuality.complete === true

  return {
    ...(payload as unknown as SkillProgressionApiResponse),
    skills,
    dataQuality: {
      complete: completeFromApi && warnings.length === 0,
      warnings: [...new Set(warnings)],
    },
    partial: !completeFromApi || warnings.length > 0,
  }
}

export async function loadSkillProgression(
  fetcher: (url: string) => Promise<unknown>,
  date?: string,
): Promise<SkillProgressionViewModel> {
  const url = date
    ? `/api/skills/progression?date=${encodeURIComponent(date)}`
    : '/api/skills/progression'
  try {
    return mapSkillProgressionApi(await fetcher(url))
  } catch (error) {
    if (error instanceof SkillProgressionLoadError) throw error
    throw new SkillProgressionLoadError({ cause: error })
  }
}
