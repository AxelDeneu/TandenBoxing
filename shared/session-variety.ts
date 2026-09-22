import { daysBetween } from './dates'
import type { BlockType, Exercise, ExerciseCategory, WorkoutSession } from './session-schema'

/**
 * Primitives pures de variété des séances.
 *
 * Elles ne connaissent ni le planner, ni la base de données, ni le fournisseur IA. Le planner
 * de l'issue #2 peut donc ajouter `WorkoutVarietyConstraints` à sa prescription sans créer de
 * dépendance inverse vers le service de génération.
 */

export type SessionSegment = 'warmup' | 'main' | 'cooldown'

export interface ExerciseLike {
  name: string
  category?: ExerciseCategory | string | null
  combo?: string | null
  intervals?: {
    work: number
    rest: number
    rounds: number
  } | null
  restAfterSec?: number | null
}

export interface WorkoutBlockLike {
  type: BlockType | string
  exercises: readonly ExerciseLike[]
}

export interface WorkoutStructureLike {
  blocks: readonly WorkoutBlockLike[]
}

export interface ExerciseSignature {
  movementFamily: string
  modality: string
  objective: string
  comboFamily: string
  comboPattern: string | null
  blockType: string
  intervalFormat: string
}

export interface SignedExercise {
  name: string
  signature: ExerciseSignature
  durationSec: number
}

export interface SessionVarietySignature {
  date: string | null
  segments: Record<SessionSegment, SignedExercise[]>
}

export interface SignatureFrequencies {
  movementFamily: Record<string, number>
  modality: Record<string, number>
  objective: Record<string, number>
  comboFamily: Record<string, number>
  blockType: Record<string, number>
  intervalFormat: Record<string, number>
}

export interface SafeRoutineVariant {
  id: string
  label: string
  segment: 'warmup' | 'cooldown'
  exercises: readonly string[]
  guidance: string
}

export interface RankedSafeRoutineVariant extends SafeRoutineVariant {
  noveltyScore: number
}

export interface VarietyMemory {
  /** Les cinq dernières séances au maximum, de la plus récente à la plus ancienne. */
  sessions: SessionVarietySignature[]
  frequencies: SignatureFrequencies
  frequenciesBySegment: Record<SessionSegment, SignatureFrequencies>
  safeRoutineSuggestions: {
    warmup: RankedSafeRoutineVariant[]
    cooldown: RankedSafeRoutineVariant[]
  }
}

export interface VarietyHistoryEntry {
  date: string
  structure: WorkoutStructureLike | WorkoutSession | null | undefined
}

export interface ExerciseSimilarity {
  movement: number
  combo: number
  intervals: number
  modality: number
  objective: number
  blockType: number
  overall: number
}

export interface SegmentOverlapMetrics {
  exerciseCount: number
  matchedCount: number
  durationSec: number
  overlap: number
  noveltyScore: number
  movementOverlap: number
  comboOverlap: number
  intervalOverlap: number
}

export interface SessionOverlapMetrics {
  /** Chevauchement de toute la séance, échauffement et retour au calme inclus. */
  overall: SegmentOverlapMetrics
  /** Corps principal uniquement : technique, cardio et renforcement. */
  main: SegmentOverlapMetrics
  warmup: SegmentOverlapMetrics
  cooldown: SegmentOverlapMetrics
  /** Score principal exposé pour l'observabilité : 1 - chevauchement du corps principal. */
  noveltyScore: number
}

export interface ConsolidationIntent {
  intentional: true
  /** Motif obligatoire et persistable dans une prescription ou des métriques. */
  reason: string
}

export interface VarietyPolicy {
  /** Le corps principal peut recouvrir 30 % de la séance précédente par défaut. */
  maxMainOverlap: number
  similarityThreshold: number
}

export interface VarietyComparison {
  date: string | null
  metrics: SessionOverlapMetrics
}

export interface VarietyAssessment {
  accepted: boolean
  status: 'within_budget' | 'consolidation_allowed' | 'overlap_exceeded'
  threshold: number
  previousMainOverlap: number
  noveltyScore: number
  consolidationReason: string | null
  reason: string
  comparisons: VarietyComparison[]
}

export interface SignaturePenalty {
  signatureKey: string
  frequency: number
  penalty: number
}

