/**
 * Petit moteur audio (Web Audio API) : bips de compte à rebours et cloche de round.
 * L'AudioContext n'est créé qu'au premier appel (doit suivre un geste utilisateur).
 */
export interface SoundPlayer {
  unlock: () => void
  countdown: () => void
  start: () => void
  rest: () => void
  end: () => void
}

export function createSoundPlayer(): SoundPlayer {
  let ctx: AudioContext | null = null

  function ensure(): AudioContext | null {
    if (typeof window === 'undefined') return null
    try {
      if (!ctx) {
        const Ctor = window.AudioContext ?? (window as any).webkitAudioContext
        if (!Ctor) return null
        ctx = new Ctor()
      }
      if (ctx.state === 'suspended') void ctx.resume()
      return ctx
    } catch {
      return null
    }
  }

  function tone(
    freq: number,
    durationMs: number,
    type: OscillatorType = 'sine',
    gain = 0.2,
    whenOffset = 0,
  ) {
    const c = ensure()
    if (!c) return
    try {
      const t0 = c.currentTime + whenOffset
      const osc = c.createOscillator()
      const g = c.createGain()
      osc.type = type
      osc.frequency.value = freq
      g.gain.setValueAtTime(0.0001, t0)
      g.gain.linearRampToValueAtTime(gain, t0 + 0.01)
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + durationMs / 1000)
      osc.connect(g).connect(c.destination)
      osc.start(t0)
      osc.stop(t0 + durationMs / 1000 + 0.02)
    } catch {
      /* silencieux */
    }
  }

  return {
    unlock: () => ensure(),
    countdown: () => tone(880, 120, 'sine', 0.14),
    // Cloche de round : double note montante façon gong.
    start: () => {
      tone(620, 160, 'square', 0.16)
      tone(940, 280, 'square', 0.15, 0.11)
    },
    rest: () => tone(430, 200, 'sine', 0.14),
    end: () => {
      tone(620, 200, 'square', 0.17, 0)
      tone(880, 220, 'square', 0.17, 0.22)
      tone(1180, 420, 'square', 0.18, 0.46)
    },
  }
}
