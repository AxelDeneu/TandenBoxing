import type AnthropicSDK from '@anthropic-ai/sdk'
import { z } from 'zod'
import {
  FOCUS_OPTIONS,
  recommendFocuses,
  type FocusRecommendation,
  type RecoHistoryEntry,
} from '../../shared/recommendations'
import { sessionCategory, workoutFocus } from '../../shared/session-schema'
import type { SkillProgressionSnapshot } from '../../shared/skill-mastery'

/**
 * Recommandations « quoi travailler ensuite » : l'IA personnalise les justifications,
 * l'heuristique partagée (`recommendFocuses`) sert de base ET de repli hors-ligne.
 * Ce service n'échoue jamais : au pire il renvoie le repli heuristique.
 */

/** Sortie structurée imposée au modèle. */
const recoSchema = z.object({
  recommandations: z
    .array(
      z.object({
        category: sessionCategory,
        focus: workoutFocus,
        reason: z.string().min(1),
      }),
    )
    .min(1)
    .max(4),
})

const RECO_TOOL = {
  name: 'recommander_focus',
  description:
    'Renvoie 3 à 4 propositions de prochaine séance (catégorie + focus), chacune justifiée en une phrase courte.',
  input_schema: z.toJSONSchema(recoSchema, {
    target: 'draft-2020-12',
  }) as AnthropicSDK.Tool.InputSchema,
}

const RECO_SYSTEM_PROMPT = `Tu es un coach de boxe anglaise qui suit un élève débutant s'entraînant seul, au sac, à la maison. Tu tutoies l'élève et écris exclusivement en français.

À partir de sa mémoire d'entraînement (ce qu'il a fait, quand, et ses ressentis), tu proposes les 3 à 4 prochaines séances les plus pertinentes, sous forme de couples catégorie + focus.

CATÉGORIES (le type de séance, il pilote la structure) :
${CATEGORY_GUIDE}

FOCUS (le thème technique) : fondations, jeu_de_jambes, defense, crochets, uppercuts, combinaisons, puissance, corps, cardio, gainage.

RÈGLES
- Les couples catégorie + focus reçus sont calculés depuis un curriculum et des états de maîtrise. Conserve EXACTEMENT leurs valeurs et leur ordre ; reformule seulement leurs raisons.
- Un nombre de séances ne prouve jamais à lui seul qu'une compétence est acquise.
- "reason" : UNE phrase courte, personnalisée, appuyée sur un état ou un fait concret fourni.
- Ne présente jamais comme acquise une compétence en consolidation ou bloquée par un prérequis.

Réponds EXCLUSIVEMENT en appelant l'outil "recommander_focus".`

/** Cache mémoire best-effort, par date (les recos ne bougent pas tant que l'historique ne bouge pas). */
const recoCache = new Map<string, FocusRecommendation[]>()

/**
 * Vide le cache : à appeler dès que l'historique change (séance complétée), sinon les
 * recommandations resteraient calculées sur une mémoire périmée — or elles doivent
 * justement refléter les séances déjà faites.
 */
export function clearRecommendationCache(): void {
  recoCache.clear()
}

/** Historique des séances complétées enrichi des ressentis. */
function buildRecoHistory(): RecoHistoryEntry[] {
  const completed = listCompletedSessions()
  const fbById = new Map(
    listSessionFeedbackByIds(completed.map((s) => s.id)).map((f) => [f.sessionId, f]),
  )
  return completed.map((s) => ({
    date: s.date,
    category: s.category,
    focus: s.focus,
    completed: true,
    difficulty: fbById.get(s.id)?.overallDifficulty ?? null,
    energy: fbById.get(s.id)?.energyLevel ?? null,
  }))
}

