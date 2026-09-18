import type AnthropicSDK from '@anthropic-ai/sdk'
import { z } from 'zod'
import { buildSessionPrompt } from '../../shared/generation-prompt'
import {
  GeneratedSessionValidationError,
  resolveGeneratedSession,
  type GeneratedSessionViolation,
  type GenerationValidationAttempt,
} from '../../shared/session-generation-policy'
import {
  estimateSessionSeconds,
  exerciseSchema,
  SESSION_CATEGORY_META,
  sessionCategory,
  workoutFocus,
  workoutSessionSchema,
  type Exercise,
  type WorkoutSession,
} from '../../shared/session-schema'
import type { WorkoutPrescription } from '../../shared/workout-prescription'
import type { NewSession, Session } from '../database/schema'
import { buildWorkoutPrescription } from './workout-prescription.service'

/** Outil de sortie structurée imposé au modèle pour une séance complète. */
const SESSION_TOOL = {
  name: 'proposer_seance',
  description:
    'Renvoie la séance de boxe du jour, entièrement structurée (blocs, exercices, intervalles) et prête à être exécutée.',
  input_schema: z.toJSONSchema(workoutSessionSchema, {
    target: 'draft-2020-12',
  }) as AnthropicSDK.Tool.InputSchema,
}

/** Outil de sortie structurée pour un exercice unique (remplacement). */
const EXERCISE_TOOL = {
  name: 'proposer_exercice',
  description: 'Renvoie un exercice de remplacement, structuré et prêt à être exécuté.',
  input_schema: z.toJSONSchema(exerciseSchema, {
    target: 'draft-2020-12',
  }) as AnthropicSDK.Tool.InputSchema,
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
  '- puissance : frappes engagées au sac, transfert de poids (volume maîtrisé).',
  '- corps : travail au corps (plexus, flancs), changements de niveau.',
  '- cardio : densité et endurance de frappe, peu de nouveauté technique.',
  '- gainage : ceinture abdominale et renforcement au poids du corps au service de la frappe.',
].join('\n')

export const SYSTEM_PROMPT = `Tu es un coach de boxe anglaise expert, spécialisé dans l'entraînement au sac de frappe à domicile pour la remise en forme et la perte de gras. Tu conçois des séances matinales sûres, progressives et motivantes. Tu tutoies l'utilisateur et écris exclusivement en français.

PUBLIC & MATÉRIEL
- L'utilisateur s'entraîne seul, à la maison, le matin, avant sa journée.
- Matériel disponible : un sac de frappe, des gants, des bandes. RIEN d'autre (pas de corde à sauter, pas de poids, pas d'élastiques, pas de banc). N'utilise QUE le sac de frappe et le poids du corps.
- Niveau DÉBUTANT en boxe anglaise : poings uniquement (jab, cross, crochets, uppercuts). JAMAIS de coups de pied, genoux ou coudes.
- Objectif principal : cardio et perte de gras, tout en construisant des bases techniques propres et une bonne garde.

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
- Renvoie TOUJOURS "category" ET "focus".

MÉMOIRE & PROGRESSION
Le contexte fournit "memoire" : par focus et par catégorie déjà pratiqués, la dernière date, le nombre de jours écoulés et le nombre de fois travaillés ; plus "combosRecents", les combos vus dans les séances récentes.
- Construis une VRAIE progression : reprends et complexifie ce qui est déjà acquis plutôt que de repartir de zéro.
- Évite de resservir tels quels les combos de "combosRecents" : varie les enchaînements.
- Utilise la mémoire pour choisir le contenu et faire progresser les exercices à l'intérieur de la prescription.
- Le contexte peut contenir "seancesSautees" (séances récemment non faites, avec la raison éventuelle) : tiens-en compte — reprise en douceur après une coupure, et allègement si la raison évoque une fatigue ou une blessure.

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
- "coachNote" : explique en 2-3 phrases motivantes POURQUOI cette séance aujourd'hui, en t'appuyant explicitement sur la catégorie, le focus, l'historique et les feedbacks (progression, récupération, points à travailler).

Réponds EXCLUSIVEMENT en appelant l'outil demandé : "proposer_seance" pour une séance complète, "proposer_exercice" pour un exercice de remplacement.`

