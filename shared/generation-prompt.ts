import type { WorkoutPrescription } from './workout-prescription'
import type { WorkoutVarietyConstraints } from './session-variety'

export interface GenerationPromptRequest {
  categorie: string | null
  focus: string | null
  focusLibre: string | null
  note: string | null
}

/** Sous-ensemble stable du contexte requis pour construire le prompt fournisseur. */
export interface GenerationPromptContext {
  dureeCibleMin: number
  prescription: WorkoutPrescription & { variety?: WorkoutVarietyConstraints }
  demande?: GenerationPromptRequest
}

export interface SessionPromptInput {
  dateLabel: string
  context: GenerationPromptContext
  adjustment?: string
  existingStructure?: unknown
}

/**
 * Sérialise la prescription comme contrainte structurée. Le modèle complète le contenu des
 * exercices, mais ne reprend aucune décision appartenant au planner.
 */
export function buildSessionPrompt(input: SessionPromptInput): string {
  const { context, adjustment, existingStructure } = input
  const { prescription, demande } = context
  const positiveBudgets = Object.entries(prescription.blockBudgets)
    .filter(([, seconds]) => seconds > 0)
    .map(([type, seconds]) => `- ${type} : ${seconds} secondes`)

  return [
    `Nous sommes le ${input.dateLabel}. Prépare ma séance de boxe du jour.`,
    ``,
    `PRESCRIPTION DÉTERMINISTE OBLIGATOIRE (ne prends pas à nouveau ces décisions) :`,
    '```json',
    JSON.stringify(prescription, null, 2),
    '```',
    `- Renvoie EXACTEMENT category="${prescription.category}" et focus="${prescription.focus}".`,
    `- Intensité globale : ${prescription.intensity}/5.`,
    `- Durée totale : ${prescription.targetSeconds} secondes, sans la dépasser.`,
    `- Budgets de blocs à réaliser :`,
    ...positiveBudgets,
    `- N'introduis pas plus de ${prescription.maxNewTechniques} technique(s) nouvelle(s).`,
    ...(prescription.variety
      ? [
          `- Chevauchement maximal du corps principal avec la séance précédente : ${Math.round(prescription.variety.maxMainOverlap * 100)} %.`,
          `- Routines d'échauffement préférées : ${prescription.variety.preferredWarmupVariantIds.join(', ')}.`,
          `- Routines de retour au calme préférées : ${prescription.variety.preferredCooldownVariantIds.join(', ')}.`,
          ...(prescription.variety.consolidation.intentional &&
          prescription.variety.consolidation.reason
            ? [
                `- Consolidation intentionnelle autorisée : ${prescription.variety.consolidation.reason}`,
              ]
            : []),
        ]
      : []),
    `- Un type de bloc doté d'un budget de 0 seconde ne doit pas être généré.`,
    ...(demande?.focusLibre
      ? [
          ``,
          `Thème sur mesure demandé : « ${demande.focusLibre} ». Utilise-le pour choisir les exercices, sans modifier le focus prescrit.`,
        ]
      : []),
    ...(demande?.note ? [`Note de l'utilisateur à prendre en compte : « ${demande.note} ».`] : []),
    ...(adjustment && existingStructure
      ? [
          ``,
          `AJUSTEMENT DEMANDÉ. Voici la séance actuelle (JSON) :`,
          '```json',
          JSON.stringify(existingStructure, null, 2),
          '```',
          `Applique cette consigne : « ${adjustment} ».`,
          `Garde la prescription, ainsi que tout ce que la consigne ne remet pas en cause ; ne change que ce qui est nécessaire.`,
        ]
      : []),
    ``,
    `Voici le contexte existant (profil, réglages, mémoire et historique récent), au format JSON :`,
    '```json',
    JSON.stringify(context, null, 2),
    '```',
    ``,
    `Choisis et rédige les exercices compatibles avec cette prescription, puis appelle l'outil "proposer_seance".`,
  ].join('\n')
}
