import type {
  EvaluationCase,
  EvaluationContext,
  EvaluationCorpus,
  SyntheticHistoryEntry,
} from '../types'

const DEFAULT_PROFILE: EvaluationContext['profile'] = {
  level: 'debutant',
  fitnessLevel: 'actif',
  equipment: ['sac de frappe', 'gants', 'bandes'],
  constraints: [],
}

function context(
  date: string,
  targetDurationMin: number,
  overrides: Partial<EvaluationContext> = {},
): EvaluationContext {
  return {
    date,
    targetDurationMin,
    profile: DEFAULT_PROFILE,
    history: [],
    skippedSessions: [],
    ...overrides,
  }
}

function done(
  date: string,
  focus: SyntheticHistoryEntry['focus'],
  overrides: Partial<SyntheticHistoryEntry> = {},
): SyntheticHistoryEntry {
  return {
    date,
    category: 'renforcement',
    focus,
    completed: true,
    difficulty: 3,
    energy: 4,
    ...overrides,
  }
}

const cases: EvaluationCase[] = [
  {
    id: 'beginner-no-history-30',
    title: 'Débutant sans historique — 30 min',
    description: 'Premier entraînement, profil actif, aucune séance ni technique connue.',
    tags: ['beginner'],
    context: context('2027-01-04', 30),
    expected: {
      category: 'apprentissage',
      focus: 'fondations',
      progression: { maxComboLength: 2 },
    },
  },
  {
    id: 'beginner-sedentary-20',
    title: 'Débutant sédentaire — format court',
    description: 'Premier entraînement de vingt minutes pour une reprise d’activité progressive.',
    tags: ['beginner'],
    context: context('2027-01-05', 20, {
      profile: { ...DEFAULT_PROFILE, fitnessLevel: 'sedentaire' },
    }),
    expected: {
      category: 'apprentissage',
      focus: 'fondations',
      progression: { maxComboLength: 2 },
    },
  },
  {
    id: 'beginner-active-45',
    title: 'Débutant actif — format long',
    description: 'Débutant en boxe mais déjà actif, disponible quarante-cinq minutes.',
    tags: ['beginner'],
    context: context('2027-01-06', 45),
    expected: {
      category: 'apprentissage',
      focus: 'fondations',
      progression: { maxComboLength: 2 },
    },
  },
  {
    id: 'return-after-three-weeks',
    title: 'Reprise après trois semaines',
    description: 'Une seule séance ancienne puis une coupure de vingt et un jours.',
    tags: ['skipped-session'],
    context: context('2027-02-01', 30, {
      history: [done('2027-01-11', 'fondations')],
      skippedSessions: [{ date: '2027-01-25', reason: 'Indisponibilité ponctuelle' }],
    }),
    expected: { category: 'renforcement', focus: 'fondations' },
  },
  {
    id: 'skipped-lack-of-time',
    title: 'Séance sautée par manque de temps',
    description: 'Une séance récente a été sautée sans signal physique ni fatigue.',
    tags: ['skipped-session'],
    context: context('2027-02-03', 25, {
      history: [done('2027-01-30', 'jeu_de_jambes')],
      skippedSessions: [{ date: '2027-02-01', reason: 'Manque de temps' }],
    }),
    expected: { category: 'renforcement', focus: 'jeu_de_jambes' },
  },
  {
    id: 'skipped-for-fatigue',
    title: 'Séance sautée pour fatigue',
    description: 'La raison de la séance sautée signale explicitement une fatigue persistante.',
    tags: ['skipped-session', 'fatigue'],
    context: context('2027-02-05', 25, {
      history: [done('2027-02-01', 'cardio', { difficulty: 5, energy: 2 })],
      skippedSessions: [{ date: '2027-02-03', reason: 'Fatigue persistante' }],
      fatigueSignal: 'skipped-for-fatigue',
    }),
    expected: {
      category: 'recuperation',
      focus: 'fondations',
      progression: { allowedCategories: ['recuperation'], maxWorkIntervalSec: 40 },
    },
  },
  {
    id: 'constraint-shoulder',
    title: 'Contrainte épaule',
    description: 'Gêne d’épaule déclarée, sans diagnostic ni autre donnée personnelle.',
    tags: ['physical-constraint'],
    context: context('2027-02-08', 30, {
      profile: { ...DEFAULT_PROFILE, constraints: ['Limiter les mouvements au-dessus de la tête'] },
    }),
    expected: { category: 'apprentissage', focus: 'jeu_de_jambes' },
  },
  {
    id: 'constraint-knee',
    title: 'Contrainte genou',
    description: 'Impact et flexion profonde à éviter pendant cette séance synthétique.',
    tags: ['physical-constraint'],
    context: context('2027-02-10', 30, {
      profile: { ...DEFAULT_PROFILE, constraints: ['Éviter sauts et flexions profondes'] },
    }),
    expected: { category: 'apprentissage', focus: 'fondations' },
  },
  {
    id: 'constraint-wrist',
    title: 'Contrainte poignet',
    description: 'Volume de frappe à alléger, avec priorité au placement et aux appuis.',
    tags: ['physical-constraint'],
    context: context('2027-02-12', 20, {
      profile: { ...DEFAULT_PROFILE, constraints: ['Limiter les impacts du poignet droit'] },
    }),
    expected: { category: 'recuperation', focus: 'jeu_de_jambes' },
  },
  {
    id: 'fatigue-three-days',
    title: 'Charge sur trois jours consécutifs',
    description: 'Trois séances terminées sur les trois jours précédents.',
    tags: ['fatigue'],
    context: context('2027-02-15', 30, {
      history: [
        done('2027-02-12', 'cardio'),
        done('2027-02-13', 'crochets'),
        done('2027-02-14', 'defense'),
      ],
      fatigueSignal: 'training-load',
    }),
    expected: {
      category: 'recuperation',
      focus: 'fondations',
      progression: { allowedCategories: ['recuperation'], maxWorkIntervalSec: 40 },
    },
  },
  {
    id: 'fatigue-high-difficulty',
    title: 'Difficulté ressentie élevée',
    description: 'Deux séances récentes ont été évaluées difficiles ou très difficiles.',
    tags: ['fatigue'],
    context: context('2027-02-17', 25, {
      history: [
        done('2027-02-12', 'cardio', { difficulty: 5 }),
        done('2027-02-15', 'puissance', { difficulty: 4 }),
      ],
      fatigueSignal: 'difficulty',
    }),
    expected: {
      category: 'recuperation',
      focus: 'fondations',
      progression: { allowedCategories: ['recuperation'], maxWorkIntervalSec: 40 },
    },
  },
  {
    id: 'fatigue-low-energy',
    title: 'Énergie basse',
    description: 'Les deux derniers retours indiquent un niveau d’énergie faible.',
    tags: ['fatigue'],
    context: context('2027-02-19', 25, {
      history: [
        done('2027-02-14', 'cardio', { energy: 1 }),
        done('2027-02-17', 'combinaisons', { energy: 2 }),
      ],
      fatigueSignal: 'low-energy',
    }),
    expected: {
      category: 'recuperation',
      focus: 'fondations',
      progression: { allowedCategories: ['recuperation'], maxWorkIntervalSec: 40 },
    },
  },
  {
    id: 'neglected-defense',
    title: 'Focus défense négligé',
    description:
      'La défense n’a jamais été travaillée alors que plusieurs autres thèmes l’ont été.',
    tags: ['neglected-focus'],
    context: context('2027-02-22', 35, {
      history: [
        done('2027-02-10', 'fondations'),
        done('2027-02-14', 'crochets'),
        done('2027-02-18', 'cardio'),
      ],
      neglectedFocus: 'defense',
    }),
    expected: { category: 'apprentissage', focus: 'defense' },
  },
  {
    id: 'neglected-uppercuts',
    title: 'Focus uppercuts négligé',
    description: 'Les uppercuts sont le seul thème technique jamais abordé dans cet historique.',
    tags: ['neglected-focus'],
    context: context('2027-02-24', 35, {
      history: [
        done('2027-02-08', 'fondations'),
        done('2027-02-12', 'jeu_de_jambes'),
        done('2027-02-16', 'defense'),
        done('2027-02-20', 'crochets'),
      ],
      neglectedFocus: 'uppercuts',
    }),
    expected: { category: 'apprentissage', focus: 'uppercuts' },
  },
  {
    id: 'explicit-cardio-category',
    title: 'Demande explicite cardio',
    description: 'La catégorie cardio est imposée, le focus est laissé au planner.',
    tags: ['explicit-request'],
    context: context('2027-03-01', 30, {
      request: { category: 'cardio', focus: null, customFocus: null, note: null },
    }),
    expected: { category: 'cardio', focus: 'cardio' },
  },
  {
    id: 'explicit-learning-category',
    title: 'Demande explicite apprentissage',
    description: 'La catégorie apprentissage est imposée avec un thème de défense.',
    tags: ['explicit-request'],
    context: context('2027-03-03', 40, {
      request: { category: 'apprentissage', focus: 'defense', customFocus: null, note: null },
    }),
    expected: { category: 'apprentissage', focus: 'defense' },
  },
  {
    id: 'explicit-crochets-focus',
    title: 'Demande explicite crochets',
    description: 'Le focus crochets est imposé, la catégorie reste libre.',
    tags: ['explicit-request'],
    context: context('2027-03-05', 30, {
      request: { category: null, focus: 'crochets', customFocus: null, note: null },
    }),
    expected: { category: 'renforcement', focus: 'crochets' },
  },
  {
    id: 'custom-focus-pectoraux',
    title: 'Thème libre pectoraux',
    description: 'Demande sur mesure orientée pectoraux, à traduire vers le focus gainage.',
    tags: ['explicit-request'],
    context: context('2027-03-08', 30, {
      request: { category: 'renforcement', focus: null, customFocus: 'pectoraux', note: null },
    }),
    expected: { category: 'renforcement', focus: 'gainage' },
  },
  {
    id: 'custom-focus-explosivity',
    title: 'Thème libre explosivité',
    description: 'Demande sur mesure d’explosivité, à traduire vers le focus puissance.',
    tags: ['explicit-request'],
    context: context('2027-03-10', 35, {
      request: { category: null, focus: null, customFocus: 'explosivité', note: null },
    }),
    expected: { category: 'renforcement', focus: 'puissance' },
  },
  {
    id: 'explicit-recovery-note',
    title: 'Récupération demandée',
    description: 'La note du jour demande une séance très douce après une nuit courte.',
    tags: ['explicit-request', 'fatigue'],
    context: context('2027-03-12', 20, {
      request: {
        category: 'recuperation',
        focus: 'fondations',
        customFocus: null,
        note: 'Séance très douce, nuit courte',
      },
      fatigueSignal: 'low-energy',
    }),
    expected: {
      category: 'recuperation',
      focus: 'fondations',
      progression: { allowedCategories: ['recuperation'], maxWorkIntervalSec: 40 },
    },
  },
  {
    id: 'foundation-week-1',
    title: 'Progression fondations — semaine 1',
    description: 'Introduction du jab seul avant toute combinaison.',
    tags: ['progression', 'beginner'],
    context: context('2027-04-05', 25),
    expected: {
      category: 'apprentissage',
      focus: 'fondations',
      progression: { maxComboLength: 1 },
    },
    sequence: { id: 'foundation-four-weeks', position: 1 },
  },
  {
    id: 'foundation-week-2',
    title: 'Progression fondations — semaine 2',
    description: 'Ajout du cross après l’acquisition du jab.',
    tags: ['progression'],
    context: context('2027-04-12', 25, {
      history: [done('2027-04-05', 'fondations', { combos: ['1'] })],
    }),
    expected: {
      category: 'renforcement',
      focus: 'fondations',
      progression: { requiredPreviousCombos: ['1'], maxComboLength: 2 },
    },
    sequence: { id: 'foundation-four-weeks', position: 2 },
  },
  {
    id: 'foundation-week-3',
    title: 'Progression fondations — semaine 3',
    description: 'Ajout du crochet avant après le jab-cross.',
    tags: ['progression'],
    context: context('2027-04-19', 30, {
      history: [done('2027-04-12', 'fondations', { combos: ['1-2'] })],
    }),
    expected: {
      category: 'renforcement',
      focus: 'combinaisons',
      progression: { requiredPreviousCombos: ['1-2'], maxComboLength: 3 },
    },
    sequence: { id: 'foundation-four-weeks', position: 3 },
  },
  {
    id: 'foundation-week-4',
    title: 'Progression fondations — semaine 4',
    description: 'Enchaînement à quatre coups après le prérequis à trois coups.',
    tags: ['progression'],
    context: context('2027-04-26', 30, {
      history: [done('2027-04-19', 'combinaisons', { combos: ['1-2-3'] })],
    }),
    expected: {
      category: 'enchainement',
      focus: 'combinaisons',
      progression: { requiredPreviousCombos: ['1-2-3'], maxComboLength: 4 },
    },
    sequence: { id: 'foundation-four-weeks', position: 4 },
  },
  {
    id: 'load-cycle-session-1',
    title: 'Cycle de charge — séance 1',
    description: 'Première séance normale du microcycle synthétique.',
    tags: ['progression'],
    context: context('2027-05-03', 30),
    expected: { category: 'apprentissage', focus: 'jeu_de_jambes' },
    sequence: { id: 'load-then-recovery', position: 1 },
  },
  {
    id: 'load-cycle-session-2',
    title: 'Cycle de charge — séance 2',
    description: 'Deuxième séance, volume maintenu sans signal de fatigue.',
    tags: ['progression'],
    context: context('2027-05-04', 30, {
      history: [done('2027-05-03', 'jeu_de_jambes')],
    }),
    expected: { category: 'renforcement', focus: 'defense' },
    sequence: { id: 'load-then-recovery', position: 2 },
  },
  {
    id: 'load-cycle-session-3',
    title: 'Cycle de charge — séance 3',
    description: 'Troisième séance consécutive avant apparition du signal de fatigue.',
    tags: ['progression'],
    context: context('2027-05-05', 30, {
      history: [done('2027-05-03', 'jeu_de_jambes'), done('2027-05-04', 'defense')],
    }),
    expected: { category: 'cardio', focus: 'cardio' },
    sequence: { id: 'load-then-recovery', position: 3 },
  },
  {
    id: 'load-cycle-recovery',
    title: 'Cycle de charge — récupération',
    description: 'La quatrième étape doit alléger la séance après trois jours de charge.',
    tags: ['progression', 'fatigue'],
    context: context('2027-05-06', 25, {
      history: [
        done('2027-05-03', 'jeu_de_jambes'),
        done('2027-05-04', 'defense'),
        done('2027-05-05', 'cardio', { difficulty: 4, energy: 2 }),
      ],
      fatigueSignal: 'training-load',
    }),
    expected: {
      category: 'recuperation',
      focus: 'fondations',
      progression: { allowedCategories: ['recuperation'], maxWorkIntervalSec: 40 },
    },
    sequence: { id: 'load-then-recovery', position: 4 },
  },
]

/**
 * Corpus 100 % synthétique : aucun accès à SQLite, aucune variable d'environnement et
 * aucun texte libre issu d'un utilisateur réel.
 */
export const SYNTHETIC_CORPUS: EvaluationCorpus = {
  id: 'synthetic-generator-corpus/v1',
  description:
    '28 contextes synthétiques couvrant démarrage, fatigue, séances sautées, contraintes, demandes et progression.',
  cases,
}
