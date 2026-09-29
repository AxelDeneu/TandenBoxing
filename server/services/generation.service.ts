import { z } from 'zod'
import { BEGINNER_CURRICULUM } from '../../shared/curriculum'
import {
  assessExerciseEquipment,
  equipmentPromptList,
  goalLabel,
} from '../../shared/profile-personalization'
import {
  matchingStrictExclusion,
  preferenceReasonLabel,
  tracePreferenceInfluence,
  type ExercisePreferenceConstraints,
  type PreferenceInfluenceTrace,
  type PreferenceReasonCode,
} from '../../shared/exercise-preferences'
import { GENERATOR_VERSIONS, type GeneratorVersions } from '../../shared/generator-version'
import {
  emptyGenerationRunMetrics,
  type GenerationJobSource,
  type GenerationRunMetrics,
  type GenerationStage,
} from '../../shared/generation-jobs'
import { buildSessionPrompt } from '../../shared/generation-prompt'
import { canRewriteGeneratedSession } from '../../shared/session-lifecycle'
import {
  GeneratedSessionValidationError,
  resolveGeneratedSession,
  type GeneratedSessionViolation,
  type GenerationValidationAttempt,
} from '../../shared/session-generation-policy'
import { tagExerciseWithSkills } from '../../shared/skill-history'
import {
  estimateSessionSeconds,
  blockSchema,
  exerciseSchema,
  SESSION_CATEGORY_META,
  workoutSessionSchema,
  type Exercise,
  type BlockType,
  type WorkoutBlock,
  type WorkoutSession,
} from '../../shared/session-schema'
import {
  assessSessionVariety,
  buildVarietyMemory,
  type ConsolidationIntent,
  type VarietyAssessment,
  type VarietyMemory,
} from '../../shared/session-variety'
import type { SkillProgressionSnapshot } from '../../shared/skill-mastery'
import type { VarietyAwareWorkoutPrescription } from '../../shared/workout-prescription'
import type { Session } from '../database/schema'
import type { StructuredGenerationResponse } from '../utils/openrouter'
import { buildWorkoutPrescription } from './workout-prescription.service'
import {
  blockTypesMissingFromReuse,
  buildDeterministicFallbackSession,
  findReusableBlocks,
  findReusableSession,
  orderedGenerationBlocks,
} from './session-library.service'

/** Schéma de sortie structurée imposé au modèle pour une séance complète. */
export const SESSION_OUTPUT = {
  name: 'proposer_seance',
  description:
    'Renvoie la séance de boxe du jour, entièrement structurée (blocs, exercices, intervalles) et prête à être exécutée.',
  schema: z.toJSONSchema(workoutSessionSchema, {
    target: 'draft-2020-12',
  }) as Record<string, unknown>,
}

/** Sortie réduite : le modèle ne renvoie que les blocs absents de la bibliothèque locale. */
export const PARTIAL_SESSION_OUTPUT = {
  name: 'proposer_parties_seance',
  description:
    'Renvoie les métadonnées de séance et uniquement les blocs manquants demandés par l’application.',
  schema: z.toJSONSchema(workoutSessionSchema.extend({ blocks: z.array(blockSchema).min(1) }), {
    target: 'draft-2020-12',
  }) as Record<string, unknown>,
}

/** Schéma de sortie structurée pour un exercice unique (remplacement). */
export const EXERCISE_OUTPUT = {
  name: 'proposer_exercice',
  description: 'Renvoie un exercice de remplacement, structuré et prêt à être exécuté.',
  schema: z.toJSONSchema(exerciseSchema, {
    target: 'draft-2020-12',
  }) as Record<string, unknown>,
}

/**
 * Description des catégories injectée dans le prompt, dérivée de SESSION_CATEGORY_META :
 * l'intention de chaque catégorie n'est décrite qu'à un seul endroit (source de vérité unique).
 */
export const CATEGORY_GUIDE = Object.entries(SESSION_CATEGORY_META)
  .map(([key, meta]) => `- ${key} (${meta.label}) : ${meta.intent}`)
  .join('\n')

/** Description des focus (thèmes techniques) proposables. */
const FOCUS_GUIDE = [
  '- fondations : garde, posture, appuis, respiration, jab (1) et cross (2) propres.',
  '- jeu_de_jambes : déplacements, pivots, entrées/sorties, gestion de la distance.',
  '- defense : garde haute, esquives (slip, roulement), blocages, retour de coup.',
  '- crochets : crochets avant/arrière (3, 4), rotation du buste et des appuis.',
  '- uppercuts : uppercuts avant/arrière (5, 6), travail à distance courte.',
  '- combinaisons : enchaînements de 3 coups et plus, fluidité et rythme.',
  '- puissance : transfert de poids et explosivité maîtrisée, avec ou sans impact selon le matériel.',
  '- corps : travail au corps (plexus, flancs), changements de niveau.',
  '- cardio : densité et endurance de frappe, peu de nouveauté technique.',
  '- gainage : ceinture abdominale et renforcement au poids du corps au service de la frappe.',
].join('\n')

/** Graphe pédagogique stable injecté dans le préfixe cachable du prompt. */
const CURRICULUM_GUIDE = BEGINNER_CURRICULUM.skills
  .map(
    (skill) =>
      `- ${skill.id} (${skill.label})${
        skill.prerequisites.length
          ? ` — prérequis : ${skill.prerequisites.join(', ')}`
          : ' — aucun prérequis'
      }`,
  )
  .join('\n')

