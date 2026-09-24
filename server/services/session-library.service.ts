import { matchingStrictExclusion } from '../../shared/exercise-preferences'
import { BEGINNER_CURRICULUM } from '../../shared/curriculum'
import type { SkillId } from '../../shared/curriculum'
import { validateSessionPolicy } from '../../shared/session-policy'
import {
  estimateExerciseSeconds,
  estimateSessionSeconds,
  type BlockType,
  type Exercise,
  type ExerciseCategory,
  type WorkoutBlock,
  type WorkoutFocus,
  type WorkoutSession,
} from '../../shared/session-schema'
import { assessSessionVariety, type ConsolidationIntent } from '../../shared/session-variety'
import type { BlockBudgets } from '../../shared/workout-prescription'
import type { Session } from '../database/schema'
import type { GenerationContext } from './generation.service'

const BLOCK_ORDER: BlockType[] = [
  'echauffement',
  'technique',
  'cardio',
  'renforcement',
  'retour_au_calme',
]

const SKILL_TECHNIQUE: Record<SkillId, { name: string; combo: string | null }> = {
  posture_garde: { name: 'Posture et garde en shadow', combo: null },
  appuis: { name: 'Appuis et déplacements contrôlés', combo: null },
  jab: { name: 'Jab technique en shadow', combo: '1' },
  cross: { name: 'Cross technique en shadow', combo: '2' },
  un_deux: { name: 'Un-deux technique en shadow', combo: '1-2' },
  crochets: { name: 'Crochets contrôlés en shadow', combo: '3-4' },
  uppercuts: { name: 'Uppercuts contrôlés en shadow', combo: '5-6' },
  defenses: { name: 'Défense et esquives contrôlées', combo: null },
  sorties_angle: { name: "Sorties d'angle et pivots contrôlés", combo: null },
  combinaisons_base: { name: 'Combinaison fluide en shadow', combo: '1-2-3-2' },
}

interface ExerciseTemplate {
  name: string
  category: ExerciseCategory
  combo?: string | null
}

function exerciseTemplates(
  type: BlockType,
  focus: WorkoutFocus,
  selectedSkillId: SkillId | null,
): ExerciseTemplate[] {
  if (type === 'echauffement') {
    return [
      { name: 'Mobilité articulaire douce', category: 'mobilite' },
      { name: 'Marche active sans saut', category: 'mobilite' },
      { name: 'Respiration et transferts de poids doux', category: 'mobilite' },
    ]
  }
  if (type === 'retour_au_calme') {
    return [
      { name: 'Respiration diaphragmatique lente', category: 'recuperation' },
      { name: 'Étirements doux sans douleur', category: 'recuperation' },
      { name: 'Marche lente et relâchement global', category: 'recuperation' },
    ]
  }
  if (type === 'cardio') {
    return [
      { name: 'Marche cardio sans saut', category: 'cardio' },
      { name: 'Shadow boxing rythmé', category: 'cardio', combo: '1-2' },
      { name: 'Marche dynamique avec garde active', category: 'cardio' },
    ]
  }
  if (type === 'renforcement') {
    return [
      { name: 'Gainage debout contrôlé', category: 'renforcement' },
      { name: 'Squats partiels contrôlés', category: 'renforcement' },
      { name: 'Maintien isométrique des bras', category: 'renforcement' },
    ]
  }
  const selected = selectedSkillId
    ? SKILL_TECHNIQUE[selectedSkillId]
    : { name: `Respiration et relâchement — focus ${focus}`, combo: null }
  return [
    { ...selected, category: 'technique' },
    { name: 'Respiration technique lente en shadow', category: 'technique', combo: null },
    { name: 'Coordination visuelle sans frappe', category: 'technique', combo: null },
  ]
}

