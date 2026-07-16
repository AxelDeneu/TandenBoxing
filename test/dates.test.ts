import { describe, expect, it } from 'vitest'
import {
  addDays,
  addMonths,
  daysBetween,
  formatDateFr,
  isoWeekday,
  monthGridDays,
  monthLabel,
  startOfMonth,
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

describe('startOfMonth', () => {
  it('ramène au 1er du mois', () => {
    expect(startOfMonth('2026-07-16')).toBe('2026-07-01')
    expect(startOfMonth('2026-07-01')).toBe('2026-07-01')
  })
})

describe('addMonths', () => {
  it('décale de mois en s’ancrant sur le 1er', () => {
    expect(addMonths('2026-07-16', 1)).toBe('2026-08-01')
    expect(addMonths('2026-07-16', -1)).toBe('2026-06-01')
  })

  it('gère le passage d’année', () => {
    expect(addMonths('2026-12-10', 1)).toBe('2027-01-01')
    expect(addMonths('2026-01-15', -1)).toBe('2025-12-01')
    expect(addMonths('2026-01-15', -13)).toBe('2024-12-01')
  })

  it('ne déborde pas sur les mois courts (31 → mois suivant)', () => {
    expect(addMonths('2026-01-31', 1)).toBe('2026-02-01')
  })
})

describe('monthLabel', () => {
  it('formate le mois en français', () => {
    expect(monthLabel('2026-07-16')).toBe('juillet 2026')
    expect(monthLabel('2026-12-01')).toBe('décembre 2026')
  })
})

describe('monthGridDays', () => {
  // Juillet 2026 commence un mercredi → la grille recule au lundi 29 juin.
  const grid = monthGridDays('2026-07-16')

  it('renvoie 42 jours (6 semaines)', () => {
    expect(grid).toHaveLength(42)
  })

  it('commence un lundi, avant le 1er du mois', () => {
    expect(isoWeekday(grid[0]!)).toBe(1)
    expect(grid[0]).toBe('2026-06-29')
  })

  it('couvre tout le mois demandé', () => {
    expect(grid).toContain('2026-07-01')
    expect(grid).toContain('2026-07-31')
  })

  it('déborde sur le mois suivant et se termine un dimanche', () => {
    expect(grid[41]).toBe('2026-08-09')
    expect(isoWeekday(grid[41]!)).toBe(7)
  })

  it('enchaîne des jours consécutifs et uniques', () => {
    expect(new Set(grid).size).toBe(42)
    for (let i = 1; i < grid.length; i++) {
      expect(daysBetween(grid[i - 1]!, grid[i]!)).toBe(1)
    }
  })

  it('ne recule pas quand le mois commence déjà un lundi', () => {
    // Le 1er juin 2026 est un lundi.
    expect(isoWeekday('2026-06-01')).toBe(1)
    expect(monthGridDays('2026-06-10')[0]).toBe('2026-06-01')
  })
})