export const SYSTEM_PROMPT = `Tu es un coach de boxe anglaise expert, spécialisé dans l'entraînement à domicile. Tu conçois des séances matinales sûres, progressives, motivantes et strictement compatibles avec le profil fourni. Tu tutoies l'utilisateur et écris exclusivement en français.

PUBLIC & MATÉRIEL
- L'utilisateur s'entraîne seul, à la maison, le matin, avant sa journée.
- "prescription.personalization.equipment" est l'inventaire fermé et autoritaire. Le poids du corps et le shadow boxing restent toujours disponibles ; n'utilise AUCUN autre matériel.
- Pour chaque exercice, renseigne "equipment" avec les identifiants exacts réellement requis. Une liste vide signifie sans matériel.
- Le sac de frappe n'est permis que dans les blocs technique/cardio. La corde est réservée à l'échauffement/cardio. Les élastiques sont réservés à l'activation/renforcement. Les haltères légères sont réservées au renforcement et ne sont jamais tenues pendant des frappes.
- Niveau DÉBUTANT en boxe anglaise : poings uniquement (jab, cross, crochets, uppercuts). JAMAIS de coups de pied, genoux ou coudes.
- "prescription.personalization.goal" et "goalInfluence" sont autoritaires : respecte leur budget mesurable sans leur substituer un objectif générique.

CATÉGORIE = STRUCTURE DE LA SÉANCE
Le champ "category" définit le TYPE de séance et pilote sa structure et son intensité :
${CATEGORY_GUIDE}

RÈGLES DE STRUCTURE
- Commence TOUJOURS par un bloc "echauffement" (mobilité articulaire, montée cardiaque progressive, shadow léger ; sans matériel, sans impact violent).
- Termine TOUJOURS par un bloc "retour_au_calme" (étirements, respiration, récupération).
- ENTRE LES DEUX, la structure n'est PAS figée : compose les blocs (technique / cardio / renforcement) — leur nombre, leur ordre et leur poids relatif — d'après l'intention de la catégorie décrite ci-dessus. Ne plaque jamais un schéma unique sur toutes les séances.
- Une séance "recuperation" ne contient AUCUN bloc à haute intensité ; une séance "cardio" fait du bloc cardio le cœur de la séance ; une séance "apprentissage" fait du bloc technique le cœur de la séance ; etc.

FOCUS = THÈME TECHNIQUE
Le champ "focus" indique la dominante technique travaillée :
${FOCUS_GUIDE}
Le focus irrigue le bloc technique et, quand c'est pertinent, les autres blocs. La catégorie dit COMMENT on travaille, le focus dit SUR QUOI.

PRESCRIPTION DÉTERMINISTE
- Le contexte contient une "prescription" déjà calculée côté application. Elle décide de la catégorie, du focus, de l'intensité, de la durée, des budgets par type de bloc et du nombre maximal de techniques nouvelles.
- Tu ne reprends AUCUNE de ces décisions : renvoie EXACTEMENT "prescription.category" et "prescription.focus", puis choisis uniquement les exercices et leur rédaction.
- Respecte "prescription.targetSeconds" et chacun des "prescription.blockBudgets". Un budget nul interdit le type de bloc correspondant.
- "demande.focusLibre" et "demande.note" peuvent préciser le contenu des exercices, mais ne changent jamais les champs déjà décidés par la prescription.

CURRICULUM DÉBUTANT — VERSION ${BEGINNER_CURRICULUM.version}
${CURRICULUM_GUIDE}
- Pour CHAQUE exercice, renseigne "skillIds" avec uniquement les identifiants ci-dessus réellement travaillés. Utilise [] pour un exercice physique, cardio ou de mobilité sans apprentissage technique ciblé.
- Le contexte contient "progressionCompetences", calculé à partir des séances terminées et de leurs feedbacks. Utilise ses états, ses nouveautés éligibles et ses prérequis manquants ; ne déduis jamais la maîtrise du seul nombre de séances.
- Sans demande explicite, n'introduis aucune compétence absente de "eligibleNewSkillIds" et respecte "prescription.maxNewTechniques".
- "prescription.skillSelection" est la sélection finale : introduis uniquement "newSkillId", consolide "consolidatedSkillIds", respecte les prérequis manquants et la pédagogie prescrite.
- "requestedSkillId" est une suggestion utilisateur et "targetDecision" la décision du planner. Si elle est adaptée ou reportée, n'introduis jamais la cible bloquée : suis uniquement "newSkillId" et "consolidatedSkillIds", puis explique l'adaptation dans "coachNote".
- Renvoie TOUJOURS "category" ET "focus".

MÉMOIRE & PROGRESSION
Le contexte fournit "memoire" : par focus et par catégorie déjà pratiqués, la dernière date, le nombre de jours écoulés et le nombre de fois travaillés ; plus "combosRecents" et "variete", qui résume les signatures des cinq dernières séances (mouvement, modalité, objectif, combo, bloc et intervalles). "prescription.variety" fournit les budgets et pénalités calculés par l'application.
- Construis une VRAIE progression : reprends et complexifie ce qui est déjà acquis plutôt que de repartir de zéro.
- Évite de resservir tels quels les combos de "combosRecents" : varie les enchaînements.
- Utilise la mémoire pour choisir le contenu et faire progresser les exercices à l'intérieur de la prescription.
- Sauf consolidation intentionnelle, le chevauchement du CORPS PRINCIPAL avec la séance précédente doit rester inférieur ou égal à "prescription.variety.maxMainOverlap" (30 % par défaut). Varie réellement les familles de mouvements, les combos ET les formats d'intervalles, pas seulement les intitulés.
- Une répétition au-delà de ce budget est permise pour consolider un acquis (notamment une séance "renforcement"), mais explique alors précisément cette consolidation dans "coachNote".
- L'échauffement et le retour au calme ont leurs propres budgets : choisis de préférence les premières routines sûres proposées dans "memoire.variete.safeRoutineSuggestions", sans sacrifier la sécurité à la nouveauté.
- Le contexte peut contenir "seancesSautees" (séances récemment non faites, avec la raison éventuelle) : tiens-en compte — reprise en douceur après une coupure, et allègement si la raison évoque une fatigue ou une blessure.

PRÉFÉRENCES D'EXERCICE
- "prescription.exercisePreferences.strictExclusions" contient les exclusions obligatoires apprises à partir de motifs structurés. Ne propose aucun exercice dont le mouvement, la modalité ou la signature correspond à leur portée.
- "prescription.exercisePreferences.weightedPreferences" contient des préférences souples avec score, récence implicite, fréquence et confiance. Favorise un score positif et pénalise un score négatif uniquement après avoir respecté sécurité, matériel, focus, prérequis, progression, budgets et variété.
- Une préférence positive ne justifie jamais une compétence bloquée, une intensité inadaptée ou une répétition hors budget. En cas de conflit, les règles de sécurité et de progression gagnent toujours.

NOTATION DES COMBOS (boxe anglaise)
1 = jab (bras avant) · 2 = cross / direct arrière · 3 = crochet avant · 4 = crochet arrière · 5 = uppercut avant · 6 = uppercut arrière.
Pour chaque exercice TECHNIQUE au sac, fournis le combo en notation chiffrée (champ "combo", ex : "1-2", "1-1-2", "1-2-3-2") ET son décodage en clair (champ "comboExplanation"). Pour les exercices sans combo (échauffement, gainage, étirements), mets "combo" et "comboExplanation" à null.

RÈGLES DE CONCEPTION
- Respecte STRICTEMENT la durée et les budgets de blocs de la prescription. La somme, sur tous les exercices, de rounds × work + (rounds - 1) × rest + restAfterSec doit approcher chaque budget sans le dépasser.
- Intervalles réalistes pour un débutant : privilégie des rounds courts (ex : 20-40 s d'effort) avec repos suffisant. Le format peut s'inspirer du Tabata ou de mini-rounds. Adapte selon le bloc et la catégorie (technique = plus de repos, cardio = plus dense, récupération = très léger).
- Progression : ajuste le volume, l'intensité et la complexité des combos selon l'historique et les derniers ressentis. Si les dernières séances ont été jugées trop dures (difficulté élevée, énergie basse, courbatures marquées), allège. Si trop faciles, intensifie et enrichis les combos.
- Reprise en douceur après des séances ratées ou une coupure : ne saute pas d'étapes, réduis un peu l'intensité.
- Sécurité : pour un débutant, insiste sur la posture, la garde, la respiration. Rien de dangereux. Tiens compte des contraintes/blessures indiquées (adapte ou évite les zones concernées).
- Pédagogie : explications détaillées, claires, étape par étape. Pour chaque exercice, remplis "tips" (2 à 4 conseils concrets) et "commonMistakes" (1 à 3 erreurs fréquentes à éviter).
- Variété : évite la monotonie d'une séance à l'autre tout en gardant une cohérence de progression.
- "coachNote" : explique en 2-3 phrases motivantes POURQUOI cette séance aujourd'hui, en t'appuyant explicitement sur les états et faits de "progressionCompetences", la catégorie, le focus et les feedbacks. N'invente jamais un acquis.

Réponds EXCLUSIVEMENT avec un objet JSON conforme au schéma strict fourni par l'application.`