/** Produit des intervalles dont la durée totale est exactement le budget demandé. */
function intervalExercise(template: ExerciseTemplate, totalSeconds: number): Exercise {
  const rounds = Math.max(1, Math.ceil(totalSeconds / 900))
  const work = Math.floor(totalSeconds / rounds)
  const restAfterSec = totalSeconds - rounds * work
  const combo = template.combo ?? null
  return {
    name: template.name,
    category: template.category,
    explanation:
      'Reste dans une amplitude confortable, garde une respiration régulière et privilégie une exécution propre.',
    tips: ['Garde les épaules relâchées.', 'Arrête le mouvement en cas de douleur.'],
    commonMistakes: ['Accélérer au détriment de la posture.'],
    skillIds: [],
    combo,
    comboExplanation: combo ? '1 = jab, 2 = cross, 3-4 = crochets, 5-6 = uppercuts.' : null,
    intervals: { work, rest: 0, rounds },
    restAfterSec,
  }
}

function blockTitle(type: BlockType): string {
  if (type === 'echauffement') return 'Échauffement progressif'
  if (type === 'retour_au_calme') return 'Retour au calme'
  if (type === 'technique') return 'Technique maîtrisée'
  if (type === 'cardio') return 'Cardio contrôlé'
  return 'Renforcement fonctionnel'
}

function policyForContext(context: GenerationContext) {
  return {
    targetDurationMin: context.dureeCibleMin,
    requestedCategory: context.prescription.category,
    requestedFocus: context.prescription.focus,
    hasCustomFocus: Boolean(context.demande?.focusLibre),
    exercisePreferences: context.prescription.exercisePreferences,
  }
}

function consolidationForContext(context: GenerationContext): ConsolidationIntent | undefined {
  const consolidation = context.prescription.variety.consolidation
  return consolidation.intentional && consolidation.reason
    ? { intentional: true, reason: consolidation.reason }
    : undefined
}

function blockDuration(block: WorkoutBlock): number {
  return block.exercises.reduce((sum, exercise) => sum + estimateExerciseSeconds(exercise), 0)
}

function blockHonorsPreferences(block: WorkoutBlock, context: GenerationContext): boolean {
  return block.exercises.every(
    (exercise) =>
      !matchingStrictExclusion(exercise, block.type, context.prescription.exercisePreferences),
  )
}

/**
 * Réutilise une séance entière uniquement si elle repasse le schéma, la politique courante,
 * les préférences strictes et le budget de variété. Sinon la recherche continue par blocs.
 */
export function findReusableSession(
  date: string,
  context: GenerationContext,
  candidates: readonly Session[] = listRecentSessions(120),
): Session | null {
  for (const candidate of candidates) {
    if (
      candidate.date >= date ||
      candidate.status === 'skipped' ||
      candidate.status === 'in_progress'
    ) {
      continue
    }
    if (
      candidate.category !== context.prescription.category ||
      candidate.focus !== context.prescription.focus ||
      candidate.targetDurationMin !== context.dureeCibleMin
    ) {
      continue
    }
    if (!validateSessionPolicy(candidate.structure, policyForContext(context)).valid) continue
    const variety = assessSessionVariety(candidate.structure, context.memoire.variete.sessions, {
      consolidation: consolidationForContext(context),
    })
    if (!variety.accepted) continue
    return candidate
  }
  return null
}

/** Sélectionne au plus un bloc compatible par budget ; les blocs de cœur gardent le même focus. */
export function findReusableBlocks(
  date: string,
  context: GenerationContext,
  candidates: readonly Session[] = listRecentSessions(120),
): Map<BlockType, WorkoutBlock> {
  const selected = new Map<BlockType, WorkoutBlock>()
  for (const type of BLOCK_ORDER) {
    const target = context.prescription.blockBudgets[type]
    if (!target) continue
    for (const candidate of candidates) {
      if (candidate.date >= date || candidate.status === 'skipped') continue
      const boundary = type === 'echauffement' || type === 'retour_au_calme'
      if (!boundary && candidate.focus !== context.prescription.focus) continue
      const block = candidate.structure.blocks.find((item) => item.type === type)
      if (!block || !blockHonorsPreferences(block, context)) continue
      const duration = blockDuration(block)
      if (duration < target * 0.9 || duration > target) continue
      selected.set(type, structuredClone(block))
      break
    }
  }
  return selected
}

