import { describe, expect, it } from 'vitest'
import {
  computeLongestStreak,
  computeMonthlyBuckets,
  computeStreak,
  computeWeeklyBuckets,
} from '../shared/stats-calc'

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

describe('computeMonthlyBuckets', () => {
  it('compte les séances par mois calendaire, du plus ancien au plus récent', () => {
    const buckets = computeMonthlyBuckets(
      ['2026-07-01', '2026-07-15', '2026-06-10', '2026-05-30'],
      '2026-07-20',
      3,
    )
    expect(buckets.map((b) => b.month)).toEqual(['2026-05', '2026-06', '2026-07'])
    expect(buckets.map((b) => b.count)).toEqual([1, 1, 2])
  })

  it('passe correctement la frontière d’année', () => {
    const buckets = computeMonthlyBuckets(['2026-01-05', '2025-12-25'], '2026-01-10', 2)
    expect(buckets.map((b) => b.month)).toEqual(['2025-12', '2026-01'])
    expect(buckets.map((b) => b.count)).toEqual([1, 1])
  })
})

describe('computeLongestStreak', () => {
  it('trouve la plus longue série historique, pas seulement celle en cours', () => {
    // Bloc de 3 (lun 06-08 → ven 06-12 → lun 06-15) puis rupture, puis bloc de 1.
    const done = new Set(['2026-06-08', '2026-06-10', '2026-06-12', '2026-06-15', '2026-06-26'])
    // mer 06-17, ven 06-19, lun 06-22, mer 06-24 manqués → série max = 4 (08,10,12,15)
    expect(computeLongestStreak(done, trainingDays, '2026-06-08', '2026-06-26')).toBe(4)
  })

  it('renvoie 0 sans jour d’entraînement', () => {
    expect(computeLongestStreak(new Set(['2026-06-08']), [], '2026-06-08', '2026-06-26')).toBe(0)
  })
})