/** Enregistre la consommation de tokens d'un appel (best-effort : n'interrompt jamais la génération). */
function recordUsage(
  response: StructuredGenerationResponse,
  kind: 'seance' | 'exercice' | 'ajustement',
  date: string | null,
): Pick<
  GenerationRunMetrics,
  'inputTokens' | 'outputTokens' | 'cacheCreationTokens' | 'cacheReadTokens'
> {
  const usage = {
    ...response.usage,
  }
  try {
    recordAiUsage({
      sessionDate: date,
      kind,
      model: response.model,
      costUsd: response.costUsd,
      ...usage,
    })
  } catch {
    console.error(
      '[generation] ' +
        JSON.stringify({ event: 'usage_recording_failed', code: 'USAGE_RECORDING_FAILED' }),
    )
  }
  return usage
}

function addResponseUsage(
  metrics: GenerationRunMetrics,
  response: StructuredGenerationResponse,
  kind: 'seance' | 'exercice' | 'ajustement',
  date: string | null,
  latencyMs: number,
): void {
  const usage = recordUsage(response, kind, date)
  metrics.modelCalls += 1
  metrics.inputTokens += usage.inputTokens
  metrics.outputTokens += usage.outputTokens
  metrics.cacheCreationTokens += usage.cacheCreationTokens
  metrics.cacheReadTokens += usage.cacheReadTokens
  metrics.costUsd =
    metrics.costUsd === null || response.costUsd === null
      ? null
      : metrics.costUsd + response.costUsd
  metrics.providerLatencyMs += latencyMs
}

export class GenerationExecutionError extends Error {
  readonly kind: 'temporary' | 'permanent'
  readonly code: string
  readonly actionableMessage: string

  constructor(
    kind: 'temporary' | 'permanent',
    code: string,
    message: string,
    actionableMessage: string,
    options?: ErrorOptions,
  ) {
    super(message, options)
    this.name = 'GenerationExecutionError'
    this.kind = kind
    this.code = code
    this.actionableMessage = actionableMessage
  }
}

function providerFailure(error: unknown): GenerationExecutionError {
  if (error instanceof GenerationExecutionError) return error
  const classified = classifyOpenRouterError(error)
  return new GenerationExecutionError(
    classified.kind,
    classified.code,
    classified.message,
    classified.actionableMessage,
    { cause: error },
  )
}

interface HistoryEntry {
  date: string
  jour: string
  titre: string
  categorie: string | null
  focus: string
  dureeCibleMin: number
  statut: string
  complete: boolean
  feedbackGlobal: {
    difficulte: number | null
    energie: number | null
    courbatures: string[]
    plaisir: number | null
    commentaire: string | null
    dureeReelleMin: number | null
  } | null
  exercices: { nom: string; difficulte: number | null; commentaire: string | null }[]
}

/** Ancienneté et fréquence d'un focus / d'une catégorie. */
interface MemoryStat {
  derniereDate: string
  joursDepuis: number
  nombre: number
}

interface MemorySummary {
  parFocus: Record<string, MemoryStat>
  parCategorie: Record<string, MemoryStat>
  /** Combos vus dans les séances récentes (dédupliqués) : à ne pas resservir tels quels. */
  combosRecents: string[]
  /** Signatures et fréquences des cinq dernières séances, calculées sans IA. */
  variete: VarietyMemory
}

/** Intention planifiée par l'utilisateur pour cette date. */
interface GenerationRequest {
  /** Null = catégorie laissée au choix de l'IA. */
  categorie: string | null
  focus: string | null
  competenceCible: string | null
  /** Thème libre d'une séance sur mesure (ex : « pectoraux ») ; prime sur `focus`. */
  focusLibre: string | null
  note: string | null
}

/** Séance récemment sautée (non faite), avec la raison éventuelle. */
interface SkippedEntry {
  date: string
  jour: string
  categorie: string | null
  focus: string
  raison: string | null
}

