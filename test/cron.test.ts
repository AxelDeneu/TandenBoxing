import { describe, expect, it } from 'vitest'
import {
  GenerationScheduleError,
  prepareCronReplacement,
  scheduleGeneration,
  stopGeneration,
  type SchedulableJob,
} from '../server/utils/cron'

class FakeJob implements SchedulableJob {
  readonly calls: string[] = []

  constructor(
    private readonly next: Date | null = new Date('2026-09-29T07:00:00Z'),
    private readonly failResume = false,
  ) {}

  nextRun(): Date | null {
    this.calls.push('nextRun')
    return this.next
  }

  pause(): void {
    this.calls.push('pause')
  }

  resume(): void {
    this.calls.push('resume')
    if (this.failResume) throw new Error('resume failed')
  }

  stop(): void {
    this.calls.push('stop')
  }
}

describe('remplacement atomique du cron', () => {
  it('laisse l’ancien job strictement intact si la construction échoue', () => {
    const current = new FakeJob()
    let active: FakeJob | null = current

    expect(() =>
      prepareCronReplacement(
        current,
        () => {
          throw new Error('construction failed')
        },
        (next) => {
          active = next
        },
      ),
    ).toThrow(GenerationScheduleError)

    expect(active).toBe(current)
    expect(current.calls).toEqual([])
  })

  it('laisse l’ancien job actif si le nouveau ne peut pas démarrer', () => {
    const current = new FakeJob()
    const candidate = new FakeJob(new Date('2026-09-29T07:00:00Z'), true)
    let active: FakeJob | null = current
    const replacement = prepareCronReplacement(
      current,
      () => candidate,
      (next) => {
        active = next
      },
    )

    expect(() => replacement.activate()).toThrow(GenerationScheduleError)

    expect(active).toBe(current)
    expect(current.calls).toEqual([])
    expect(candidate.calls).toEqual(['nextRun', 'resume', 'stop'])
  })

  it('active le candidat avant de mettre en pause puis arrêter l’ancien', () => {
    const current = new FakeJob()
    const candidate = new FakeJob()
    let active: FakeJob | null = current
    const replacement = prepareCronReplacement(
      current,
      () => candidate,
      (next) => {
        active = next
      },
    )

    replacement.activate()
    expect(active).toBe(candidate)
    expect(candidate.calls).toEqual(['nextRun', 'resume'])
    expect(current.calls).toEqual(['pause'])

    replacement.finalize()
    expect(current.calls).toEqual(['pause', 'stop'])
  })

  it('restaure l’ancien job lorsque la transaction appelante est annulée', () => {
    const current = new FakeJob()
    const candidate = new FakeJob()
    let active: FakeJob | null = current
    const replacement = prepareCronReplacement(
      current,
      () => candidate,
      (next) => {
        active = next
      },
    )

    replacement.activate()
    replacement.rollback()

    expect(active).toBe(current)
    expect(candidate.calls).toEqual(['nextRun', 'resume', 'stop'])
    expect(current.calls).toEqual(['pause', 'resume'])
  })

  it('peut remplacer deux vrais jobs Croner successifs', () => {
    try {
      expect(() => scheduleGeneration({ generationTime: '23:59', timezone: 'UTC' })).not.toThrow()
      expect(() =>
        scheduleGeneration({ generationTime: '00:00', timezone: 'Europe/Paris' }),
      ).not.toThrow()
    } finally {
      stopGeneration()
    }
  })
})
