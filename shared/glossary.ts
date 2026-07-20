export interface GlossaryEntry {
  label: string
  definition: string
  howTo: string
}

/** Termes de boxe / renforcement expliqués (clé = forme canonique en minuscules). */
export const GLOSSARY: Record<string, GlossaryEntry> = {
  jab: {
    label: 'Jab',
    definition:
      'Coup de poing direct porté avec le bras avant (le « 1 »). Rapide, il sert à jauger la distance et à ouvrir les combos.',
    howTo:
      "Depuis la garde, détends le bras avant en ligne droite vers la cible, le poing tourne à l'impact (paume vers le sol), puis ramène aussitôt la main au menton. Reste léger sur les appuis.",
  },
  cross: {
    label: 'Cross (direct arrière)',
    definition:
      "Coup direct puissant du bras arrière (le « 2 »). C'est le coup de force du combo 1‑2.",
    howTo:
      "Pivote le pied arrière et la hanche vers l'avant, transfère le poids sur la jambe avant, envoie le poing arrière en ligne droite, l'épaule protège le menton, puis retour en garde.",
  },
  direct: {
    label: 'Direct',
    definition:
      'Coup porté en ligne droite (jab ou cross), par opposition aux coups circulaires (crochet) ou remontants (uppercut).',
    howTo:
      'Frappe en poussant le poing tout droit vers la cible, épaule engagée, sans armer ni télégraphier le coup. Retour immédiat en garde.',
  },
  crochet: {
    label: 'Crochet',
    definition:
      'Coup circulaire horizontal, coude fléchi à environ 90°. Vise la mâchoire ou les côtes.',
    howTo:
      "Garde le coude à angle droit à hauteur d'épaule, pivote la hanche et le pied du côté qui frappe, décris un arc horizontal, buste gainé, l'autre main protège le visage.",
  },
  uppercut: {
    label: 'Uppercut',
    definition: 'Coup remontant vertical, porté sous le menton ou au plexus.',
    howTo:
      'Fléchis légèrement les jambes, remonte le poing de bas en haut en poussant sur les jambes et la hanche, coude près du corps, retour en garde.',
  },
  garde: {
    label: 'Garde',
    definition: 'Position de protection de base, point de départ et de retour de chaque coup.',
    howTo:
      "Poings près du menton, coudes rentrés qui protègent les côtes, menton légèrement baissé, épaules relâchées, pieds écartés largeur d'épaules avec un pied en avant.",
  },
  esquive: {
    label: 'Esquive',
    definition: 'Éviter un coup par un déplacement du buste ou de la tête, sans reculer bêtement.',
    howTo:
      'Fléchis les jambes et déplace le buste latéralement (slip) ou vers le bas, sans jamais baisser la garde, puis reviens aussitôt en position.',
  },
  pivot: {
    label: 'Pivot',
    definition:
      "Rotation sur le pied avant pour changer d'angle par rapport à l'adversaire (ou au sac).",
    howTo:
      'Pivote sur la plante du pied avant en faisant tourner le corps et le pied arrière, garde haute et équilibre conservé.',
  },
  footwork: {
    label: 'Jeu de jambes',
    definition:
      "Ensemble des déplacements des appuis : la base de la mobilité et de l'équilibre en boxe.",
    howTo:
      'Petits pas glissés sur la plante des pieds, ne croise jamais les pieds, garde toujours ta base stable pour pouvoir frapper ou esquiver.',
  },
  'shadow boxing': {
    label: 'Shadow boxing',
    definition:
      "Boxe dans le vide, sans sac ni adversaire — idéale pour l'échauffement et la technique.",
    howTo:
      'Enchaîne coups et déplacements dans le vide en visualisant un adversaire, en restant relâché et propre techniquement plutôt que fort.',
  },
  hiit: {
    label: 'HIIT',
    definition: 'Entraînement fractionné de haute intensité (High-Intensity Interval Training).',
    howTo:
      "Alterne de courtes phases d'effort quasi maximal et des récupérations brèves : c'est ce qui maximise la dépense et le souffle.",
  },
  tabata: {
    label: 'Tabata',
    definition:
      "Format de HIIT : 20 s d'effort intense / 10 s de repos, répété 8 fois (4 minutes).",
    howTo:
      'Donne tout pendant les 20 s, récupère 10 s, et recommence 8 fois. Choisis une intensité que tu peux tenir sur les 8 rounds.',
  },
  gainage: {
    label: 'Gainage',
    definition:
      'Renforcement isométrique du tronc (la « planche ») : essentiel pour encaisser et transmettre la puissance.',
    howTo:
      'En appui sur les avant-bras, corps parfaitement aligné (ni creux ni bosse), abdos et fessiers serrés, respire calmement sans bloquer.',
  },
  squat: {
    label: 'Squat',
    definition: 'Flexion des jambes au poids du corps : renforce cuisses et fessiers.',
    howTo:
      "Pieds largeur d'épaules, descends en poussant les fesses vers l'arrière, dos droit, genoux dans l'axe des pieds, puis remonte en poussant sur les talons.",
  },
  fente: {
    label: 'Fente',
    definition: 'Renforcement unilatéral des jambes (lunge).',
    howTo:
      "Grand pas vers l'avant, descends le genou arrière vers le sol sans qu'il touche, buste droit, puis remonte en poussant sur la jambe avant. Alterne les côtés.",
  },
  burpee: {
    label: 'Burpee',
    definition: 'Enchaînement complet très cardio, tout le corps.',
    howTo:
      'Squat → mains au sol → saut des pieds en planche → (pompe optionnelle) → ramène les pieds → saut vertical. Reste fluide et contrôlé.',
  },
  'mountain climber': {
    label: 'Mountain climber',
    definition: 'Montées de genoux alternées en position de planche : cardio + gainage.',
    howTo:
      'En planche bras tendus, ramène alternativement chaque genou vers la poitrine le plus vite possible, en gardant le bassin stable et bas.',
  },
}