export interface GenerationContext {
  /** Versions persistées avec la séance pour attribuer toute évolution ou régression. */
  generatorVersions: GeneratorVersions
  date: string
  jour: string
  dureeCibleMin: number
  profil: Record<string, unknown>
  reglages: Record<string, unknown>
  tendance: Record<string, unknown>
  poids: Record<string, unknown> | null
  /** Décisions déterministes que la génération et la future politique de validation partagent. */
  prescription: VarietyAwareWorkoutPrescription
  /** Présent uniquement si la date a été planifiée : le modèle doit la respecter. */
  demande?: GenerationRequest
  memoire: MemorySummary
  /** Mesures calculées après génération et persistées pour l'observabilité. */
  evaluationVariete?: VarietyAssessment
  /** Contrat pur de #4, directement consommable par le planner de prescription de #2. */
  progressionCompetences: SkillProgressionSnapshot
  /** Résultat borné de l'application des préférences, sans commentaire libre. */
  preferenceInfluence?: PreferenceInfluenceTrace
  historique: HistoryEntry[]
  /** Séances récemment sautées, avec raison : signal de coaching (reprise en douceur, fatigue…). */
  seancesSautees?: SkippedEntry[]
}

function logGenerationViolations(
  date: string,
  attempt: GenerationValidationAttempt,
  violations: readonly GeneratedSessionViolation[],
): void {
  // Journal strictement structuré : codes, chemins et valeurs bornées, jamais les champs libres.
  console.info(
    '[generation-policy] ' +
      JSON.stringify({
        event: 'session_validation_failed',
        date,
        attempt,
        violations: violations.map(({ code, path }) => ({ code, path })),
      }),
  )
}

/**
 * Résume la mémoire d'entraînement : pour chaque focus et chaque catégorie déjà pratiqués,
 * l'ancienneté et le nombre de répétitions, plus les combos et signatures récents. Sert la
 * progression (reprendre les acquis) et la variété (ne pas resservir la même enveloppe).
 */
function buildMemory(date: string, completed: Session[]): MemorySummary {
  const parFocus: Record<string, MemoryStat> = {}
  const parCategorie: Record<string, MemoryStat> = {}

  const bump = (acc: Record<string, MemoryStat>, key: string | null, seanceDate: string) => {
    if (!key) return
    const stat = acc[key]
    if (!stat) {
      acc[key] = { derniereDate: seanceDate, joursDepuis: daysBetween(seanceDate, date), nombre: 1 }
      return
    }
    stat.nombre += 1
    if (seanceDate > stat.derniereDate) {
      stat.derniereDate = seanceDate
      stat.joursDepuis = daysBetween(seanceDate, date)
    }
  }

  for (const s of completed) {
    bump(parFocus, s.focus, s.date)
    bump(parCategorie, s.category, s.date)
  }

  // `completed` est trié du plus récent au plus ancien : les 5 dernières séances suffisent.
  const combosRecents = [
    ...new Set(
      completed
        .slice(0, 5)
        .flatMap((s) => s.structure?.blocks ?? [])
        .flatMap((b) => b.exercises)
        .map((e) => e.combo)
        .filter((combo): combo is string => Boolean(combo)),
    ),
  ]

  const variete = buildVarietyMemory(
    completed.map((session) => ({ date: session.date, structure: session.structure })),
  )

  return { parFocus, parCategorie, combosRecents, variete }
}

/** Rassemble tout le contexte nécessaire à la génération d'une séance pour `date`. */
export function buildGenerationContext(date: string): {
  settingsRow: ReturnType<typeof getSettings>
  context: GenerationContext
} {
  const settingsRow = getSettings()
  const profileRow = getProfile()

  // La prescription partage la même source pour les générations directes et différées.
  const plan = getPlan(date)
  const progressionCompetences = getSkillProgression(date)
  const prescription = buildWorkoutPrescription(date, {}, progressionCompetences)
  const dureeCibleMin = prescription.targetSeconds / 60

  const allCompleted = listCompletedSessions()
  const past = allCompleted.filter((s) => s.date !== date)
  const recent = past.slice(0, 8)

  const ids = recent.map((s) => s.id)
  const sFeedback = listSessionFeedbackByIds(ids)
  const eFeedback = listExerciseFeedbackByIds(ids)

  const historique: HistoryEntry[] = recent.map((s) => {
    const sf = sFeedback.find((f) => f.sessionId === s.id)
    const exs = eFeedback
      .filter((f) => f.sessionId === s.id)
      .map((f) => ({ nom: f.exerciseName, difficulte: f.difficulty, commentaire: f.comment }))
    return {
      date: s.date,
      jour: weekdayLabel(s.date),
      titre: s.title,
      categorie: s.category,
      focus: s.focus,
      dureeCibleMin: s.targetDurationMin,
      statut: s.status,
      complete: s.status === 'completed',
      feedbackGlobal: sf
        ? {
            difficulte: sf.overallDifficulty,
            energie: sf.energyLevel,
            courbatures: sf.soreness ?? [],
            plaisir: sf.enjoyment,
            commentaire: sf.comment,
            dureeReelleMin: sf.actualDurationSec ? Math.round(sf.actualDurationSec / 60) : null,
          }
        : null,
      exercices: exs,
    }
  })

  const cutoff7 = addDays(date, -7)
  const cutoff30 = addDays(date, -30)
  const inRange = allCompleted.filter((s) => s.date >= cutoff30 && s.date < date)
  const seances7j = inRange.filter((s) => s.date >= cutoff7).length
  const derniere = recent[0]?.date ?? null

  let poids: Record<string, unknown> | null = null
  if (settingsRow.weightTrackingEnabled) {
    const all = listWeights()
    if (all.length) {
      const actuel = all[all.length - 1]!
      const ancien = all.find((w) => w.date >= cutoff30) ?? all[0]!
      poids = {
        actuelKg: actuel.weightKg,
        dateActuel: actuel.date,
        variation30jKg: Math.round((actuel.weightKg - ancien.weightKg) * 10) / 10,
      }
    }
  }

  const memoire = buildMemory(date, past)
  const context: GenerationContext = {
    generatorVersions: GENERATOR_VERSIONS,
    date,
    jour: weekdayLabel(date),
    dureeCibleMin,
    profil: {
      niveau: profileRow.level,
      objectif: profileRow.goal,
      discipline: profileRow.discipline,
      conditionPhysique: profileRow.fitnessLevel,
      experience: profileRow.experience,
      age: profileRow.age,
      materiel: profileRow.equipment,
      contraintes: profileRow.constraints,
      notes: profileRow.notes,
    },
    reglages: {
      joursEntrainement: settingsRow.trainingDays,
      dureeCibleMin,
    },
    tendance: {
      seances7j,
      seances30j: inRange.length,
      derniereSeance: derniere,
      joursDepuisDerniereSeance: derniere ? daysBetween(derniere, date) : null,
    },
    poids,
    prescription,
    memoire,
    progressionCompetences,
    historique,
  }

  // Séances récemment sautées (avec raison) : reprise en douceur, allègement si fatigue/blessure.
  const skipped = listRecentSessions(30)
    .filter((s) => s.status === 'skipped' && s.date < date)
    .slice(0, 5)
  if (skipped.length) {
    const skippedFb = listSessionFeedbackByIds(skipped.map((s) => s.id))
    context.seancesSautees = skipped.map((s) => ({
      date: s.date,
      jour: weekdayLabel(s.date),
      categorie: s.category,
      focus: s.focus,
      raison: skippedFb.find((f) => f.sessionId === s.id)?.comment ?? null,
    }))
  }

  // Séance planifiée à l'avance : le modèle doit respecter l'intention demandée.
  if (plan) {
    context.demande = {
      categorie: plan.category,
      focus: plan.focus,
      competenceCible: plan.requestedSkillId,
      focusLibre: plan.customFocus,
      note: plan.note,
    }
  }

  return { settingsRow, context }
}
export interface GenerateSessionOptions {
  regenerate?: boolean
  adjustment?: string | null
  contextHash?: string
  source?: GenerationJobSource
  control?: GenerationExecutionControl
}