/** Interface d'intégration prévue pour la prescription déterministe de l'issue #2. */
export interface WorkoutVarietyConstraints {
  maxMainOverlap: number
  similarityThreshold: number
  repetitionBudget: Record<SessionSegment, number>
  recentSessions: SessionVarietySignature[]
  repeatPenalties: SignaturePenalty[]
  preferredWarmupVariantIds: string[]
  preferredCooldownVariantIds: string[]
  consolidation: {
    intentional: boolean
    reason: string | null
  }
}

export const DEFAULT_VARIETY_POLICY: VarietyPolicy = {
  maxMainOverlap: 0.3,
  similarityThreshold: 0.7,
}

/** Répertoire borné de routines sans matériel et à faible risque pour un débutant. */
export const SAFE_WARMUP_VARIANTS: readonly SafeRoutineVariant[] = [
  {
    id: 'mobilite-garde',
    label: 'Mobilité et mise en garde',
    segment: 'warmup',
    exercises: ['Rotations articulaires douces', 'Marche active en garde', 'Shadow boxing léger'],
    guidance: 'Amplitude progressive, sans impact et sans mouvement balistique.',
  },
  {
    id: 'appuis-progressifs',
    label: 'Appuis progressifs',
    segment: 'warmup',
    exercises: ['Pas avant-arrière contrôlés', 'Pas latéraux en garde', 'Jab léger dans le vide'],
    guidance: 'Petits pas, genoux souples et intensité conversationnelle.',
  },
  {
    id: 'activation-sans-saut',
    label: 'Activation sans saut',
    segment: 'warmup',
    exercises: ['Marche genoux bas', 'Squats partiels contrôlés', 'Cercles de bras'],
    guidance: 'Aucun saut, aucune charge et montée cardiaque graduelle.',
  },
  {
    id: 'coordination-shadow',
    label: 'Coordination en shadow',
    segment: 'warmup',
    exercises: [
      'Transferts de poids doux',
      'Pivots courts sans frappe',
      'Directs relâchés dans le vide',
    ],
    guidance: 'Précision avant vitesse, poings relâchés et retour systématique en garde.',
  },
]

export const SAFE_COOLDOWN_VARIANTS: readonly SafeRoutineVariant[] = [
  {
    id: 'respiration-epaules',
    label: 'Respiration et épaules',
    segment: 'cooldown',
    exercises: [
      'Respiration diaphragmatique',
      'Étirement doux des épaules',
      'Ouverture des pectoraux',
    ],
    guidance: 'Respiration lente et étirements sans douleur ni rebond.',
  },
  {
    id: 'dos-flancs',
    label: 'Dos et flancs',
    segment: 'cooldown',
    exercises: ['Respiration lente', 'Étirement doux du dos', 'Étirement latéral des flancs'],
    guidance: 'Revenir au calme avant des amplitudes confortables et stables.',
  },
  {
    id: 'hanches-mollets',
    label: 'Hanches et mollets',
    segment: 'cooldown',
    exercises: ['Marche lente', 'Étirement doux des hanches', 'Étirement des mollets'],
    guidance: 'Appuis stables, aucune traction forcée et souffle continu.',
  },
  {
    id: 'retour-global',
    label: 'Retour au calme global',
    segment: 'cooldown',
    exercises: [
      'Balancement relâché des bras',
      'Étirement doux des jambes',
      'Respiration avec expiration longue',
    ],
    guidance: 'Décélération progressive et posture confortable.',
  },
]

const MOVEMENT_ALIASES: readonly { family: string; patterns: readonly RegExp[] }[] = [
  { family: 'jab', patterns: [/\bjabs?\b/, /\bdirects? avant\b/, /\bbras avant\b/] },
  {
    family: 'cross',
    patterns: [/\bcross\b/, /\bdirects? arriere\b/, /\bdirects? du bras arriere\b/],
  },
  { family: 'crochets', patterns: [/\bcrochets?\b/, /\bhooks?\b/] },
  { family: 'uppercuts', patterns: [/\bupper[ -]?cuts?\b/, /\bupper\b/] },
  {
    family: 'defense',
    patterns: [/\besquives?\b/, /\bslips?\b/, /\bblocages?\b/, /\bgarde haute\b/, /\broule/],
  },
  {
    family: 'deplacements',
    patterns: [
      /\bjeu de jambes\b/,
      /\bdeplacements?\b/,
      /\bpas lateraux?\b/,
      /\bpivots?\b/,
      /\bappuis\b/,
    ],
  },
  { family: 'pompes', patterns: [/\bpompes?\b/, /\bpush[ -]?ups?\b/] },
  { family: 'gainage', patterns: [/\bgainage\b/, /\bplanches?\b/, /\bmountain climbers?\b/] },
  { family: 'squats', patterns: [/\bsquats?\b/, /\bflexions? de jambes\b/] },
  { family: 'fentes', patterns: [/\bfentes?\b/, /\blunges?\b/] },
  { family: 'burpees', patterns: [/\bburpees?\b/] },
  {
    family: 'montee_cardiaque',
    patterns: [
      /\bmontees? de genoux\b/,
      /\bcourse sur place\b/,
      /\bjumping jacks?\b/,
      /\bsauts? ecartes?\b/,
    ],
  },
  {
    family: 'mobilite',
    patterns: [
      /\bmobilite\b/,
      /\brotations? articulaires?\b/,
      /\bcercles? de bras\b/,
      /\btransferts? de poids\b/,
    ],
  },
  {
    family: 'respiration',
    patterns: [/\brespiration\b/, /\bsouffle\b/, /\bcoherence cardiaque\b/],
  },
  { family: 'etirements', patterns: [/\betirements?\b/, /\bouverture des pectoraux\b/] },
]