/**
 * Prompt système en bloc unique marqué pour le cache : ce préfixe (outils + système) est
 * strictement statique, donc réutilisable d'un appel à l'autre. Le cache Anthropic n'a d'effet
 * qu'entre appels rapprochés (TTL 5 min) : régénération, ajustement, remplacement d'exercice —
 * pas d'une génération quotidienne à l'autre. Il ne se déclenche qu'au-delà d'un préfixe minimal
 * (4096 tokens pour Opus 4.8) ; en deçà, aucun effet (mais aucun surcoût non plus).
 */
const SYSTEM_BLOCKS: AnthropicSDK.TextBlockParam[] = [
  { type: 'text', text: SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } },
]

/** Enregistre la consommation de tokens d'un appel (best-effort : n'interrompt jamais la génération). */
function recordUsage(
  response: AnthropicSDK.Message,
  kind: 'seance' | 'exercice' | 'ajustement',
  date: string | null,
): void {
  try {
    const u = response.usage
    recordAiUsage({
      sessionDate: date,
      kind,
      model: response.model,
      inputTokens: u.input_tokens ?? 0,
      outputTokens: u.output_tokens ?? 0,
      cacheCreationTokens: u.cache_creation_input_tokens ?? 0,
      cacheReadTokens: u.cache_read_input_tokens ?? 0,
    })
  } catch (error) {
    console.error('[generation] Enregistrement de la conso échoué :', error)
  }
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
}

/** Intention planifiée par l'utilisateur pour cette date. */
interface GenerationRequest {
  /** Null = catégorie laissée au choix de l'IA. */
  categorie: string | null
  focus: string | null
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
  date: string
  jour: string
  dureeCibleMin: number
  profil: Record<string, unknown>
  reglages: Record<string, unknown>
  tendance: Record<string, unknown>
  poids: Record<string, unknown> | null
  /** Décisions déterministes que la génération et la future politique de validation partagent. */
  prescription: WorkoutPrescription
  /** Présent uniquement si la date a été planifiée : le modèle doit la respecter. */
  demande?: GenerationRequest
  memoire: MemorySummary
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
  console.error('[generation-policy]', {
    event: 'session_validation_failed',
    date,
    attempt,
    violations,
  })
}

/**
 * Résume la mémoire d'entraînement : pour chaque focus et chaque catégorie déjà pratiqués,
 * l'ancienneté et le nombre de répétitions, plus les combos récents. Sert la progression
 * (reprendre les acquis) et la variété (ne pas resservir les mêmes enchaînements).
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

  return { parFocus, parCategorie, combosRecents }
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
  const prescription = buildWorkoutPrescription(date)
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

  const context: GenerationContext = {
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
    memoire: buildMemory(date, past),
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
      focusLibre: plan.customFocus,
      note: plan.note,
    }
  }

  return { settingsRow, context }
}

/**
 * Génère (ou régénère) la séance du jour pour `date` via Anthropic et la persiste.
 * Idempotent hors régénération : si la séance existe déjà, elle est renvoyée telle quelle.
 */