export interface GenerationExecutionStageEvent {
  stage: GenerationStage
  status: 'started' | 'succeeded' | 'failed'
  model?: string
  durationMs?: number
  errorCode?: string
}

export interface GenerationExecutionControl {
  signal?: AbortSignal
  assertActive?: () => void
  onStage?: (event: GenerationExecutionStageEvent) => void
}

export interface GeneratedSessionResult {
  session: Session
  metrics: GenerationRunMetrics
}

interface PersistGenerationMetadata {
  source: 'model' | 'prefetch' | 'reused' | 'fallback'
  contextHash?: string
  fallbackUsed?: boolean
  reusedFromSessionId?: number | null
  aiModel?: string
}

function persistResolvedSession(
  date: string,
  session: WorkoutSession,
  context: GenerationContext,
  settingsRow: ReturnType<typeof getSettings>,
  metadata: PersistGenerationMetadata,
): Session {
  const current = findSessionByDate(date)
  if (current && !canRewriteGeneratedSession(current.status)) {
    throw new GenerationExecutionError(
      'permanent',
      'SESSION_IMMUTABLE',
      'La séance a été démarrée ou clôturée pendant sa génération.',
      'La séance existante est conservée sans modification.',
    )
  }
  const tagged: WorkoutSession = {
    ...session,
    blocks: session.blocks.map((block) => ({
      ...block,
      exercises: block.exercises.map(tagExerciseWithSkills),
    })),
  }
  const prescribedConsolidation = context.prescription.variety.consolidation
  const consolidation: ConsolidationIntent | undefined =
    prescribedConsolidation.intentional && prescribedConsolidation.reason
      ? { intentional: true, reason: prescribedConsolidation.reason }
      : undefined
  context.evaluationVariete = assessSessionVariety(tagged, context.memoire.variete.sessions, {
    consolidation,
  })
  context.preferenceInfluence = tracePreferenceInfluence(
    tagged,
    context.prescription.exercisePreferences,
  )
  const persisted = upsertSessionByDate({
    date,
    status: 'generated',
    title: tagged.title,
    category: tagged.category,
    focus: tagged.focus,
    summary: tagged.summary,
    coachNote: tagged.coachNote,
    targetDurationMin: context.dureeCibleMin,
    estimatedDurationMin: Math.max(1, Math.round(estimateSessionSeconds(tagged) / 60)),
    structure: tagged,
    aiModel: metadata.aiModel ?? settingsRow.aiModel,
    generationSource: metadata.source,
    generationContextHash: metadata.contextHash ?? null,
    fallbackUsed: metadata.fallbackUsed ?? false,
    reusedFromSessionId: metadata.reusedFromSessionId ?? null,
    generationContext: context,
    generatedAt: new Date(),
  })
  if (
    persisted.status !== 'generated' ||
    (metadata.contextHash && persisted.generationContextHash !== metadata.contextHash)
  ) {
    throw new GenerationExecutionError(
      'permanent',
      'SESSION_IMMUTABLE',
      'La séance a été démarrée ou clôturée pendant sa génération.',
      'La séance existante est conservée sans modification.',
    )
  }
  return persisted
}

function lockAdjustmentPrescription(
  date: string,
  context: GenerationContext,
  existing: Session | undefined,
  adjustment: string | undefined,
): void {
  if (!adjustment || !existing?.category) return
  context.demande = {
    categorie: existing.category,
    focus: existing.focus,
    competenceCible: context.demande?.competenceCible ?? null,
    focusLibre: context.demande?.focusLibre ?? null,
    note: context.demande?.note ?? null,
  }
  context.prescription = buildWorkoutPrescription(
    date,
    {
      category: existing.category,
      focus: existing.focus,
      requestedSkillId: context.prescription.skillSelection.requestedSkillId,
    },
    context.progressionCompetences,
  )
}

function partialGenerationPrompt(
  basePrompt: string,
  context: GenerationContext,
  reusableBlocks: ReadonlyMap<BlockType, WorkoutBlock>,
  missingBlockTypes: readonly BlockType[],
): string {
  return [
    basePrompt,
    '',
    'BLOCS VALIDÉS ET RÉUTILISÉS PAR L’APPLICATION (ne les renvoie pas) :',
    '```json',
    JSON.stringify([...reusableBlocks.values()], null, 2),
    '```',
    `Renvoie uniquement les blocs manquants suivants : ${missingBlockTypes.join(', ')}.`,
    'Budgets exacts des blocs manquants :',
    '```json',
    JSON.stringify(
      Object.fromEntries(
        missingBlockTypes.map((type) => [type, context.prescription.blockBudgets[type]]),
      ),
      null,
      2,
    ),
    '```',
    `Renvoie le JSON « ${PARTIAL_SESSION_OUTPUT.name} ». Son champ blocks ne doit contenir que ces blocs manquants ; les métadonnées décrivent la séance complète.`,
  ].join('\n')
}