export interface GlossaryGroup {
  label: string
  icon: string
  /** Clés canoniques de GLOSSARY, dans l'ordre d'affichage. */
  keys: string[]
}

/**
 * Regroupement thématique des termes pour la page glossaire consultable.
 * Chaque clé de GLOSSARY doit apparaître dans exactement un groupe (garde-fou testé).
 */
export const GLOSSARY_GROUPS: GlossaryGroup[] = [
  {
    label: 'Frappes',
    icon: 'i-lucide-target',
    keys: ['jab', 'cross', 'direct', 'crochet', 'uppercut'],
  },
  {
    label: 'Défense & déplacement',
    icon: 'i-lucide-shield',
    keys: ['garde', 'esquive', 'pivot', 'footwork'],
  },
  {
    label: 'Entraînement',
    icon: 'i-lucide-activity',
    keys: ['shadow boxing', 'hiit', 'tabata'],
  },
  {
    label: 'Renforcement & cardio',
    icon: 'i-lucide-dumbbell',
    keys: ['gainage', 'squat', 'fente', 'burpee', 'mountain climber'],
  },
]

/** Formes alternatives (pluriels, synonymes) → clé canonique. */
const ALIASES: Record<string, string> = {
  jabs: 'jab',
  crochets: 'crochet',
  uppercuts: 'uppercut',
  directs: 'direct',
  'direct arrière': 'cross',
  esquives: 'esquive',
  pivots: 'pivot',
  'jeu de jambes': 'footwork',
  shadow: 'shadow boxing',
  'shadow-boxing': 'shadow boxing',
  squats: 'squat',
  fentes: 'fente',
  burpees: 'burpee',
  'mountain climbers': 'mountain climber',
  planche: 'gainage',
}

function resolveEntry(matchLower: string): { key: string; entry: GlossaryEntry } | null {
  if (GLOSSARY[matchLower]) return { key: matchLower, entry: GLOSSARY[matchLower]! }
  const canonical = ALIASES[matchLower]
  if (canonical && GLOSSARY[canonical]) return { key: canonical, entry: GLOSSARY[canonical]! }
  return null
}

const ALL_TERMS = [...Object.keys(GLOSSARY), ...Object.keys(ALIASES)]
  .sort((a, b) => b.length - a.length) // les plus longs d'abord (ex: "shadow boxing" avant "shadow")
  .map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))

// Frontières basées sur les lettres Unicode (gère les accents).
const GLOSSARY_REGEX = new RegExp(`(?<!\\p{L})(${ALL_TERMS.join('|')})(?!\\p{L})`, 'giu')

export interface GlossarySegment {
  text: string
  entry?: GlossaryEntry
}

/**
 * Découpe un texte en segments, en marquant la PREMIÈRE occurrence de chaque terme du glossaire
 * (les répétitions restent du texte simple pour éviter le bruit). Fonction pure, testable.
 */
export function tokenizeGlossary(text: string): GlossarySegment[] {
  const segments: GlossarySegment[] = []
  const seen = new Set<string>()
  let lastIndex = 0

  for (const match of text.matchAll(GLOSSARY_REGEX)) {
    const matched = match[0]
    const idx = match.index ?? 0
    const resolved = resolveEntry(matched.toLowerCase())

    if (idx > lastIndex) segments.push({ text: text.slice(lastIndex, idx) })

    if (resolved && !seen.has(resolved.key)) {
      seen.add(resolved.key)
      segments.push({ text: matched, entry: resolved.entry })
    } else {
      segments.push({ text: matched })
    }
    lastIndex = idx + matched.length
  }

  if (lastIndex < text.length) segments.push({ text: text.slice(lastIndex) })
  return segments
}
