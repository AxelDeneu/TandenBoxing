import { describe, expect, it } from 'vitest'
import type { SkillId } from '../shared/curriculum'
import { detectFatigue, recommendFocuses, type RecoHistoryEntry } from '../shared/recommendations'
import { buildSkillProgression, type SkillExposure } from '../shared/skill-mastery'

const TODAY = '2026-07-16'

/** Fabrique une entrée d'historique complétée. */
function done(
  date: string,
  focus: string,
  extra: Partial<RecoHistoryEntry> = {},
): RecoHistoryEntry {
  return { date, focus, category: 'renforcement', completed: true, ...extra }
}

function skillExposure(
  skillId: SkillId,
  date: string,
  extra: Partial<SkillExposure> = {},
): SkillExposure {
  return {
    sessionKey: `${skillId}:${date}`,
    skillId,
    date,
    completed: true,
    difficulty: 2,
    energy: 4,
    source: 'declared',
    ...extra,
  }
}

function mastered(skillId: SkillId): SkillExposure[] {
  return ['2026-07-01', '2026-07-05', '2026-07-10'].map((date) => skillExposure(skillId, date))
}

const prerequisitesMastered = () => [...mastered('posture_garde'), ...mastered('appuis')]

describe('recommendFocuses — négligence', () => {
  it('sans historique, propose de découvrir les fondations en apprentissage', () => {
    const recos = recommendFocuses({ today: TODAY, history: [] })
    expect(recos).toHaveLength(3)
    expect(recos[0]!.focus).toBe('fondations')
    expect(recos[0]!.category).toBe('apprentissage')
    expect(recos[0]!.reason).toContain('Nouveauté éligible')
  })

  it('priorise un focus jamais fait devant un focus travaillé récemment', () => {
    const recos = recommendFocuses({
      today: TODAY,
      history: [done('2026-07-15', 'uppercuts')],
      focuses: ['uppercuts', 'defense'],
      limit: 2,
      skillProgression: buildSkillProgression(TODAY, [
        ...prerequisitesMastered(),
        skillExposure('uppercuts', '2026-07-15'),
      ]),
    })
    expect(recos[0]!.focus).toBe('defense') // jamais fait
    expect(recos[1]!.focus).toBe('uppercuts')
  })

  it('classe les focus déjà faits du plus ancien au plus récent', () => {
    const recos = recommendFocuses({
      today: TODAY,
      history: [done('2026-07-14', 'crochets'), done('2026-06-01', 'defense')],
      focuses: ['crochets', 'defense'],
      limit: 2,
      skillProgression: buildSkillProgression(TODAY, [
        ...prerequisitesMastered(),
        skillExposure('crochets', '2026-07-14'),
        skillExposure('defenses', '2026-06-01'),
      ]),
    })
    expect(recos[0]!.focus).toBe('defense') // 45 j
    expect(recos[1]!.focus).toBe('crochets') // 2 j
  })

  it('ne recommande jamais deux fois le même focus', () => {
    const recos = recommendFocuses({ today: TODAY, history: [], limit: 6 })
    expect(new Set(recos.map((r) => r.focus)).size).toBe(recos.length)
  })

  it('respecte la limite demandée', () => {
    expect(recommendFocuses({ today: TODAY, history: [], limit: 2 })).toHaveLength(2)
  })
})