function preparePartialCandidate(
  input: unknown,
  reusableBlocks: ReadonlyMap<BlockType, WorkoutBlock>,
  missingBlockTypes: readonly BlockType[],
): unknown {
  if (typeof input !== 'object' || !input) return input
  const candidate = input as Record<string, unknown>
  const generatedBlocks = z.array(blockSchema).safeParse(candidate.blocks)
  if (!generatedBlocks.success) return input
  const missing = new Set(missingBlockTypes)
  return {
    ...candidate,
    blocks: orderedGenerationBlocks(
      generatedBlocks.data.filter((block) => missing.has(block.type)),
      reusableBlocks,
    ),
  }
}

function ensureGenerationExecutionActive(control?: GenerationExecutionControl): void {
  control?.signal?.throwIfAborted()
  control?.assertActive?.()
}

function generationStageErrorCode(error: unknown): string {
  if (error instanceof GenerationExecutionError) return error.code
  return classifyOpenRouterError(error).code
}

function beginGenerationStage(
  control: GenerationExecutionControl | undefined,
  stage: GenerationStage,
  model?: string,
): number {
  ensureGenerationExecutionActive(control)
  control?.onStage?.({ stage, status: 'started', ...(model ? { model } : {}) })
  return Date.now()
}

function finishGenerationStage(
  control: GenerationExecutionControl | undefined,
  stage: GenerationStage,
  status: 'succeeded' | 'failed',
  startedAt: number,
  options: { model?: string; errorCode?: string } = {},
): void {
  if (status === 'succeeded') ensureGenerationExecutionActive(control)
  control?.onStage?.({
    stage,
    status,
    durationMs: Math.max(0, Date.now() - startedAt),
    ...options,
  })
}

function persistWithExecutionFence<T>(
  control: GenerationExecutionControl | undefined,
  persist: () => T,
  model?: string,
): T {
  const startedAt = beginGenerationStage(control, 'persistence', model)
  try {
    ensureGenerationExecutionActive(control)
    const result = persist()
    finishGenerationStage(control, 'persistence', 'succeeded', startedAt, { model })
    return result
  } catch (error) {
    finishGenerationStage(control, 'persistence', 'failed', startedAt, {
      model,
      errorCode: generationStageErrorCode(error),
    })
    throw error
  }
}

/**
 * Génère ou réutilise une séance avec des métriques complètes. Le SDK ne fait aucun retry
 * caché : le job persistant reste l'unique pilote du nombre d'essais et du backoff.
 */