export async function generateSessionForDate(
  date: string,
  options: { regenerate?: boolean; adjustment?: string } = {},
): Promise<Session> {
  const existing = findSessionByDate(date)
  const adjustment = options.adjustment?.trim()
  // Un ajustement régénère toujours ; sinon, une séance existante est renvoyée telle quelle.
  if (existing && !options.regenerate && !adjustment) return existing

  const { settingsRow, context } = buildGenerationContext(date)

  // Ajustement d'une séance existante : on verrouille son intention (catégorie + focus) pour que
  // la consigne modifie la séance sans repartir de zéro sur un autre thème.
  if (adjustment && existing?.category) {
    context.demande = {
      categorie: existing.category,
      focus: existing.focus,
      focusLibre: context.demande?.focusLibre ?? null,
      note: context.demande?.note ?? null,
    }
    context.prescription = buildWorkoutPrescription(date, {
      category: existing.category,
      focus: existing.focus,
    })
  }

  const userPrompt = buildSessionPrompt({
    dateLabel: formatDateFr(date),
    context,
    adjustment,
    existingStructure: existing?.structure,
  })

  const client = useAnthropic()
  let response
  try {
    response = await client.messages.create(
      {
        model: settingsRow.aiModel,
        max_tokens: 12_000,
        system: SYSTEM_BLOCKS,
        tools: [SESSION_TOOL],
        tool_choice: { type: 'tool', name: SESSION_TOOL.name },
        messages: [{ role: 'user', content: userPrompt }],
      },
      { timeout: 120_000, maxRetries: 1 },
    )
  } catch (error) {
    console.error('[generation] Appel Anthropic échoué :', error)
    throw createError({
      statusCode: 502,
      statusMessage: 'La génération de la séance a échoué (erreur du modèle). Réessaie.',
    })
  }
  recordUsage(response, adjustment ? 'ajustement' : 'seance', date)

  const toolUse = response.content.find(
    (block): block is AnthropicSDK.ToolUseBlock => block.type === 'tool_use',
  )
  if (!toolUse) {
    throw createError({
      statusCode: 502,
      statusMessage: "Le modèle n'a pas renvoyé de séance exploitable.",
    })
  }

  const requestedCategory = sessionCategory.safeParse(demande?.categorie)
  const requestedFocus = workoutFocus.safeParse(demande?.focus)
  let session: WorkoutSession
  try {
    session = await resolveGeneratedSession(toolUse.input, {
      policy: {
        targetDurationMin: context.dureeCibleMin,
        requestedCategory: requestedCategory.success ? requestedCategory.data : null,
        requestedFocus: requestedFocus.success ? requestedFocus.data : null,
        hasCustomFocus: Boolean(demande?.focusLibre),
      },
      onInvalid: (attempt, violations) => logGenerationViolations(date, attempt, violations),
      correct: async (candidate, violations) => {
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
          `Séance candidate :`,
          '```json',
          JSON.stringify(candidate, null, 2),
          '```',
          `Appelle l'outil "proposer_seance" avec la séance corrigée complète.`,
        ].join('\n')

        let correctionResponse
        try {
          correctionResponse = await client.messages.create(
            {
              model: settingsRow.aiModel,
              max_tokens: 12_000,
              system: SYSTEM_BLOCKS,
              tools: [SESSION_TOOL],
              tool_choice: { type: 'tool', name: SESSION_TOOL.name },
              messages: [{ role: 'user', content: correctionPrompt }],
            },
            { timeout: 120_000, maxRetries: 1 },
          )
        } catch (error) {
          console.error('[generation] Correction Anthropic échouée :', error)
          throw createError({
            statusCode: 502,
            statusMessage:
              'La séance générée était invalide et sa correction a échoué. Aucune séance n’a été enregistrée.',
          })
        }

        recordUsage(correctionResponse, adjustment ? 'ajustement' : 'seance', date)
        return correctionResponse.content.find(
          (block): block is AnthropicSDK.ToolUseBlock => block.type === 'tool_use',
        )?.input
      },
    })
  } catch (error) {
    if (error instanceof GeneratedSessionValidationError) {
      throw createError({
        statusCode: 502,
        statusMessage:
          'La séance reste invalide après une tentative de correction. Aucune séance n’a été enregistrée.',
      })
    }
    throw error
  }

  const values: NewSession = {
    date,
    status: 'generated',
    title: session.title,
    category: session.category,
    focus: session.focus,
    summary: session.summary,
    coachNote: session.coachNote,
    // Durée cible effective : celle du plan sur mesure si présent, sinon celle des réglages.
    targetDurationMin: context.dureeCibleMin,
    // Durée réellement induite par les intervalles : source de vérité (le modèle s'en écarte souvent).
    estimatedDurationMin: Math.max(1, Math.round(estimateSessionSeconds(session) / 60)),
    structure: session,
    aiModel: settingsRow.aiModel,
    generationContext: context,
    generatedAt: new Date(),
  }

  return upsertSessionByDate(values)
}

