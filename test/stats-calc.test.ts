import { describe, expect, it } from 'vitest'
import { computeStreak, computeWeeklyBuckets } from '../shared/stats-calc'

const trainingDays = [1, 3, 5] // lundi / mercredi / vendredi

describe('computeStreak', () => {
  it('compte les jours d’entraînement consécutifs complétés', () => {
    // today = vendredi 2026-07-03 ; complétés : ven 07-03, mer 07-01, lun 06-29
    const done = new Set(['2026-07-03', '2026-07-01', '2026-06-29'])
    expect(computeStreak(done, trainingDays, '2026-07-03')).toBe(3)
  })

  it('tolère aujourd’hui non encore fait', () => {
    const done = new Set(['2026-07-01', '2026-06-29'])
    expect(computeStreak(done, trainingDays, '2026-07-03')).toBe(2)
  })

  it('rompt la série au premier jour d’entraînement manqué', () => {
    const done = new Set(['2026-07-03']) // mercredi 07-01 manqué
    expect(computeStreak(done, trainingDays, '2026-07-03')).toBe(1)
  })
})

describe('computeWeeklyBuckets', () => {
  it('compte les séances par semaine (lundi → dimanche)', () => {
    const buckets = computeWeeklyBuckets(
      ['2026-07-01', '2026-07-03', '2026-06-24'],
      '2026-07-03',
      2,
    )
    expect(buckets.length).toBe(2)
    expect(buckets[0]!.count).toBe(1) // semaine du 22 au 28 juin → 06-24
    expect(buckets[1]!.count).toBe(2) // semaine courante (29 juin → 5 juil) → 07-01 + 07-03
  })
})