export async function generateSessionForDateDetailed(
  date: string,
  options: GenerateSessionOptions = {},
): Promise<GeneratedSessionResult> {
  const existing = findSessionByDate(date)
  const adjustment = options.adjustment?.trim()
  if (
    existing &&
    !canRewriteGeneratedSession(existing.status) &&
    (options.regenerate || adjustment)
  ) {
    throw new GenerationExecutionError(
      'permanent',
      'SESSION_IMMUTABLE',
      'Une séance démarrée ou clôturée ne peut pas être régénérée.',
      'Conserve son historique et crée une autre séance si nécessaire.',
    )
  }
  if (existing && !options.regenerate && !adjustment) {
    ensureGenerationExecutionActive(options.control)
    return { session: existing, metrics: emptyGenerationRunMetrics() }
  }

  const { settingsRow, context } = buildGenerationContext(date)
  const metrics = emptyGenerationRunMetrics()
  lockAdjustmentPrescription(date, context, existing, adjustment)
  const demande = context.demande

  const mayReuse = !adjustment && !existing
  if (mayReuse) {
    const reusable = findReusableSession(date, context)
    if (reusable) {
      metrics.reuseKind = 'session'
      metrics.reusedBlockCount = reusable.structure.blocks.length
      metrics.policyCompliant = true
      return {
        session: persistWithExecutionFence(
          options.control,
          () =>
            persistResolvedSession(
              date,
              structuredClone(reusable.structure),
              context,
              settingsRow,
              {
                source: 'reused',
                contextHash: options.contextHash,
                reusedFromSessionId: reusable.id,
                aiModel: reusable.aiModel,
              },
            ),
          reusable.aiModel,
        ),
        metrics,
      }
    }
  }

  const reusableBlocks: Map<BlockType, WorkoutBlock> = mayReuse
    ? findReusableBlocks(date, context)
    : new Map()
  let missingBlockTypes = blockTypesMissingFromReuse(context, reusableBlocks)
  if (!missingBlockTypes.length && reusableBlocks.size) {
    const coreType = (['technique', 'cardio', 'renforcement'] as BlockType[]).find((type) =>
      reusableBlocks.has(type),
    )
    if (coreType) reusableBlocks.delete(coreType)
    missingBlockTypes = blockTypesMissingFromReuse(context, reusableBlocks)
  }
  if (reusableBlocks.size) {
    metrics.reuseKind = 'blocks'
    metrics.reusedBlockCount = reusableBlocks.size
  }

  const basePrompt = buildSessionPrompt({
    dateLabel: formatDateFr(date),
    context,
    adjustment,
    existingStructure: existing?.structure,
  })
  const partial = reusableBlocks.size > 0 && missingBlockTypes.length > 0
  const userPrompt = partial
    ? partialGenerationPrompt(basePrompt, context, reusableBlocks, missingBlockTypes)
    : basePrompt

  const { openrouterApiKey } = useRuntimeConfig()
  if (!openrouterApiKey) {
    throw new GenerationExecutionError(
      'permanent',
      'PROVIDER_NOT_CONFIGURED',
      'Aucune clé fournisseur n’est configurée.',
      'Configure NUXT_OPENROUTER_API_KEY ou utilise la séance de secours locale.',
    )
  }

  let catalogModel: Awaited<ReturnType<typeof requireAvailableOpenRouterModel>>
  const catalogStartedAt = beginGenerationStage(options.control, 'catalogue', settingsRow.aiModel)
  try {
    catalogModel = await requireAvailableOpenRouterModel(settingsRow.aiModel)
    finishGenerationStage(options.control, 'catalogue', 'succeeded', catalogStartedAt, {
      model: settingsRow.aiModel,
    })
  } catch (error) {
    const failure = providerFailure(error)
    finishGenerationStage(options.control, 'catalogue', 'failed', catalogStartedAt, {
      model: settingsRow.aiModel,
      errorCode: failure.code,
    })
    throw failure
  }
  const selectedOutput = partial ? PARTIAL_SESSION_OUTPUT : SESSION_OUTPUT
  let response: StructuredGenerationResponse
  const providerStartedAt = beginGenerationStage(options.control, 'generation', settingsRow.aiModel)
  try {
    response = await generateStructuredOutput({
      model: settingsRow.aiModel,
      maxOutputTokens: partial ? 9_000 : 12_000,
      systemPrompt: SYSTEM_PROMPT,
      userPrompt,
      outputSchema: selectedOutput,
      pricing: catalogModel.pricing,
      timeoutMs: 120_000,
      maxRetries: 0,
      signal: options.control?.signal,
    })
    finishGenerationStage(options.control, 'generation', 'succeeded', providerStartedAt, {
      model: response.model,
    })
  } catch (error) {
    const classified = classifyOpenRouterError(error)
    finishGenerationStage(options.control, 'generation', 'failed', providerStartedAt, {
      model: settingsRow.aiModel,
      errorCode: classified.code,
    })
    throw providerFailure(classified)
  }
  addResponseUsage(
    metrics,
    response,
    adjustment ? 'ajustement' : 'seance',
    date,
    Date.now() - providerStartedAt,
  )

  const initialCandidate = partial
    ? preparePartialCandidate(response.output, reusableBlocks, missingBlockTypes)
    : response.output
  let resolvedModel = response.model

  let session: WorkoutSession
  let validationStartedAt = beginGenerationStage(options.control, 'validation', resolvedModel)
  try {
    session = await resolveGeneratedSession(initialCandidate, {
      policy: {
        targetDurationMin: context.dureeCibleMin,
        requestedCategory: context.prescription.category,
        requestedFocus: context.prescription.focus,
        hasCustomFocus: false,
        exercisePreferences: context.prescription.exercisePreferences,
        availableEquipment: context.prescription.personalization.equipment,
        prescribedBlockBudgets: context.prescription.blockBudgets,
      },
      onInvalid: (attempt, violations) => {
        logGenerationViolations(date, attempt, violations)
        finishGenerationStage(options.control, 'validation', 'failed', validationStartedAt, {
          model: resolvedModel,
          errorCode: 'MODEL_OUTPUT_INVALID',
        })
      },
      correct: async (candidate, violations) => {
        metrics.policyCorrectionCount += 1
        const correctionPrompt = [
          `La séance candidate ci-dessous échoue à des règles métier obligatoires.`,
          `Effectue UNE correction ciblée : conserve le contenu valide et modifie uniquement ce qui est nécessaire pour supprimer toutes les violations.`,
          `La durée calculée doit être comprise entre 90 % et 100 % de ${context.dureeCibleMin} minutes.`,
          demande?.categorie
            ? `La catégorie imposée reste exactement « ${demande.categorie} ».`
            : `La catégorie peut rester celle de la candidate si elle respecte son profil minimal.`,
          demande?.focusLibre
            ? `Le thème libre reste « ${demande.focusLibre} » : renvoie le focus d'énumération le plus proche de ce thème.`
            : demande?.focus
              ? `Le focus imposé reste exactement « ${demande.focus} ».`
              : `Le focus peut rester celui de la candidate.`,
          `Violations structurées :`,
          '```json',
          JSON.stringify(violations, null, 2),
          '```',
          `Exclusions strictes d'exercice à respecter :`,
          '```json',
          JSON.stringify(context.prescription.exercisePreferences.strictExclusions, null, 2),
          '```',
          `Matériel autorisé : ${equipmentPromptList(context.prescription.personalization.equipment)}.`,
          `Séance candidate :`,
          '```json',
          JSON.stringify(candidate, null, 2),
          '```',
          `Renvoie la séance corrigée complète comme objet JSON strict.`,
        ].join('\n')

        let correctionResponse: StructuredGenerationResponse
        const correctionStartedAt = beginGenerationStage(
          options.control,
          'correction',
          settingsRow.aiModel,
        )
        try {
          correctionResponse = await generateStructuredOutput({
            model: settingsRow.aiModel,
            maxOutputTokens: 12_000,
            systemPrompt: SYSTEM_PROMPT,
            userPrompt: correctionPrompt,
            outputSchema: SESSION_OUTPUT,
            pricing: catalogModel.pricing,
            timeoutMs: 120_000,
            maxRetries: 0,
            signal: options.control?.signal,
          })
          finishGenerationStage(options.control, 'correction', 'succeeded', correctionStartedAt, {
            model: correctionResponse.model,
          })
        } catch (error) {
          const classified = classifyOpenRouterError(error)
          finishGenerationStage(options.control, 'correction', 'failed', correctionStartedAt, {
            model: settingsRow.aiModel,
            errorCode: classified.code,
          })
          throw providerFailure(classified)
        }
        addResponseUsage(
          metrics,
          correctionResponse,
          adjustment ? 'ajustement' : 'seance',
          date,
          Date.now() - correctionStartedAt,
        )
        resolvedModel = correctionResponse.model
        validationStartedAt = beginGenerationStage(options.control, 'validation', resolvedModel)
        return correctionResponse.output
      },
    })
    finishGenerationStage(options.control, 'validation', 'succeeded', validationStartedAt, {
      model: resolvedModel,
    })
  } catch (error) {
    if (error instanceof GeneratedSessionValidationError) {
      throw new GenerationExecutionError(
        'temporary',
        'MODEL_OUTPUT_INVALID',
        'La séance reste invalide après une correction ciblée.',
        'Une nouvelle tentative sera lancée automatiquement.',
        { cause: error },
      )
    }
    throw error
  }

  metrics.policyCompliant = true

  return {
    session: persistWithExecutionFence(
      options.control,
      () =>
        persistResolvedSession(date, session, context, settingsRow, {
          source: options.source === 'prefetch' ? 'prefetch' : 'model',
          contextHash: options.contextHash,
          aiModel: resolvedModel,
        }),
      resolvedModel,
    ),
    metrics,
  }
}