const PUNCH_FAMILIES = new Set(['jab', 'cross', 'crochets', 'uppercuts'])

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value))
}

function rounded(value: number): number {
  return Math.round(value * 10_000) / 10_000
}

/** Normalisation utilisée avant toute reconnaissance de synonymes. */
export function normalizeExerciseText(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ')
}

export function normalizeCombo(combo: string | null | undefined): string | null {
  if (!combo) return null
  const punches = combo.match(/[1-6]/g)
  return punches?.length ? punches.join('-') : null
}

function familyFromPunches(punches: readonly string[]): string {
  const values = new Set(punches)
  if (values.size === 1 && values.has('1')) return 'jab'
  if (values.size === 1 && values.has('2')) return 'cross'
  if ([...values].every((value) => value === '1' || value === '2')) return 'directs'
  if ([...values].every((value) => value === '3' || value === '4')) return 'crochets'
  if ([...values].every((value) => value === '5' || value === '6')) return 'uppercuts'
  return 'combinaison_mixte'
}

function inferMovementFamily(name: string, comboPattern: string | null, blockType: string): string {
  const normalized = normalizeExerciseText(name)
  const aliases = MOVEMENT_ALIASES.filter(({ patterns }) =>
    patterns.some((pattern) => pattern.test(normalized)),
  ).map(({ family }) => family)
  const unique = [...new Set(aliases)]

  if (unique.length === 1) return unique[0]!
  if (unique.length > 1 && unique.every((family) => PUNCH_FAMILIES.has(family))) {
    const directOnly = unique.every((family) => family === 'jab' || family === 'cross')
    return directOnly ? 'directs' : 'combinaison_mixte'
  }
  if (unique.length > 1) return unique[0]!

  if (comboPattern) return familyFromPunches(comboPattern.split('-'))
  if (blockType === 'echauffement') return 'activation_generale'
  if (blockType === 'retour_au_calme') return 'recuperation_generale'
  return normalized.split(' ').slice(0, 3).join('_') || 'autre'
}

function inferModality(name: string, movementFamily: string, blockType: string): string {
  const normalized = normalizeExerciseText(name)
  if (/\bsac\b|\bfrappes?\b|\bimpact\b/.test(normalized)) return 'sac'
  if (/\bshadow\b|\bdans le vide\b|\bboxe a vide\b/.test(normalized)) return 'shadow'
  if (movementFamily === 'respiration') return 'respiration'
  if (movementFamily === 'etirements') return 'etirement'
  if (movementFamily === 'mobilite') return 'mobilite'
  if (
    ['pompes', 'gainage', 'squats', 'fentes', 'burpees', 'montee_cardiaque'].includes(
      movementFamily,
    )
  ) {
    return 'poids_du_corps'
  }
  if (blockType === 'retour_au_calme') return 'recuperation_sans_materiel'
  return 'sans_materiel'
}

function inferObjective(category: string | null | undefined, blockType: string): string {
  if (blockType === 'echauffement') return 'activation'
  if (blockType === 'retour_au_calme') return 'recuperation'
  const objectives: Record<string, string> = {
    technique: 'technique',
    cardio: 'cardio',
    renforcement: 'force_endurance',
    mobilite: 'mobilite',
    recuperation: 'recuperation',
  }
  return objectives[category ?? ''] ?? blockType
}

