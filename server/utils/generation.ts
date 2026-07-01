import type AnthropicSDK from '@anthropic-ai/sdk'
import { desc, eq, gte, inArray } from 'drizzle-orm'
import { z } from 'zod'
import {
  estimateSessionSeconds,
  exerciseSchema,
  workoutSessionSchema,
  type Exercise,
  type WorkoutSession,
} from '../../shared/session-schema'
import type { NewSession, Session } from '../database/schema'

/** Outil de sortie structurée imposé au modèle. */
const SESSION_TOOL = {
  name: 'proposer_seance',
  description:
    "Renvoie la séance de boxe du jour, entièrement structurée (blocs, exercices, intervalles) et prête à être exécutée.",
  input_schema: z.toJSONSchema(workoutSessionSchema, {
    target: 'draft-2020-12',
  }) as AnthropicSDK.Tool.InputSchema,
}

export const SYSTEM_PROMPT = `Tu es un coach de boxe anglaise expert, spécialisé dans l'entraînement au sac de frappe à domicile pour la remise en forme et la perte de gras. Tu conçois des séances matinales sûres, progressives et motivantes. Tu tutoies l'utilisateur et écris exclusivement en français.

PUBLIC & MATÉRIEL
- L'utilisateur s'entraîne seul, à la maison, le matin, avant sa journée.
- Matériel disponible : un sac de frappe, des gants, des bandes. RIEN d'autre (pas de corde à sauter, pas de poids, pas d'élastiques, pas de banc). N'utilise QUE le sac de frappe et le poids du corps.
- Niveau DÉBUTANT en boxe anglaise : poings uniquement (jab, cross, crochets, uppercuts). JAMAIS de coups de pied, genoux ou coudes.
- Objectif principal : cardio et perte de gras, tout en construisant des bases techniques propres et une bonne garde.

STRUCTURE OBLIGATOIRE DE CHAQUE SÉANCE (dans cet ordre)
1. echauffement : mobilité articulaire + montée cardiaque progressive + shadow léger. Sans matériel, sans impact violent.
2. technique : apprentissage / répétition de combos numérotés au sac, à intensité contrôlée, en soignant l'exécution.
3. cardio : gros bloc type HIIT au sac + poids du corps, pour la dépense énergétique (c'est le cœur de l'objectif).
4. retour_au_calme : étirements, respiration, récupération.

NOTATION DES COMBOS (boxe anglaise)
1 = jab (bras avant) · 2 = cross / direct arrière · 3 = crochet avant · 4 = crochet arrière · 5 = uppercut avant · 6 = uppercut arrière.
Pour chaque exercice TECHNIQUE au sac, fournis le combo en notation chiffrée (champ "combo", ex : "1-2", "1-1-2", "1-2-3-2") ET son décodage en clair (champ "comboExplanation"). Pour les exercices sans combo (échauffement, gainage, étirements), mets "combo" et "comboExplanation" à null.

RÈGLES DE CONCEPTION
- Respecte STRICTEMENT la durée cible fournie. La somme, sur tous les exercices, de rounds × (work + rest) + restAfterSec doit approcher la durée cible en secondes, sans la dépasser.
- Intervalles réalistes pour un débutant : privilégie des rounds courts (ex : 20-40 s d'effort) avec repos suffisant. Le format peut s'inspirer du Tabata ou de mini-rounds. Adapte selon le bloc (technique = plus de repos, cardio = plus dense).
- Progression : ajuste le volume, l'intensité et la complexité des combos selon l'historique et les derniers ressentis. Si les dernières séances ont été jugées trop dures (difficulté élevée, énergie basse, courbatures marquées), allège. Si trop faciles, intensifie et enrichis les combos.
- Reprise en douceur après des séances ratées ou une coupure : ne saute pas d'étapes, réduis un peu l'intensité.
- Sécurité : pour un débutant, insiste sur la posture, la garde, la respiration. Rien de dangereux. Tiens compte des contraintes/blessures indiquées (adapte ou évite les zones concernées).
- Pédagogie : explications détaillées, claires, étape par étape. Pour chaque exercice, remplis "tips" (2 à 4 conseils concrets) et "commonMistakes" (1 à 3 erreurs fréquentes à éviter).
- Variété : évite la monotonie d'une séance à l'autre tout en gardant une cohérence de progression.
- "coachNote" : explique en 2-3 phrases motivantes POURQUOI cette séance aujourd'hui, en t'appuyant explicitement sur l'historique et les feedbacks (progression, récupération, points à travailler).

Réponds EXCLUSIVEMENT en appelant l'outil "proposer_seance".`