export async function generateSessionForDate(
  date: string,
  options: GenerateSessionOptions = {},
): Promise<Session> {
  return (await generateSessionForDateDetailed(date, options)).session
}

/** Fallback sans réseau, appelé une seule fois lorsque la politique de retry est épuisée. */
export function generateDeterministicFallbackForDate(
  date: string,
  options: Pick<GenerateSessionOptions, 'contextHash' | 'control'> = {},
): GeneratedSessionResult {
  const fallbackStartedAt = beginGenerationStage(options.control, 'fallback')
  if (findSessionByDate(date)) {
    finishGenerationStage(options.control, 'fallback', 'failed', fallbackStartedAt, {
      errorCode: 'FALLBACK_WOULD_OVERWRITE_SESSION',
    })
    throw new GenerationExecutionError(
      'permanent',
      'FALLBACK_WOULD_OVERWRITE_SESSION',
      'Une séance existe déjà pour cette date.',
      'Conserve la séance existante ou relance explicitement sa régénération.',
    )
  }
  const { settingsRow, context } = buildGenerationContext(date)
  const reusableBlocks = findReusableBlocks(date, context)
  let built: ReturnType<typeof buildDeterministicFallbackSession>
  try {
    built = buildDeterministicFallbackSession(context, reusableBlocks)
  } catch (error) {
    finishGenerationStage(options.control, 'fallback', 'failed', fallbackStartedAt, {
      errorCode: 'FALLBACK_POLICY_REJECTED',
    })
    throw new GenerationExecutionError(
      'permanent',
      'FALLBACK_POLICY_REJECTED',
      'La séance locale ne peut pas respecter toutes les contraintes actives.',
      'Modifie les exclusions incompatibles ou relance après rétablissement du fournisseur.',
      { cause: error },
    )
  }
  const metrics = emptyGenerationRunMetrics()
  metrics.fallbackUsed = true
  metrics.policyCompliant = true
  metrics.reusedBlockCount = built.reusedBlockCount
  metrics.reuseKind = built.reusedBlockCount ? 'blocks' : 'none'
  finishGenerationStage(options.control, 'fallback', 'succeeded', fallbackStartedAt)
  return {
    session: persistWithExecutionFence(
      options.control,
      () =>
        persistResolvedSession(date, built.session, context, settingsRow, {
          source: 'fallback',
          contextHash: options.contextHash,
          fallbackUsed: true,
          aiModel: 'deterministic-local/v1',
        }),
      'deterministic-local/v1',
    ),
    metrics,
  }
}

/** Génère un exercice de remplacement cohérent avec la séance et le bloc concernés. */
export async function generateReplacementExercise(
  structure: WorkoutSession,
  blockIndex: number,
  exerciseIndex: number,
  reasonCode: PreferenceReasonCode | null | undefined,
  preferences: ExercisePreferenceConstraints,
  personalization: Pick<GenerationContext['prescription']['personalization'], 'goal' | 'equipment'>,
  model: string,
): Promise<Exercise> {
  const block = structure.blocks[blockIndex]!
  const current = block.exercises[exerciseIndex]!

  const userPrompt = [
    `Voici ma séance de boxe du jour (JSON) :`,
    '```json',
    JSON.stringify(structure, null, 2),
    '```',
    ``,
    `Propose UN exercice de remplacement pour « ${current.name} » (bloc « ${block.title} », catégorie ${current.category}).`,
    reasonCode && reasonCode !== 'no_reason'
      ? `Motif structuré du remplacement : ${preferenceReasonLabel(reasonCode)}.`
      : `Je souhaite simplement une alternative.`,
    `Préférences d'exercice actives (JSON borné, sans commentaire libre) :`,
    '```json',
    JSON.stringify(preferences, null, 2),
    '```',
    `Objectif du profil : ${personalization.goal} (${goalLabel(personalization.goal)}). Matériel autorisé : ${equipmentPromptList(personalization.equipment)}.`,
    `Contraintes : reste cohérent avec le bloc et le même type d'effort, garde une durée d'intervalles similaire, n'utilise aucun matériel absent de cet inventaire et respecte le niveau débutant. Renseigne "equipment" avec les identifiants exacts requis. Respecte toutes les exclusions strictes. Les préférences pondérées viennent après la sécurité, les prérequis, la progression et la variété. Évite un exercice déjà présent dans la séance. Renseigne ses skillIds stables ; conserve la cible pédagogique de l'exercice remplacé sauf si le motif demande de la changer.`,
    `Renvoie exclusivement l'exercice comme objet JSON strict.`,
  ].join('\n')

  let response: StructuredGenerationResponse
  try {
    const catalogModel = await requireAvailableOpenRouterModel(model)
    response = await generateStructuredOutput({
      model,
      maxOutputTokens: 2_000,
      systemPrompt: SYSTEM_PROMPT,
      userPrompt,
      outputSchema: EXERCISE_OUTPUT,
      pricing: catalogModel.pricing,
      timeoutMs: 60_000,
      maxRetries: 1,
    })
  } catch (error) {
    const classified = classifyOpenRouterError(error)
    console.error("[generation] Remplacement d'exercice échoué :", classified.code)
    throw createError({
      statusCode: classified.kind === 'permanent' ? 400 : 502,
      statusMessage: classified.actionableMessage,
    })
  }
  recordUsage(response, 'exercice', null)

  const parsed = exerciseSchema.safeParse(response.output)
  if (!parsed.success) {
    console.error(
      '[generation] ' +
        JSON.stringify({
          event: 'replacement_validation_failed',
          issues: parsed.error.issues.map(({ code, path }) => ({ code, path })),
        }),
    )
    throw createError({
      statusCode: 502,
      statusMessage: "L'exercice proposé est invalide. Réessaie.",
    })
  }
  const replacement = tagExerciseWithSkills(parsed.data)
  if (!assessExerciseEquipment(replacement, block.type, personalization.equipment).compatible) {
    throw createError({
      statusCode: 502,
      statusMessage: "L'alternative proposée ne respecte pas le matériel disponible. Réessaie.",
    })
  }
  if (matchingStrictExclusion(replacement, block.type, preferences)) {
    throw createError({
      statusCode: 502,
      statusMessage: "L'alternative proposée ne respecte pas une exclusion stricte. Réessaie.",
    })
  }
  return replacement
}