describe('recommendFocuses — catégorie selon la maîtrise', () => {
  it('jamais fait → apprentissage', () => {
    const [reco] = recommendFocuses({
      today: TODAY,
      history: [],
      focuses: ['uppercuts'],
      limit: 1,
      skillProgression: buildSkillProgression(TODAY, prerequisitesMastered()),
    })
    expect(reco!.category).toBe('apprentissage')
  })

  it('fait 1 à 2 fois → renforcement', () => {
    const [reco] = recommendFocuses({
      today: TODAY,
      history: [done('2026-06-10', 'uppercuts'), done('2026-06-20', 'uppercuts')],
      focuses: ['uppercuts'],
      limit: 1,
      skillProgression: buildSkillProgression(TODAY, [
        ...prerequisitesMastered(),
        skillExposure('uppercuts', '2026-06-10'),
        skillExposure('uppercuts', '2026-06-20'),
      ]),
    })
    expect(reco!.category).toBe('renforcement')
    expect(reco!.reason).toContain('consolider')
  })

  it('trois réussites avec feedback et prérequis acquis → enchainement', () => {
    const [reco] = recommendFocuses({
      today: TODAY,
      history: [
        done('2026-06-10', 'uppercuts'),
        done('2026-06-20', 'uppercuts'),
        done('2026-06-30', 'uppercuts'),
      ],
      focuses: ['uppercuts'],
      limit: 1,
      skillProgression: buildSkillProgression(TODAY, [
        ...prerequisitesMastered(),
        ...mastered('uppercuts'),
      ]),
    })
    expect(reco!.category).toBe('enchainement')
    expect(reco!.reason).toContain('Acquis')
  })

  it('trois occurrences sans feedback restent en renforcement', () => {
    const history = [
      done('2026-07-01', 'uppercuts'),
      done('2026-07-05', 'uppercuts'),
      done('2026-07-10', 'uppercuts'),
    ]
    const neutral = history.map((entry) =>
      skillExposure('uppercuts', entry.date, { difficulty: null, energy: null }),
    )
    const [reco] = recommendFocuses({
      today: TODAY,
      history,
      focuses: ['uppercuts'],
      limit: 1,
      skillProgression: buildSkillProgression(TODAY, [...prerequisitesMastered(), ...neutral]),
    })
    expect(reco!.category).toBe('renforcement')
    expect(reco!.reason).toContain('consolider')
  })

  it('ignore les séances non faites dans le calcul de maîtrise', () => {
    const [reco] = recommendFocuses({
      today: TODAY,
      history: [
        done('2026-06-10', 'uppercuts'),
        { date: '2026-06-20', focus: 'uppercuts', category: null, completed: false },
        { date: '2026-06-30', focus: 'uppercuts', category: null, completed: false },
      ],
      focuses: ['uppercuts'],
      limit: 1,
      skillProgression: buildSkillProgression(TODAY, [
        ...prerequisitesMastered(),
        skillExposure('uppercuts', '2026-06-10'),
        skillExposure('uppercuts', '2026-06-20', { completed: false }),
        skillExposure('uppercuts', '2026-06-30', { completed: false }),
      ]),
    })
    // Une seule séance réellement faite → on consolide, on n'enchaîne pas.
    expect(reco!.category).toBe('renforcement')
  })
})

describe('detectFatigue', () => {
  it('détecte une accumulation (3 séances en 3 jours)', () => {
    const r = detectFatigue(TODAY, [
      done('2026-07-13', 'cardio'),
      done('2026-07-14', 'cardio'),
      done('2026-07-15', 'cardio'),
    ])
    expect(r.fatigued).toBe(true)
    expect(r.reason).toContain('3 jours')
  })

  it('détecte des séances récentes trop difficiles', () => {
    const r = detectFatigue(TODAY, [
      done('2026-07-08', 'cardio', { difficulty: 5 }),
      done('2026-07-11', 'cardio', { difficulty: 4 }),
    ])
    expect(r.fatigued).toBe(true)
    expect(r.reason).toContain('éprouvantes')
  })

  it('détecte une énergie basse', () => {
    const r = detectFatigue(TODAY, [
      done('2026-07-08', 'cardio', { energy: 2 }),
      done('2026-07-11', 'cardio', { energy: 1 }),
    ])
    expect(r.fatigued).toBe(true)
    expect(r.reason).toContain('Énergie basse')
  })

  it('ne signale rien sur un rythme sain', () => {
    const r = detectFatigue(TODAY, [
      done('2026-07-08', 'cardio', { difficulty: 3, energy: 4 }),
      done('2026-07-11', 'cardio', { difficulty: 2, energy: 4 }),
    ])
    expect(r.fatigued).toBe(false)
  })

  it('ignore les séances trop anciennes (> 10 jours)', () => {
    const r = detectFatigue(TODAY, [
      done('2026-05-01', 'cardio', { difficulty: 5 }),
      done('2026-05-02', 'cardio', { difficulty: 5 }),
      done('2026-05-03', 'cardio', { difficulty: 5 }),
    ])
    expect(r.fatigued).toBe(false)
  })
})

describe('recommendFocuses — récupération', () => {
  it('place la récupération en tête en cas de fatigue', () => {
    const recos = recommendFocuses({
      today: TODAY,
      history: [
        done('2026-07-13', 'cardio'),
        done('2026-07-14', 'crochets'),
        done('2026-07-15', 'defense'),
      ],
    })
    expect(recos[0]!.category).toBe('recuperation')
    expect(recos[0]!.reason).toContain('3 jours')
  })

  it('ne propose pas de récupération sur un rythme sain', () => {
    const recos = recommendFocuses({
      today: TODAY,
      history: [done('2026-07-08', 'cardio', { difficulty: 3, energy: 4 })],
    })
    expect(recos.every((r) => r.category !== 'recuperation')).toBe(true)
  })

  it('ne duplique pas le focus de récupération dans les autres recommandations', () => {
    const recos = recommendFocuses({
      today: TODAY,
      history: [
        done('2026-07-13', 'cardio'),
        done('2026-07-14', 'crochets'),
        done('2026-07-15', 'defense'),
      ],
    })
    expect(recos.filter((r) => r.focus === 'fondations')).toHaveLength(1)
  })
})