interface HistoryEntry {
  date: string
  jour: string
  titre: string
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

export interface GenerationContext {
  date: string
  jour: string
  dureeCibleMin: number
  profil: Record<string, unknown>
  reglages: Record<string, unknown>
  tendance: Record<string, unknown>
  poids: Record<string, unknown> | null
  historique: HistoryEntry[]
}

/** Rassemble tout le contexte nécessaire à la génération d'une séance pour `date`. */
export function buildGenerationContext(date: string): {
  settingsRow: typeof settings.$inferSelect
  profileRow: typeof profile.$inferSelect
  context: GenerationContext
} {
  const db = useDatabase()
  ensureSingletons(db)

  const settingsRow = db.select().from(settings).where(eq(settings.id, 1)).get()!
  const profileRow = db.select().from(profile).where(eq(profile.id, 1)).get()!

  // 8 dernières séances (hors la date visée, utile en cas de régénération).
  const recent = db
    .select()
    .from(sessions)
    .where(eq(sessions.status, 'completed'))
    .orderBy(desc(sessions.date))
    .limit(8)
    .all()
    .filter((s) => s.date !== date)

  const ids = recent.map((s) => s.id)
  const sFeedback = ids.length
    ? db.select().from(sessionFeedback).where(inArray(sessionFeedback.sessionId, ids)).all()
    : []
  const eFeedback = ids.length
    ? db.select().from(exerciseFeedback).where(inArray(exerciseFeedback.sessionId, ids)).all()
    : []

  const historique: HistoryEntry[] = recent.map((s) => {
    const sf = sFeedback.find((f) => f.sessionId === s.id)
    const exs = eFeedback
      .filter((f) => f.sessionId === s.id)
      .map((f) => ({ nom: f.exerciseName, difficulte: f.difficulty, commentaire: f.comment }))
    return {
      date: s.date,
      jour: weekdayLabel(s.date),
      titre: s.title,
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

  // Tendance : nombre de séances complétées sur 7 / 30 jours + jours depuis la dernière.
  const cutoff7 = addDays(date, -7)
  const cutoff30 = addDays(date, -30)
  const completed30 = db
    .select({ date: sessions.date })
    .from(sessions)
    .where(gte(sessions.date, cutoff30))
    .all()
    .filter((s) => s.date < date)
  const seances7j = completed30.filter((s) => s.date >= cutoff7).length
  const derniere = historique[0]?.date ?? null

  // Poids (si activé et disponible).
  let poids: Record<string, unknown> | null = null
  if (settingsRow.weightTrackingEnabled) {
    const all = db.select().from(weights).orderBy(desc(weights.date)).limit(30).all()
    if (all.length) {
      const actuel = all[0]!
      const ancien = all.find((w) => w.date <= cutoff30) ?? all[all.length - 1]!
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
    dureeCibleMin: settingsRow.targetDurationMin,
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
      dureeCibleMin: settingsRow.targetDurationMin,
    },
    tendance: {
      seances7j,
      seances30j: completed30.length,
      derniereSeance: derniere,
      joursDepuisDerniereSeance: derniere ? daysBetween(derniere, date) : null,
    },
    poids,
    historique,
  }

  return { settingsRow, profileRow, context }
}

/**
 * Génère (ou régénère) la séance du jour pour `date` via Anthropic et la persiste.
 * Idempotent hors régénération : si la séance existe déjà, elle est renvoyée telle quelle.
 */
export async function generateSessionForDate(
  date: string,
  options: { regenerate?: boolean } = {},
): Promise<Session> {
  const db = useDatabase()
  const existing = db.select().from(sessions).where(eq(sessions.date, date)).get()
  if (existing && !options.regenerate) return existing

  const { settingsRow, context } = buildGenerationContext(date)

  const userPrompt = [
    `Nous sommes le ${formatDateFr(date)}. Prépare ma séance de boxe du jour.`,
    ``,
    `Durée cible : ${context.dureeCibleMin} minutes (à ne pas dépasser).`,
    ``,
    `Voici mon profil, mes réglages et mon historique récent (au format JSON) :`,
    '```json',
    JSON.stringify(context, null, 2),
    '```',
    ``,
    `Conçois la séance en respectant la structure et les règles, et appelle l'outil "proposer_seance".`,
  ].join('\n')

  const client = useAnthropic()

  let response
  try {
    response = await client.messages.create({
      model: settingsRow.aiModel,
      max_tokens: 12_000,
      system: SYSTEM_PROMPT,
      tools: [SESSION_TOOL],
      tool_choice: { type: 'tool', name: SESSION_TOOL.name },
      messages: [{ role: 'user', content: userPrompt }],
    }, { timeout: 120_000, maxRetries: 1 })
  } catch (error) {
    console.error('[generation] Appel Anthropic échoué :', error)
    throw createError({
      statusCode: 502,
      statusMessage: "La génération de la séance a échoué (erreur du modèle). Réessaie.",
    })
  }

  const toolUse = response.content.find(
    (block): block is AnthropicSDK.ToolUseBlock => block.type === 'tool_use',
  )
  if (!toolUse) {
    throw createError({
      statusCode: 502,
      statusMessage: "Le modèle n'a pas renvoyé de séance exploitable.",
    })
  }

  const parsed = workoutSessionSchema.safeParse(toolUse.input)
  if (!parsed.success) {
    console.error('[generation] Séance invalide :', parsed.error.issues)
    throw createError({
      statusCode: 502,
      statusMessage: 'La séance générée est invalide. Réessaie.',
    })
  }

  const session = parsed.data
  const now = new Date()
  const values: NewSession = {
    date,
    status: 'generated',
    title: session.title,
    focus: session.focus,
    summary: session.summary,
    coachNote: session.coachNote,
    targetDurationMin: settingsRow.targetDurationMin,
    estimatedDurationMin: session.estimatedDurationMin,
    structure: session,
    aiModel: settingsRow.aiModel,
    generationContext: context,
    generatedAt: now,
  }

  db.insert(sessions)
    .values(values)
    .onConflictDoUpdate({
      target: sessions.date,
      set: {
        ...values,
        updatedAt: now,
        startedAt: null,
        completedAt: null,
        actualDurationSec: null,
      },
    })
    .run()

  return db.select().from(sessions).where(eq(sessions.date, date)).get()!
}

/**
 * Garantit la séance du jour : si aujourd'hui est un jour d'entraînement et qu'aucune
 * séance n'existe encore, la génère (nécessite la clé API). Sinon renvoie l'existante ou null.
 * Utilisé par le cron, le rattrapage au démarrage et l'ouverture de l'appli.
 */
export function ensureTodaySession(): Session | null {
  const db = useDatabase()
  ensureSingletons(db)
  const settingsRow = db.select().from(settings).where(eq(settings.id, 1)).get()!
  const today = todayIso(settingsRow.timezone)

  if (!settingsRow.trainingDays.includes(isoWeekday(today))) return null

  const existing = db.select().from(sessions).where(eq(sessions.date, today)).get()
  if (existing) return existing

  const { anthropicApiKey } = useRuntimeConfig()
  if (!anthropicApiKey) {
    console.warn("[generation] Jour d'entraînement mais clé API absente : séance non générée.")
    return null
  }
  // Génération lancée en arrière-plan (ne bloque ni le cron ni la requête HTTP).
  triggerGeneration(today)
  return null
}

/**
 * Génération en arrière-plan (fire-and-forget), dédupliquée par date : plusieurs
 * requêtes simultanées ne lancent qu'une seule génération.
 */
const inFlightGenerations = new Set<string>()

export function isGenerating(date: string): boolean {
  return inFlightGenerations.has(date)
}

export function triggerGeneration(date: string, options: { regenerate?: boolean } = {}): void {
  if (inFlightGenerations.has(date)) return
  inFlightGenerations.add(date)
  generateSessionForDate(date, options)
    .catch((error) => console.error('[generation] Génération en arrière-plan échouée :', error))
    .finally(() => inFlightGenerations.delete(date))
}

/** Outil de sortie structurée pour un exercice unique (remplacement). */
const EXERCISE_TOOL = {
  name: 'proposer_exercice',
  description: "Renvoie un exercice de remplacement, structuré et prêt à être exécuté.",
  input_schema: z.toJSONSchema(exerciseSchema, {
    target: 'draft-2020-12',
  }) as AnthropicSDK.Tool.InputSchema,
}

function loadSessionOrThrow(date: string): Session {
  const db = useDatabase()
  const row = db.select().from(sessions).where(eq(sessions.date, date)).get()
  if (!row) throw createError({ statusCode: 404, statusMessage: 'Séance introuvable.' })
  return row
}

/** Réécrit la structure d'une séance et recalcule sa durée estimée. */
function persistStructure(date: string, structure: WorkoutSession): Session {
  const db = useDatabase()
  const estimatedDurationMin = Math.max(1, Math.round(estimateSessionSeconds(structure) / 60))
  db.update(sessions)
    .set({ structure, estimatedDurationMin, updatedAt: new Date() })
    .where(eq(sessions.date, date))
    .run()
  return db.select().from(sessions).where(eq(sessions.date, date)).get()!
}

/** Retire un exercice (ou son bloc s'il devient vide). */
export function removeExerciseFromSession(
  date: string,
  blockIndex: number,
  exerciseIndex: number,
): Session {
  const row = loadSessionOrThrow(date)
  const structure = structuredClone(row.structure)
  const block = structure.blocks[blockIndex]
  if (!block || !block.exercises[exerciseIndex]) {
    throw createError({ statusCode: 400, statusMessage: 'Exercice introuvable.' })
  }
  if (block.exercises.length > 1) {
    block.exercises.splice(exerciseIndex, 1)
  } else if (structure.blocks.length > 1) {
    structure.blocks.splice(blockIndex, 1)
  } else {
    throw createError({
      statusCode: 400,
      statusMessage: 'Impossible de retirer le dernier exercice de la séance.',
    })
  }
  return persistStructure(date, structure)
}

/** Remplace un exercice par une alternative générée par l'IA. */
export async function replaceExerciseInSession(
  date: string,
  blockIndex: number,
  exerciseIndex: number,
  reason?: string,
): Promise<Session> {
  const row = loadSessionOrThrow(date)
  const structure = structuredClone(row.structure)
  const block = structure.blocks[blockIndex]
  const current = block?.exercises[exerciseIndex]
  if (!block || !current) {
    throw createError({ statusCode: 400, statusMessage: 'Exercice introuvable.' })
  }
  block.exercises[exerciseIndex] = await generateReplacementExercise(
    structure,
    blockIndex,
    exerciseIndex,
    reason,
    row.aiModel,
  )
  return persistStructure(date, structure)
}

async function generateReplacementExercise(
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
    response = await client.messages.create({
      model,
      max_tokens: 2000,
      system: SYSTEM_PROMPT,
      tools: [EXERCISE_TOOL],
      tool_choice: { type: 'tool', name: EXERCISE_TOOL.name },
      messages: [{ role: 'user', content: userPrompt }],
    }, { timeout: 60_000, maxRetries: 1 })
  } catch (error) {
    console.error("[generation] Remplacement d'exercice échoué :", error)
    throw createError({
      statusCode: 502,
      statusMessage: "Le remplacement de l'exercice a échoué. Réessaie.",
    })
  }

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