function comboFamily(comboPattern: string | null): string {
  return comboPattern ? familyFromPunches(comboPattern.split('-')) : 'sans_combo'
}

function intervalFormat(intervals: ExerciseLike['intervals']): string {
  if (!intervals) return 'non_renseigne'
  const work = intervals.work <= 30 ? 'court' : intervals.work <= 60 ? 'moyen' : 'long'
  const restRatio = intervals.work > 0 ? intervals.rest / intervals.work : 0
  const density = restRatio <= 0.25 ? 'dense' : restRatio <= 0.75 ? 'equilibre' : 'recuperation'
  const rounds = intervals.rounds === 1 ? 'unique' : intervals.rounds <= 4 ? 'quelques' : 'repetes'
  return `${work}:${density}:${rounds}`
}

export function createExerciseSignature(
  exercise: ExerciseLike | Exercise,
  blockType: BlockType | string,
): ExerciseSignature {
  const comboPattern = normalizeCombo(exercise.combo)
  const movementFamily = inferMovementFamily(exercise.name, comboPattern, blockType)
  return {
    movementFamily,
    modality: inferModality(exercise.name, movementFamily, blockType),
    objective: inferObjective(exercise.category, blockType),
    comboFamily: comboFamily(comboPattern),
    comboPattern,
    blockType,
    intervalFormat: intervalFormat(exercise.intervals),
  }
}

function exerciseDuration(exercise: ExerciseLike): number {
  if (!exercise.intervals) return 1
  const { work, rest, rounds } = exercise.intervals
  return Math.max(1, rounds * work + Math.max(0, rounds - 1) * rest + (exercise.restAfterSec ?? 0))
}

export function segmentForBlock(blockType: string): SessionSegment {
  if (blockType === 'echauffement') return 'warmup'
  if (blockType === 'retour_au_calme') return 'cooldown'
  return 'main'
}

export function createSessionVarietySignature(
  structure: WorkoutStructureLike | WorkoutSession,
  date: string | null = null,
): SessionVarietySignature {
  const segments: Record<SessionSegment, SignedExercise[]> = {
    warmup: [],
    main: [],
    cooldown: [],
  }
  for (const block of structure.blocks ?? []) {
    const segment = segmentForBlock(block.type)
    for (const exercise of block.exercises ?? []) {
      segments[segment].push({
        name: exercise.name,
        signature: createExerciseSignature(exercise, block.type),
        durationSec: exerciseDuration(exercise),
      })
    }
  }
  return { date, segments }
}

function movementSimilarity(left: string, right: string): number {
  if (left === right) return 1
  const directFamilies = new Set(['jab', 'cross', 'directs'])
  if (directFamilies.has(left) && directFamilies.has(right)) return 0.8
  const combinationFamilies = new Set(['directs', 'crochets', 'uppercuts', 'combinaison_mixte'])
  if (combinationFamilies.has(left) && combinationFamilies.has(right)) return 0.45
  if (
    (left === 'mobilite' && right === 'etirements') ||
    (left === 'etirements' && right === 'mobilite')
  ) {
    return 0.35
  }
  return 0
}

function longestCommonSubsequence(left: readonly string[], right: readonly string[]): number {
  const rows = Array.from({ length: left.length + 1 }, () =>
    Array.from({ length: right.length + 1 }, () => 0),
  )
  for (let i = 1; i <= left.length; i += 1) {
    for (let j = 1; j <= right.length; j += 1) {
      rows[i]![j] =
        left[i - 1] === right[j - 1]
          ? rows[i - 1]![j - 1]! + 1
          : Math.max(rows[i - 1]![j]!, rows[i]![j - 1]!)
    }
  }
  return rows[left.length]![right.length]!
}

function comboSimilarity(left: ExerciseSignature, right: ExerciseSignature): number {
  if (!left.comboPattern && !right.comboPattern) return 1
  if (!left.comboPattern || !right.comboPattern) return 0
  if (left.comboPattern === right.comboPattern) return 1
  const leftPunches = left.comboPattern.split('-')
  const rightPunches = right.comboPattern.split('-')
  const sequence =
    longestCommonSubsequence(leftPunches, rightPunches) /
    Math.max(leftPunches.length, rightPunches.length)
  if (left.comboFamily === right.comboFamily) return 0.65 + sequence * 0.35
  const common = new Set(leftPunches.filter((punch) => rightPunches.includes(punch))).size
  const union = new Set([...leftPunches, ...rightPunches]).size
  return union ? (common / union) * 0.6 : 0
}