/** Génère un exercice de remplacement cohérent avec la séance et le bloc concernés. */
export async function generateReplacementExercise(
  structure: WorkoutSession,
  blockIndex: number,
  exerciseIndex: number,
  reason: string | undefined,
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
    reason ? `Raison du remplacement : ${reason}.` : `Je souhaite simplement une alternative.`,
    `Contraintes : reste cohérent avec le bloc et le même type d'effort, garde une durée d'intervalles similaire, respecte le matériel (sac de frappe et poids du corps uniquement) et le niveau débutant. Évite un exercice déjà présent dans la séance.`,
    `Appelle l'outil "proposer_exercice".`,
  ].join('\n')

  const client = useAnthropic()
  let response
  try {
    response = await client.messages.create(
      {
        model,
        max_tokens: 2000,
        system: SYSTEM_BLOCKS,
        tools: [EXERCISE_TOOL],
        tool_choice: { type: 'tool', name: EXERCISE_TOOL.name },
        messages: [{ role: 'user', content: userPrompt }],
      },
      { timeout: 60_000, maxRetries: 1 },
    )
  } catch (error) {
    console.error("[generation] Remplacement d'exercice échoué :", error)
    throw createError({
      statusCode: 502,
      statusMessage: "Le remplacement de l'exercice a échoué. Réessaie.",
    })
  }
  recordUsage(response, 'exercice', null)

  const toolUse = response.content.find(
    (block): block is AnthropicSDK.ToolUseBlock => block.type === 'tool_use',
  )
  if (!toolUse) {
    throw createError({ statusCode: 502, statusMessage: "Le modèle n'a pas proposé d'exercice." })
  }

  const parsed = exerciseSchema.safeParse(toolUse.input)
  if (!parsed.success) {
    console.error('[generation] Exercice de remplacement invalide :', parsed.error.issues)
    throw createError({
      statusCode: 502,
      statusMessage: "L'exercice proposé est invalide. Réessaie.",
    })
  }
  return parsed.data
}

/**
 * Génération en arrière-plan (fire-and-forget), dédupliquée par date : plusieurs
 * requêtes simultanées ne lancent qu'une seule génération.
 */
const inFlightGenerations = new Set<string>()

export function isGenerating(date: string): boolean {
  return inFlightGenerations.has(date)
}

export function triggerGeneration(
  date: string,
  options: { regenerate?: boolean; adjustment?: string } = {},
): void {
  if (inFlightGenerations.has(date)) return
  inFlightGenerations.add(date)
  generateSessionForDate(date, options)
    .catch((error) => console.error('[generation] Génération en arrière-plan échouée :', error))
    .finally(() => inFlightGenerations.delete(date))
}

/**
 * Garantit la séance du jour : si aujourd'hui est un jour d'entraînement et qu'aucune
 * séance n'existe, lance la génération en arrière-plan. Renvoie l'existante ou null.
 */
export function ensureTodaySession(): Session | null {
  const settingsRow = getSettings()
  const today = todayIso(settingsRow.timezone)

  if (!settingsRow.trainingDays.includes(isoWeekday(today))) return null

  const existing = findSessionByDate(today)
  if (existing) return existing

  // Séance supprimée/déplacée volontairement : on ne recrée rien sans demande explicite.
  if (isDateDismissed(today)) return null

  const { anthropicApiKey } = useRuntimeConfig()
  if (!anthropicApiKey) {
    console.warn("[generation] Jour d'entraînement mais clé API absente : séance non générée.")
    return null
  }

  triggerGeneration(today)
  return null
}
