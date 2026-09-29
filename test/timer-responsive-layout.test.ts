import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'

const runnerPath = new URL('../app/components/timer/TimerRunner.vue', import.meta.url)
const controlsPath = new URL('../app/components/timer/TimerControls.vue', import.meta.url)
const nuxtConfigPath = new URL('../nuxt.config.ts', import.meta.url)

describe('contrat responsive du minuteur', () => {
  it('garde le contenu central défilable avec un cadran fluide pour 320×568 et le grand texte', async () => {
    const source = await readFile(runnerPath, 'utf8')

    expect(source).toContain('height: 100dvh')
    expect(source).toContain('overflow-x-hidden')
    expect(source).toContain('min-h-0 flex-1 overflow-y-auto')
    expect(source).toMatch(/--timer-dial-size:\s*clamp\(/)
    expect(source).toContain('@media (max-height: 700px), (orientation: landscape)')
    expect(source).toContain('@media (orientation: landscape) and (max-height: 568px)')
  })

  it('réserve les safe areas au plein écran, au dock et aux surfaces défilantes', async () => {
    const [runner, controls] = await Promise.all([
      readFile(runnerPath, 'utf8'),
      readFile(controlsPath, 'utf8'),
    ])

    expect(runner).toContain('env(safe-area-inset-top)')
    expect(runner).toContain('env(safe-area-inset-left)')
    expect(runner).toContain('env(safe-area-inset-right)')
    expect(controls).toContain('env(safe-area-inset-bottom)')
    expect(controls).toContain('overscroll-behavior: contain')
  })

  it('maintient le dock hors du flux défilant avec des cibles tactiles suffisantes', async () => {
    const source = await readFile(controlsPath, 'utf8')

    expect(source).toContain('flex: none')
    expect(source).toContain('min-height: 2.75rem')
    expect(source).toContain('min-height: 3rem')
    expect(source).toContain('min-height: 4rem')
  })

  it("n'empêche pas la rotation paysage en mode PWA", async () => {
    const source = await readFile(nuxtConfigPath, 'utf8')

    expect(source).toContain("orientation: 'any'")
    expect(source).not.toContain("orientation: 'portrait'")
  })
})