function parseIntervalFormat(format: string): [string, string, string] {
  const [work = '', density = '', rounds = ''] = format.split(':')
  return [work, density, rounds]
}

function intervalSimilarity(left: ExerciseSignature, right: ExerciseSignature): number {
  if (left.intervalFormat === right.intervalFormat) return 1
  if (left.intervalFormat === 'non_renseigne' || right.intervalFormat === 'non_renseigne') return 0
  const l = parseIntervalFormat(left.intervalFormat)
  const r = parseIntervalFormat(right.intervalFormat)
  return (Number(l[0] === r[0]) + Number(l[1] === r[1]) + Number(l[2] === r[2])) / 3
}

export function compareExerciseSignatures(
  left: ExerciseSignature,
  right: ExerciseSignature,
): ExerciseSimilarity {
  const movement = movementSimilarity(left.movementFamily, right.movementFamily)
  const combo = comboSimilarity(left, right)
  const intervals = intervalSimilarity(left, right)
  const modality = Number(left.modality === right.modality)
  const objective = Number(left.objective === right.objective)
  const blockType = Number(left.blockType === right.blockType)
  const overall =
    movement * 0.35 +
    combo * 0.25 +
    intervals * 0.2 +
    modality * 0.1 +
    objective * 0.05 +
    blockType * 0.05
  return {
    movement: rounded(movement),
    combo: rounded(combo),
    intervals: rounded(intervals),
    modality,
    objective,
    blockType,
    overall: rounded(overall),
  }
}

export function compareExercises(
  left: ExerciseLike,
  leftBlockType: BlockType | string,
  right: ExerciseLike,
  rightBlockType: BlockType | string,
): ExerciseSimilarity {
  return compareExerciseSignatures(
    createExerciseSignature(left, leftBlockType),
    createExerciseSignature(right, rightBlockType),
  )
}

interface MatchedPair {
  proposedIndex: number
  referenceIndex: number
  similarity: ExerciseSimilarity
}

function emptySegmentMetrics(exerciseCount = 0, durationSec = 0): SegmentOverlapMetrics {
  return {
    exerciseCount,
    matchedCount: 0,
    durationSec,
    overlap: 0,
    noveltyScore: 1,
    movementOverlap: 0,
    comboOverlap: 0,
    intervalOverlap: 0,
  }
}

function computeSegmentOverlap(
  proposed: readonly SignedExercise[],
  reference: readonly SignedExercise[],
  threshold: number,
): SegmentOverlapMetrics {
  const durationSec = proposed.reduce((sum, exercise) => sum + exercise.durationSec, 0)
  if (!proposed.length || !durationSec || !reference.length) {
    return emptySegmentMetrics(proposed.length, durationSec)
  }

  const candidates: MatchedPair[] = []
  proposed.forEach((left, proposedIndex) => {
    reference.forEach((right, referenceIndex) => {
      const similarity = compareExerciseSignatures(left.signature, right.signature)
      if (similarity.overall >= threshold) {
        candidates.push({ proposedIndex, referenceIndex, similarity })
      }
    })
  })
  candidates.sort((a, b) => b.similarity.overall - a.similarity.overall)

  const usedProposed = new Set<number>()
  const usedReference = new Set<number>()
  const matches: MatchedPair[] = []
  for (const candidate of candidates) {
    if (usedProposed.has(candidate.proposedIndex) || usedReference.has(candidate.referenceIndex)) {
      continue
    }
    usedProposed.add(candidate.proposedIndex)
    usedReference.add(candidate.referenceIndex)
    matches.push(candidate)
  }

  const weighted = (field: keyof ExerciseSimilarity) =>
    matches.reduce(
      (sum, match) => sum + proposed[match.proposedIndex]!.durationSec * match.similarity[field],
      0,
    ) / durationSec
  const overlap = weighted('overall')
  return {
    exerciseCount: proposed.length,
    matchedCount: matches.length,
    durationSec,
    overlap: rounded(overlap),
    noveltyScore: rounded(1 - overlap),
    movementOverlap: rounded(weighted('movement')),
    comboOverlap: rounded(weighted('combo')),
    intervalOverlap: rounded(weighted('intervals')),
  }
}

