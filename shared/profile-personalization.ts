import { z } from 'zod'

/** Version du contrat explicite objectif + inventaire de matériel. */
export const PROFILE_PERSONALIZATION_VERSION = 'profile-personalization/v1'

export const trainingGoalSchema = z.enum(['cardio-perte-de-gras', 'technique', 'forme-generale'])
export type TrainingGoal = z.infer<typeof trainingGoalSchema>

export const trainingEquipmentSchema = z.enum([
  'sac-de-frappe',
  'corde-a-sauter',
  'elastiques',
  'halteres-legeres',
  'tapis-de-sol',
])
export type TrainingEquipment = z.infer<typeof trainingEquipmentSchema>

export const TRAINING_GOAL_OPTIONS: ReadonlyArray<{
  value: TrainingGoal
  label: string
  hint: string
  /** Dimension directement pilotée dans la prescription déterministe. */
  dimension: 'cardio' | 'technique' | 'renforcement'
}> = [
  {
    value: 'cardio-perte-de-gras',
    label: 'Cardio & dépense énergétique',
    hint: 'Davantage de temps consacré au travail cardio.',
    dimension: 'cardio',
  },
  {
    value: 'technique',
    label: 'Technique de boxe',
    hint: 'Davantage de temps pour apprendre et consolider les gestes.',
    dimension: 'technique',
  },
  {
    value: 'forme-generale',
    label: 'Forme générale',
    hint: 'Davantage de renforcement fonctionnel et équilibré.',
    dimension: 'renforcement',
  },
]

export const TRAINING_EQUIPMENT_OPTIONS: ReadonlyArray<{
  value: TrainingEquipment
  label: string
  hint: string
}> = [
  {
    value: 'sac-de-frappe',
    label: 'Sac + gants + bandes',
    hint: 'Autorise les frappes avec impact uniquement avec les protections adaptées.',
  },
  {
    value: 'corde-a-sauter',
    label: 'Corde à sauter',
    hint: 'Réservée à l’échauffement et au cardio, si tes contraintes le permettent.',
  },
  {
    value: 'elastiques',
    label: 'Élastiques',
    hint: 'Pour l’activation et le renforcement contrôlé, jamais pour frapper en résistance.',
  },
  {
    value: 'halteres-legeres',
    label: 'Haltères légères',
    hint: 'Pour le renforcement uniquement, jamais tenues pendant des frappes.',
  },
  {
    value: 'tapis-de-sol',
    label: 'Tapis de sol',
    hint: 'Autorise les exercices au sol dans de bonnes conditions.',
  },
]

const LEGACY_GOAL_ALIASES: Readonly<Record<string, TrainingGoal>> = {
  cardio: 'cardio-perte-de-gras',
  'perte-de-gras': 'cardio-perte-de-gras',
  'remise-en-forme': 'forme-generale',
  renforcement: 'forme-generale',
  boxing: 'technique',
}

const EQUIPMENT_ALIASES: Readonly<Record<string, TrainingEquipment>> = {
  sac: 'sac-de-frappe',
  'sac de frappe': 'sac-de-frappe',
  'heavy bag': 'sac-de-frappe',
  corde: 'corde-a-sauter',
  'corde a sauter': 'corde-a-sauter',
  'corde à sauter': 'corde-a-sauter',
  elastique: 'elastiques',
  elastiques: 'elastiques',
  élastique: 'elastiques',
  élastiques: 'elastiques',
  haltere: 'halteres-legeres',
  halteres: 'halteres-legeres',
  haltère: 'halteres-legeres',
  haltères: 'halteres-legeres',
  tapis: 'tapis-de-sol',
  'tapis de sol': 'tapis-de-sol',
}

function normalizedText(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim()
}

export function normalizeTrainingGoal(value: unknown): TrainingGoal {
  const parsed = trainingGoalSchema.safeParse(value)
  if (parsed.success) return parsed.data
  return LEGACY_GOAL_ALIASES[normalizedText(String(value ?? ''))] ?? 'cardio-perte-de-gras'
}

export interface StoredProfilePersonalization {
  goal: unknown
  equipment: unknown
  personalizationVersion?: string | null
}

export interface ProfilePersonalization {
  version: typeof PROFILE_PERSONALIZATION_VERSION
  goal: TrainingGoal
  equipment: TrainingEquipment[]
  migratedFromLegacy: boolean
}

/**
 * Les profils antérieurs au contrat n'avaient jamais pu déclarer leur matériel. Leur valeur
 * historique `["gants", "bandes"]` représentait donc l'ancien postulat applicatif
 * « sac + protections » et conserve cette capacité jusqu'à la prochaine sauvegarde explicite.
 */
export function resolveProfilePersonalization(
  profile: StoredProfilePersonalization,
): ProfilePersonalization {
  const migratedFromLegacy = profile.personalizationVersion !== PROFILE_PERSONALIZATION_VERSION
  const source = Array.isArray(profile.equipment) ? profile.equipment : []
  const equipment = new Set<TrainingEquipment>()

  for (const raw of source) {
    if (typeof raw !== 'string') continue
    const canonical = trainingEquipmentSchema.safeParse(raw)
    if (canonical.success) {
      equipment.add(canonical.data)
      continue
    }
    const alias = EQUIPMENT_ALIASES[normalizedText(raw)]
    if (alias) equipment.add(alias)
  }

  if (
    migratedFromLegacy &&
    source.some(
      (value) => typeof value === 'string' && ['gants', 'bandes'].includes(normalizedText(value)),
    )
  ) {
    equipment.add('sac-de-frappe')
  }

  return {
    version: PROFILE_PERSONALIZATION_VERSION,
    goal: normalizeTrainingGoal(profile.goal),
    equipment: trainingEquipmentSchema.options.filter((item) => equipment.has(item)),
    migratedFromLegacy,
  }
}

