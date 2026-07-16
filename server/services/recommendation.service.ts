import type AnthropicSDK from '@anthropic-ai/sdk'
import { z } from 'zod'
import {
  FOCUS_OPTIONS,
  recommendFocuses,
  type FocusRecommendation,
  type RecoHistoryEntry,
} from '../../shared/recommendations'
import { sessionCategory, workoutFocus } from '../../shared/session-schema'

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
- Varie : ne propose jamais deux fois le même focus.
- Privilégie les focus jamais travaillés, puis les plus négligés.
- Fais progresser : focus jamais vu → "apprentissage" ; vu 1 ou 2 fois → "renforcement" ; bien acquis → "enchainement".
- Si les séances récentes ont été éprouvantes (difficulté haute, énergie basse) ou très rapprochées, place une "recuperation" en premier.
- "reason" : UNE phrase courte (15 mots max), personnalisée, appuyée sur un fait concret de la mémoire (ancienneté, nombre de fois, ressenti).
- Classe les propositions de la plus pertinente à la moins pertinente.

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
): Promise<FocusRecommendation[]> {
  const settingsRow = getSettings()

  const userPrompt = [
    `Nous sommes le ${formatDateFr(date)}. Que devrais-je travailler lors de mes prochaines séances ?`,
    ``,
    `Ma mémoire d'entraînement :`,
    formatMemory(date, history),
    ``,
    `Pistes calculées automatiquement (à valider, affiner ou remplacer selon ton analyse) :`,
    ...baseline.map((r) => `- ${r.category} / ${r.focus} : ${r.reason}`),
    ``,
    `Propose 3 à 4 prochaines séances et appelle l'outil "recommander_focus".`,
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
  // Le score n'est qu'un rang : le modèle a déjà classé ses propositions.
  return parsed.recommandations.map((r, i) => ({ ...r, score: 100 - i }))
}

/**
 * 3 à 4 prochaines séances conseillées pour `date`. Repli systématique sur l'heuristique
 * partagée si la clé API manque ou si le modèle échoue/renvoie une sortie invalide.
 */
export async function getRecommendations(date: string): Promise<FocusRecommendation[]> {
  const cached = recoCache.get(date)
  if (cached) return cached

  const history = buildRecoHistory()
  const baseline = recommendFocuses({ today: date, history })

  const { anthropicApiKey } = useRuntimeConfig()
  if (!anthropicApiKey) return baseline

  try {
    const recos = await askModel(date, history, baseline)
    recoCache.set(date, recos)
    return recos
  } catch (error) {
    console.error('[reco] Recommandation IA échouée, repli heuristique :', error)
    return baseline
  }
}