function combineSegmentMetrics(segments: readonly SegmentOverlapMetrics[]): SegmentOverlapMetrics {
  const durationSec = segments.reduce((sum, segment) => sum + segment.durationSec, 0)
  if (!durationSec) return emptySegmentMetrics()
  const weighted = (field: 'overlap' | 'movementOverlap' | 'comboOverlap' | 'intervalOverlap') =>
    segments.reduce((sum, segment) => sum + segment.durationSec * segment[field], 0) / durationSec
  const overlap = weighted('overlap')
  return {
    exerciseCount: segments.reduce((sum, segment) => sum + segment.exerciseCount, 0),
    matchedCount: segments.reduce((sum, segment) => sum + segment.matchedCount, 0),
    durationSec,
    overlap: rounded(overlap),
    noveltyScore: rounded(1 - overlap),
    movementOverlap: rounded(weighted('movementOverlap')),
    comboOverlap: rounded(weighted('comboOverlap')),
    intervalOverlap: rounded(weighted('intervalOverlap')),
  }
}

function asSessionSignature(
  value: WorkoutStructureLike | WorkoutSession | SessionVarietySignature,
): SessionVarietySignature {
  return 'segments' in value ? value : createSessionVarietySignature(value)
}

export function computeSessionOverlap(
  proposed: WorkoutStructureLike | WorkoutSession | SessionVarietySignature,
  reference: WorkoutStructureLike | WorkoutSession | SessionVarietySignature,
  similarityThreshold = DEFAULT_VARIETY_POLICY.similarityThreshold,
): SessionOverlapMetrics {
  const left = asSessionSignature(proposed)
  const right = asSessionSignature(reference)
  const warmup = computeSegmentOverlap(
    left.segments.warmup,
    right.segments.warmup,
    similarityThreshold,
  )
  const main = computeSegmentOverlap(left.segments.main, right.segments.main, similarityThreshold)
  const cooldown = computeSegmentOverlap(
    left.segments.cooldown,
    right.segments.cooldown,
    similarityThreshold,
  )
  const overall = combineSegmentMetrics([warmup, main, cooldown])
  return { overall, main, warmup, cooldown, noveltyScore: main.noveltyScore }
}

function emptyFrequencies(): SignatureFrequencies {
  return {
    movementFamily: {},
    modality: {},
    objective: {},
    comboFamily: {},
    blockType: {},
    intervalFormat: {},
  }
}

function increment(target: Record<string, number>, key: string): void {
  target[key] = (target[key] ?? 0) + 1
}

function addSignature(frequencies: SignatureFrequencies, signature: ExerciseSignature): void {
  increment(frequencies.movementFamily, signature.movementFamily)
  increment(frequencies.modality, signature.modality)
  increment(frequencies.objective, signature.objective)
  increment(frequencies.comboFamily, signature.comboFamily)
  increment(frequencies.blockType, signature.blockType)
  increment(frequencies.intervalFormat, signature.intervalFormat)
}

function routineNovelty(
  routine: SafeRoutineVariant,
  frequencies: SignatureFrequencies,
  sessionCount: number,
): number {
  const blockType = routine.segment === 'warmup' ? 'echauffement' : 'retour_au_calme'
  const families = routine.exercises.map(
    (name) => createExerciseSignature({ name }, blockType).movementFamily,
  )
  const averageFrequency =
    families.reduce((sum, family) => sum + (frequencies.movementFamily[family] ?? 0), 0) /
    Math.max(1, families.length)
  return rounded(1 - clamp01(averageFrequency / Math.max(1, sessionCount)))
}

export function rankSafeRoutineVariants(
  memory: Pick<VarietyMemory, 'sessions' | 'frequenciesBySegment'>,
  segment: 'warmup' | 'cooldown',
): RankedSafeRoutineVariant[] {
  const variants = segment === 'warmup' ? SAFE_WARMUP_VARIANTS : SAFE_COOLDOWN_VARIANTS
  return variants
    .map((variant) => ({
      ...variant,
      noveltyScore: routineNovelty(
        variant,
        memory.frequenciesBySegment[segment],
        memory.sessions.length,
      ),
    }))
    .sort((a, b) => b.noveltyScore - a.noveltyScore || a.id.localeCompare(b.id))
}