/** Résumé lisible de la mémoire : le modèle raisonne mieux là-dessus que sur du JSON brut. */
function formatMemory(date: string, history: RecoHistoryEntry[]): string {
  if (!history.length) {
    return "Aucune séance complétée pour l'instant : l'élève démarre de zéro."
  }

  const stats = new Map<string, { count: number; last: string }>()
  for (const e of history) {
    const stat = stats.get(e.focus)
    if (!stat) stats.set(e.focus, { count: 1, last: e.date })
    else {
      stat.count += 1
      if (e.date > stat.last) stat.last = e.date
    }
  }

  const parFocus = [...stats.entries()]
    .map(([focus, s]) => ({ focus, count: s.count, daysSince: daysBetween(s.last, date) }))
    .sort((a, b) => b.daysSince - a.daysSince)
    .map((s) => `- ${s.focus} : ${s.count}×, dernière il y a ${s.daysSince} j.`)

  const jamais = FOCUS_OPTIONS.filter((f) => !stats.has(f))

  // `history` est trié du plus récent au plus ancien.
  const recentes = history.slice(0, 6).map((e) => {
    const ressenti = [
      e.difficulty ? `difficulté ${e.difficulty}/5` : null,
      e.energy ? `énergie ${e.energy}/5` : null,
    ]
      .filter(Boolean)
      .join(', ')
    return `- ${e.date} : ${e.category ?? 'catégorie inconnue'} / ${e.focus}${ressenti ? ` (${ressenti})` : ''}.`
  })

  return [
    `Séances complétées au total : ${history.length}.`,
    ``,
    `Focus déjà travaillés (du plus négligé au plus récent) :`,
    ...parFocus,
    ...(jamais.length ? [``, `Focus JAMAIS travaillés : ${jamais.join(', ')}.`] : []),
    ``,
    `Séances récentes :`,
    ...recentes,
  ].join('\n')
}

/** Demande au modèle des recommandations personnalisées (lève en cas d'échec/sortie invalide). */
async function askModel(
  date: string,
  history: RecoHistoryEntry[],
  baseline: FocusRecommendation[],
  progression: SkillProgressionSnapshot,
): Promise<FocusRecommendation[]> {
  const settingsRow = getSettings()

  const userPrompt = [
    `Nous sommes le ${formatDateFr(date)}. Que devrais-je travailler lors de mes prochaines séances ?`,
    ``,
    `Ma mémoire d'entraînement :`,
    formatMemory(date, history),
    ``,
    `État calculé des compétences (source de vérité) :`,
    '```json',
    JSON.stringify(progression, null, 2),
    '```',
    ``,
    `Pistes calculées automatiquement (conserve exactement les couples et l'ordre) :`,
    ...baseline.map((r) => `- ${r.category} / ${r.focus} : ${r.reason}`),
    ``,
    `Reformule seulement leurs raisons et appelle l'outil "recommander_focus".`,
  ].join('\n')

  const client = useAnthropic()
  const response = await client.messages.create(
    {
      model: settingsRow.aiModel,
      max_tokens: 1500,
      system: RECO_SYSTEM_PROMPT,
      tools: [RECO_TOOL],
      tool_choice: { type: 'tool', name: RECO_TOOL.name },
      messages: [{ role: 'user', content: userPrompt }],
    },
    { timeout: 30_000, maxRetries: 1 },
  )

  const toolUse = response.content.find(
    (block): block is AnthropicSDK.ToolUseBlock => block.type === 'tool_use',
  )
  if (!toolUse) throw new Error("Le modèle n'a pas renvoyé de recommandations.")

  const parsed = recoSchema.parse(toolUse.input)
  // La personnalisation ne peut ni contourner un prérequis, ni remplacer le planner.
  const modelReasons = new Map(
    parsed.recommandations.map((recommendation) => [
      `${recommendation.category}:${recommendation.focus}`,
      recommendation.reason,
    ]),
  )
  return baseline.map((recommendation) => ({
    ...recommendation,
    reason:
      modelReasons.get(`${recommendation.category}:${recommendation.focus}`) ??
      recommendation.reason,
  }))
}

/**
 * 3 à 4 prochaines séances conseillées pour `date`. Repli systématique sur l'heuristique
 * partagée si la clé API manque ou si le modèle échoue/renvoie une sortie invalide.
 */
export async function getRecommendations(date: string): Promise<FocusRecommendation[]> {
  const cached = recoCache.get(date)
  if (cached) return cached

  const history = buildRecoHistory()
  const progression = getSkillProgression(date)
  const baseline = recommendFocuses({ today: date, history, skillProgression: progression })

  const { anthropicApiKey } = useRuntimeConfig()
  if (!anthropicApiKey) return baseline

  try {
    const recos = await askModel(date, history, baseline, progression)
    recoCache.set(date, recos)
    return recos
  } catch (error) {
    console.error('[reco] Recommandation IA échouée, repli heuristique :', error)
    return baseline
  }
}
