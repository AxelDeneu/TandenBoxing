import { describe, expect, it } from 'vitest'
import {
  generationScheduleSchema,
  generationTimeSchema,
  isUsableTimezone,
  timezoneSchema,
} from '../shared/schedule'

describe('validation de la planification', () => {
  it.each(['00:00', '07:00', '23:59'])('accepte l’heure réelle %s', (generationTime) => {
    expect(generationTimeSchema.safeParse(generationTime).success).toBe(true)
  })

  it.each(['99:99', '24:00', '23:60', '7:00'])('refuse l’heure impossible %s', (value) => {
    expect(generationTimeSchema.safeParse(value).success).toBe(false)
  })

  it.each(['Europe/Paris', 'UTC'])('accepte le fuseau utilisable %s', (timezone) => {
    expect(timezoneSchema.safeParse(timezone).success).toBe(true)
    expect(isUsableTimezone(timezone)).toBe(true)
  })

  it.each(['Mars/Olympus', '', 'Europe/Not_A_City'])('refuse le fuseau invalide %s', (value) => {
    expect(timezoneSchema.safeParse(value).success).toBe(false)
  })

  it('valide heure et fuseau avec un contrat unique', () => {
    expect(
      generationScheduleSchema.parse({ generationTime: '23:59', timezone: 'Europe/Paris' }),
    ).toEqual({ generationTime: '23:59', timezone: 'Europe/Paris' })
  })
})