export function buildVarietyMemory(
  history: readonly VarietyHistoryEntry[],
  limit = 5,
): VarietyMemory {
  const boundedLimit = Math.max(3, Math.min(5, limit))
  const sessions = [...history]
    .filter((entry): entry is VarietyHistoryEntry & { structure: WorkoutStructureLike } =>
      Boolean(entry.structure?.blocks),
    )
    .sort((a, b) => b.date.localeCompare(a.date))
    .slice(0, boundedLimit)
    .map((entry) => createSessionVarietySignature(entry.structure, entry.date))

  const frequencies = emptyFrequencies()
  const frequenciesBySegment: Record<SessionSegment, SignatureFrequencies> = {
    warmup: emptyFrequencies(),
    main: emptyFrequencies(),
    cooldown: emptyFrequencies(),
  }
  for (const session of sessions) {
    for (const segment of ['warmup', 'main', 'cooldown'] as const) {
      for (const exercise of session.segments[segment]) {
        addSignature(frequencies, exercise.signature)
        addSignature(frequenciesBySegment[segment], exercise.signature)
      }
    }
  }

  const memory: VarietyMemory = {
    sessions,
    frequencies,
    frequenciesBySegment,
    safeRoutineSuggestions: { warmup: [], cooldown: [] },
  }
  memory.safeRoutineSuggestions = {
    warmup: rankSafeRoutineVariants(memory, 'warmup'),
    cooldown: rankSafeRoutineVariants(memory, 'cooldown'),
  }
  return memory
}

function signatureKey(signature: ExerciseSignature): string {
  return [
    signature.movementFamily,
    signature.modality,
    signature.objective,
    signature.comboFamily,
    signature.blockType,
    signature.intervalFormat,
  ].join('|')
}

/** Construit les budgets/pénalités à attacher directement à la prescription de #2. */
export function buildWorkoutVarietyConstraints(
  memory: VarietyMemory,
  consolidation?: ConsolidationIntent,
): WorkoutVarietyConstraints {
  const counts = new Map<string, number>()
  for (const session of memory.sessions) {
    for (const exercise of session.segments.main) {
      const key = signatureKey(exercise.signature)
      counts.set(key, (counts.get(key) ?? 0) + 1)
    }
  }
  const repeatPenalties = [...counts.entries()]
    .filter(([, frequency]) => frequency > 1)
    .map(([key, frequency]) => ({
      signatureKey: key,
      frequency,
      penalty: rounded(clamp01(frequency / Math.max(1, memory.sessions.length))),
    }))
    .sort((a, b) => b.penalty - a.penalty || a.signatureKey.localeCompare(b.signatureKey))

  return {
    maxMainOverlap: DEFAULT_VARIETY_POLICY.maxMainOverlap,
    similarityThreshold: DEFAULT_VARIETY_POLICY.similarityThreshold,
    repetitionBudget: { main: 0.3, warmup: 0.6, cooldown: 0.6 },
    recentSessions: memory.sessions,
    repeatPenalties,
    preferredWarmupVariantIds: memory.safeRoutineSuggestions.warmup.map(({ id }) => id),
    preferredCooldownVariantIds: memory.safeRoutineSuggestions.cooldown.map(({ id }) => id),
    consolidation: {
      intentional: Boolean(consolidation?.intentional && consolidation.reason.trim()),
      reason: consolidation?.reason.trim() || null,
    },
  }
}

export function assessSessionVariety(
  proposed: WorkoutStructureLike | WorkoutSession | SessionVarietySignature,
  recentSessions: readonly (WorkoutStructureLike | WorkoutSession | SessionVarietySignature)[],
  options: {
    policy?: Partial<VarietyPolicy>
    consolidation?: ConsolidationIntent
  } = {},
): VarietyAssessment {
  const policy = { ...DEFAULT_VARIETY_POLICY, ...options.policy }
  const comparisons = recentSessions.slice(0, 5).map((reference) => {
    const signature = asSessionSignature(reference)
    return {
      date: signature.date,
      metrics: computeSessionOverlap(proposed, signature, policy.similarityThreshold),
    }
  })
  const previousMainOverlap = comparisons[0]?.metrics.main.overlap ?? 0
  const consolidationReason = options.consolidation?.reason.trim() || null
  const intentionalConsolidation = Boolean(
    options.consolidation?.intentional && consolidationReason,
  )
  const withinBudget = previousMainOverlap <= policy.maxMainOverlap
  const accepted = withinBudget || intentionalConsolidation
  const status = withinBudget
    ? 'within_budget'
    : intentionalConsolidation
      ? 'consolidation_allowed'
      : 'overlap_exceeded'
  const weightedOverlap = comparisons.length
    ? comparisons.reduce(
        (sum, comparison, index) => sum + comparison.metrics.main.overlap / (index + 1),
        0,
      ) / comparisons.reduce((sum, _comparison, index) => sum + 1 / (index + 1), 0)
    : 0
  const reason = withinBudget
    ? `Chevauchement principal ${Math.round(previousMainOverlap * 100)} %, dans le budget de ${Math.round(policy.maxMainOverlap * 100)} %.`
    : intentionalConsolidation
      ? consolidationReason!
      : `Chevauchement principal ${Math.round(previousMainOverlap * 100)} %, supérieur au budget de ${Math.round(policy.maxMainOverlap * 100)} % sans consolidation déclarée.`

  return {
    accepted,
    status,
    threshold: policy.maxMainOverlap,
    previousMainOverlap,
    noveltyScore: rounded(1 - weightedOverlap),
    consolidationReason: intentionalConsolidation ? consolidationReason : null,
    reason,
    comparisons,
  }
}

