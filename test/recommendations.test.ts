import { describe, expect, it } from 'vitest'
import {
  detectFatigue,
  recommendFocuses,
  type RecoHistoryEntry,
} from '../shared/recommendations'

const TODAY = '2026-07-16'

/** Fabrique une entrée d'historique complétée. */
function done(
  date: string,
  focus: string,
  extra: Partial<RecoHistoryEntry> = {},
): RecoHistoryEntry {
  return { date, focus, category: 'renforcement', completed: true, ...extra }
}

describe('recommendFocuses — négligence', () => {
  it('sans historique, propose de découvrir les fondations en apprentissage', () => {
    const recos = recommendFocuses({ today: TODAY, history: [] })
    expect(recos).toHaveLength(4)
    expect(recos[0]!.focus).toBe('fondations')
    expect(recos[0]!.category).toBe('apprentissage')
    expect(recos[0]!.reason).toContain('Jamais travaillé')
  })

  it('priorise un focus jamais fait devant un focus travaillé récemment', () => {
    const recos = recommendFocuses({
      today: TODAY,
      history: [done('2026-07-15', 'uppercuts')],
      focuses: ['uppercuts', 'defense'],
      limit: 2,
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
    const [reco] = recommendFocuses({ today: TODAY, history: [], focuses: ['uppercuts'], limit: 1 })
    expect(reco!.category).toBe('apprentissage')
  })

  it('fait 1 à 2 fois → renforcement', () => {
    const [reco] = recommendFocuses({
      today: TODAY,
      history: [done('2026-06-10', 'uppercuts'), done('2026-06-20', 'uppercuts')],
      focuses: ['uppercuts'],
      limit: 1,
    })
    expect(reco!.category).toBe('renforcement')
    expect(reco!.reason).toContain('consolider')
  })

  it('bien maîtrisé (3+) → enchainement', () => {
    const [reco] = recommendFocuses({
      today: TODAY,
      history: [
        done('2026-06-10', 'uppercuts'),
        done('2026-06-20', 'uppercuts'),
        done('2026-06-30', 'uppercuts'),
      ],
      focuses: ['uppercuts'],
      limit: 1,
    })
    expect(reco!.category).toBe('enchainement')
    expect(reco!.reason).toContain('enchaîner')
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