/**
 * Le profil renforcement historique réserve 20 % au bloc dédié, tandis que la politique
 * bloquante demande 35 % du cœur. Le fallback déplace donc 5 % de technique vers ce bloc.
 */
function fallbackBudgets(context: GenerationContext): BlockBudgets {
  const budgets = { ...context.prescription.blockBudgets }
  if (context.prescription.category === 'renforcement') {
    const required = Math.ceil((budgets.technique + budgets.cardio + budgets.renforcement) * 0.35)
    const delta = Math.max(0, required - budgets.renforcement)
    budgets.technique -= delta
    budgets.renforcement += delta
  }
  return budgets
}

/** Fallback local, déterministe, sans matériel imposé et validé par la politique active. */
export function buildDeterministicFallbackSession(
  context: GenerationContext,
  reusableBlocks: ReadonlyMap<BlockType, WorkoutBlock> = new Map(),
): { session: WorkoutSession; reusedBlockCount: number } {
  const budgets = fallbackBudgets(context)
  const selectedSkillId =
    context.prescription.skillSelection.newSkillId ??
    context.prescription.skillSelection.consolidatedSkillIds[0] ??
    null
  let reusedBlockCount = 0
  const blocks: WorkoutBlock[] = []

  for (const type of BLOCK_ORDER) {
    const budget = budgets[type]
    if (!budget) continue
    const reusable = reusableBlocks.get(type)
    if (
      reusable &&
      blockDuration(reusable) === budget &&
      blockHonorsPreferences(reusable, context)
    ) {
      blocks.push(structuredClone(reusable))
      reusedBlockCount += 1
      continue
    }

    const template = exerciseTemplates(type, context.prescription.focus, selectedSkillId).find(
      (item) => {
        const exercise = intervalExercise(item, budget)
        return !matchingStrictExclusion(exercise, type, context.prescription.exercisePreferences)
      },
    )
    if (!template) {
      throw new Error(`Aucun exercice local compatible pour le bloc ${type}.`)
    }
    blocks.push({
      type,
      title: blockTitle(type),
      description: 'Bloc local sûr et reproductible, adapté à la prescription du jour.',
      exercises: [intervalExercise(template, budget)],
    })
  }

  const session: WorkoutSession = {
    title: 'Séance essentielle du jour',
    curriculumVersion: BEGINNER_CURRICULUM.version,
    category: context.prescription.category,
    focus: context.prescription.focus,
    summary: 'Une séance fiable et progressive construite localement selon tes contraintes.',
    coachNote:
      'Le coach en ligne est indisponible. Cette séance de secours respecte ta prescription, tes exclusions actives et une intensité contrôlée.',
    estimatedDurationMin: context.dureeCibleMin,
    blocks,
  }
  const policy = validateSessionPolicy(session, policyForContext(context))
  if (!policy.valid || estimateSessionSeconds(session) !== context.prescription.targetSeconds) {
    throw new Error(
      `Le fallback local ne satisfait pas la politique active (${policy.violations.map((v) => v.code).join(', ')}).`,
    )
  }
  return { session, reusedBlockCount }
}

export function orderedGenerationBlocks(
  generatedBlocks: readonly WorkoutBlock[],
  reusableBlocks: ReadonlyMap<BlockType, WorkoutBlock>,
): WorkoutBlock[] {
  const byType = new Map<BlockType, WorkoutBlock>()
  for (const block of generatedBlocks) byType.set(block.type, block)
  for (const [type, block] of reusableBlocks) byType.set(type, structuredClone(block))
  return BLOCK_ORDER.flatMap((type) => (byType.has(type) ? [byType.get(type)!] : []))
}

export function blockTypesMissingFromReuse(
  context: GenerationContext,
  reusableBlocks: ReadonlyMap<BlockType, WorkoutBlock>,
): BlockType[] {
  return BLOCK_ORDER.filter(
    (type) => context.prescription.blockBudgets[type] > 0 && !reusableBlocks.has(type),
  )
}