export interface ExerciseSelectionCandidate<T> {
  id: string
  exercise: T
  focusRelevance: number
  prerequisitesMet: boolean
  masteryFit: number
  lastPerformedDate?: string | null
  recentUseCount?: number
  signature?: ExerciseSignature
  /** Score appris [-1, 1], appliqué seulement après les prérequis et la pertinence. */
  preferenceScore?: number
  /** Exclusion non négociable (douleur, impossibilité ou matériel indisponible). */
  strictlyExcluded?: boolean
}

export interface RankedExerciseCandidate<T> extends ExerciseSelectionCandidate<T> {
  relevanceScore: number
  masteryScore: number
  recencyNoveltyScore: number
  score: number
}

function recencyNovelty(
  today: string,
  lastPerformedDate: string | null | undefined,
  recentUseCount = 0,
): number {
  const ageScore = lastPerformedDate
    ? clamp01(Math.max(0, daysBetween(lastPerformedDate, today)) / 30)
    : 1
  const frequencyScore = 1 - clamp01(recentUseCount / 5)
  return ageScore * 0.7 + frequencyScore * 0.3
}

export function rankExerciseCandidates<T>(
  candidates: readonly ExerciseSelectionCandidate<T>[],
  today: string,
): RankedExerciseCandidate<T>[] {
  return candidates
    .filter((candidate) => candidate.prerequisitesMet && !candidate.strictlyExcluded)
    .map((candidate) => {
      const relevanceScore = clamp01(candidate.focusRelevance)
      const masteryScore = clamp01(candidate.masteryFit)
      const preferenceScore = clamp01(((candidate.preferenceScore ?? 0) + 1) / 2)
      const recencyNoveltyScore = recencyNovelty(
        today,
        candidate.lastPerformedDate,
        candidate.recentUseCount,
      )
      return {
        ...candidate,
        relevanceScore: rounded(relevanceScore),
        masteryScore: rounded(masteryScore),
        recencyNoveltyScore: rounded(recencyNoveltyScore),
        score: rounded(
          relevanceScore * 0.5 +
            masteryScore * 0.25 +
            recencyNoveltyScore * 0.15 +
            preferenceScore * 0.1,
        ),
      }
    })
    .sort((a, b) => b.score - a.score || a.id.localeCompare(b.id))
}

/**
 * Sélection déterministe : pertinence et maîtrise restent majoritaires, tandis que la récence
 * devient une pénalité mesurée. Une pénalité sémantique évite aussi de choisir des synonymes.
 */
export function selectExerciseCandidates<T>(
  candidates: readonly ExerciseSelectionCandidate<T>[],
  options: { today: string; limit: number; diversityPenalty?: number },
): RankedExerciseCandidate<T>[] {
  const remaining = rankExerciseCandidates(candidates, options.today)
  const selected: RankedExerciseCandidate<T>[] = []
  const diversityPenalty = options.diversityPenalty ?? 0.15

  while (selected.length < options.limit && remaining.length) {
    const rankedForStep = remaining
      .map((candidate) => {
        const semanticOverlap = candidate.signature
          ? Math.max(
              0,
              ...selected.map((item) =>
                item.signature
                  ? compareExerciseSignatures(candidate.signature!, item.signature).overall
                  : 0,
              ),
            )
          : 0
        return {
          candidate,
          adjustedScore: candidate.score - semanticOverlap * diversityPenalty,
        }
      })
      .sort(
        (a, b) => b.adjustedScore - a.adjustedScore || a.candidate.id.localeCompare(b.candidate.id),
      )
    const next = rankedForStep[0]!.candidate
    selected.push(next)
    remaining.splice(
      remaining.findIndex((candidate) => candidate.id === next.id),
      1,
    )
  }
  return selected
}
