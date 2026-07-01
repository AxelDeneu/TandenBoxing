import { describe, expect, it } from 'vitest'
import {
  addDays,
  daysBetween,
  formatDateFr,
  isoWeekday,
  todayIso,
  weekdayLabel,
} from '../shared/dates'

describe('isoWeekday', () => {
  it('lundi = 1 … dimanche = 7', () => {
    expect(isoWeekday('2026-06-29')).toBe(1) // lundi
    expect(isoWeekday('2026-07-01')).toBe(3) // mercredi
    expect(isoWeekday('2026-07-05')).toBe(7) // dimanche
  })
})

describe('weekdayLabel', () => {
  it('renvoie le libellé FR', () => {
    expect(weekdayLabel('2026-07-01')).toBe('mercredi')
  })
})

describe('addDays', () => {
  it('ajoute et retire des jours en gérant les mois', () => {
    expect(addDays('2026-07-01', 1)).toBe('2026-07-02')
    expect(addDays('2026-07-01', -1)).toBe('2026-06-30')
    expect(addDays('2026-07-01', 31)).toBe('2026-08-01')
  })
})

describe('daysBetween', () => {
  it('calcule la différence signée en jours', () => {
    expect(daysBetween('2026-07-01', '2026-07-08')).toBe(7)
    expect(daysBetween('2026-07-08', '2026-07-01')).toBe(-7)
  })
})

describe('formatDateFr', () => {
  it('formate en français complet', () => {
    expect(formatDateFr('2026-07-01')).toBe('mercredi 1 juillet 2026')
  })
})

describe('todayIso', () => {
  it('renvoie une date au format YYYY-MM-DD', () => {
    expect(todayIso('Europe/Paris')).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  })
})