export function canonicalEquipment(values: readonly TrainingEquipment[]): TrainingEquipment[] {
  const selected = new Set(values)
  return trainingEquipmentSchema.options.filter((item) => selected.has(item))
}

interface EquipmentAwareExercise {
  name: string
  explanation?: string | null
  tips?: readonly string[]
  commonMistakes?: readonly string[]
  equipment?: readonly TrainingEquipment[]
}

const EQUIPMENT_PATTERNS: ReadonlyArray<[TrainingEquipment, RegExp]> = [
  ['sac-de-frappe', /\bsac(?: de frappe)?\b|\bfrappe avec impact\b/],
  ['corde-a-sauter', /\bcorde(?: a| à) sauter\b|\bsaut a la corde\b/],
  ['elastiques', /\belastiqu/],
  ['halteres-legeres', /\bhaltere/],
  ['tapis-de-sol', /\btapis(?: de sol)?\b/],
]

const UNSUPPORTED_EQUIPMENT_PATTERNS: ReadonlyArray<[string, RegExp]> = [
  ['pattes-ours', /\bpattes? d[' ]ours\b|\bpao\b/],
  ['kettlebell', /\bkettlebell\b/],
  ['medecine-ball', /\bmedecine ball\b|\bmedicine ball\b/],
  ['banc', /\bbanc\b/],
  ['barre', /\bbarre olympique\b|\bbarre de musculation\b/],
  ['machine', /\bvelo d[' ]appartement\b|\brameur\b|\btapis roulant\b/],
]

function exerciseText(exercise: EquipmentAwareExercise): string {
  return normalizedText(
    [
      exercise.name,
      exercise.explanation,
      ...(exercise.tips ?? []),
      ...(exercise.commonMistakes ?? []),
    ]
      .filter((value): value is string => typeof value === 'string')
      .join(' '),
  )
}

export interface ExerciseEquipmentRequirements {
  required: TrainingEquipment[]
  unsupported: string[]
}

/** Croise le champ structuré avec le texte pour qu'une omission du modèle ne contourne pas la règle. */
export function equipmentRequirementsForExercise(
  exercise: EquipmentAwareExercise,
): ExerciseEquipmentRequirements {
  const text = exerciseText(exercise)
  const required = new Set<TrainingEquipment>(exercise.equipment ?? [])
  for (const [equipment, pattern] of EQUIPMENT_PATTERNS) {
    if (pattern.test(text)) required.add(equipment)
  }
  return {
    required: trainingEquipmentSchema.options.filter((item) => required.has(item)),
    unsupported: UNSUPPORTED_EQUIPMENT_PATTERNS.filter(([, pattern]) => pattern.test(text)).map(
      ([equipment]) => equipment,
    ),
  }
}

export function equipmentIsSafeForBlock(equipment: TrainingEquipment, blockType: string): boolean {
  if (equipment === 'sac-de-frappe') return blockType === 'technique' || blockType === 'cardio'
  if (equipment === 'corde-a-sauter') return blockType === 'echauffement' || blockType === 'cardio'
  if (equipment === 'elastiques') {
    return blockType === 'echauffement' || blockType === 'renforcement'
  }
  if (equipment === 'halteres-legeres') return blockType === 'renforcement'
  return true
}

export interface ExerciseEquipmentCompatibility extends ExerciseEquipmentRequirements {
  missing: TrainingEquipment[]
  unsafe: TrainingEquipment[]
  compatible: boolean
}

export function assessExerciseEquipment(
  exercise: EquipmentAwareExercise,
  blockType: string,
  availableEquipment: readonly TrainingEquipment[],
): ExerciseEquipmentCompatibility {
  const requirements = equipmentRequirementsForExercise(exercise)
  const text = exerciseText(exercise)
  const available = new Set(availableEquipment)
  const missing = requirements.required.filter((equipment) => !available.has(equipment))
  const unsafe = requirements.required.filter(
    (equipment) =>
      !equipmentIsSafeForBlock(equipment, blockType) ||
      ((equipment === 'halteres-legeres' || equipment === 'elastiques') &&
        /\b(shadow|boxe|frapp\w*|jab|cross|crochet|uppercut|direct)\b/.test(text)),
  )
  return {
    ...requirements,
    missing,
    unsafe,
    compatible: !requirements.unsupported.length && !missing.length && !unsafe.length,
  }
}

export function equipmentLabel(equipment: TrainingEquipment): string {
  return TRAINING_EQUIPMENT_OPTIONS.find((option) => option.value === equipment)!.label
}

export function equipmentPromptList(equipment: readonly TrainingEquipment[]): string {
  return equipment.length
    ? equipment.map((item) => `${item} (${equipmentLabel(item)})`).join(', ')
    : 'aucun ; poids du corps et shadow boxing uniquement'
}

export function goalLabel(goal: TrainingGoal): string {
  return TRAINING_GOAL_OPTIONS.find((option) => option.value === goal)!.label
}
