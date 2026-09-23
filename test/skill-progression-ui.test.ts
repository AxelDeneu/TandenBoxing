import { describe, expect, it } from 'vitest'
import { mapSkillProgressionApi, loadSkillProgression } from '../app/utils/skill-progression'
import type { SkillId } from '../shared/curriculum'
import { buildSkillProgression, type SkillExposure } from '../shared/skill-mastery'
import { presentSkillProgression } from '../shared/skill-progression-api'

const TODAY = '2026-09-23'

function exposure(skillId: SkillId, date: string): SkillExposure {
  return {
    sessionKey: `${skillId}:${date}`,
    date,
    skillId,
    completed: true,
    difficulty: 2,
    energy: 4,
    source: 'declared',
  }
}

function fourStateResponse() {
  return presentSkillProgression(
    buildSkillProgression(TODAY, [
      exposure('posture_garde', '2026-09-01'),
      exposure('posture_garde', '2026-09-05'),
      exposure('posture_garde', '2026-09-10'),
      exposure('jab', '2026-09-15'),
    ]),
  )
}

describe('mapping API/UI du parcours', () => {
  it('rend les quatre états décidés par l’API sans les recalculer côté client', () => {
    const view = mapSkillProgressionApi(fourStateResponse())
    const byId = new Map(view.skills.map((skill) => [skill.id, skill]))

    expect(byId.get('posture_garde')?.state).toBe('acquired')
    expect(byId.get('jab')?.state).toBe('consolidating')
    expect(byId.get('appuis')?.state).toBe('eligible')
    expect(byId.get('cross')?.state).toBe('blocked')
    expect(byId.get('cross')?.missingPrerequisites.map((skill) => skill.id)).toContain('jab')
  })

  it('signale des données partielles tout en conservant les cartes valides', () => {
    const response = fourStateResponse()
    response.skills = response.skills.slice(0, 3)
    response.dataQuality.complete = false
    response.dataQuality.warnings = ['Snapshot incomplet.']

    const view = mapSkillProgressionApi(response)

    expect(view.partial).toBe(true)
    expect(view.skills).toHaveLength(3)
    expect(view.dataQuality.warnings.join(' ')).toContain('Snapshot incomplet')
    expect(view.dataQuality.warnings.join(' ')).toContain('3 compétence(s) reçue(s) sur 10')
  })

  it('propage un succès de chargement et transforme une erreur réseau en erreur lisible', async () => {
    const response = fourStateResponse()

    await expect(loadSkillProgression(async () => response)).resolves.toMatchObject({
      partial: false,
      asOfDate: TODAY,
    })
    await expect(
      loadSkillProgression(async () => {
        throw new Error('ECONNRESET')
      }),
    ).rejects.toThrow('Impossible de charger le parcours de progression.')
  })

  it('refuse un contrat inconnu au lieu d’inventer un état', () => {
    expect(() => mapSkillProgressionApi({ schemaVersion: 99, skills: [] })).toThrow(
      'Impossible de charger le parcours de progression.',
    )
  })
})
