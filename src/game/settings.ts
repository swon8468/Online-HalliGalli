export interface GameSettings {
  muted: boolean
  volume: number
  vibration: boolean
  reducedMotion: boolean
}

export type GameSound = 'card' | 'bell' | 'correct' | 'wrong' | 'victory' | 'defeat'

const storageKey = 'halli-galli:game-settings:v1'

export function defaultGameSettings(): GameSettings {
  return {
    muted: false,
    volume: 0.7,
    vibration: true,
    reducedMotion: typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true,
  }
}

export function loadGameSettings(): GameSettings {
  const defaults = defaultGameSettings()
  if (typeof window === 'undefined') return defaults
  try {
    const saved = JSON.parse(window.localStorage.getItem(storageKey) ?? '{}') as Partial<GameSettings>
    return {
      muted: typeof saved.muted === 'boolean' ? saved.muted : defaults.muted,
      volume: typeof saved.volume === 'number' ? Math.max(0, Math.min(1, saved.volume)) : defaults.volume,
      vibration: typeof saved.vibration === 'boolean' ? saved.vibration : defaults.vibration,
      reducedMotion: typeof saved.reducedMotion === 'boolean' ? saved.reducedMotion : defaults.reducedMotion,
    }
  } catch { return defaults }
}

export function saveGameSettings(settings: GameSettings) {
  if (typeof window === 'undefined') return
  window.localStorage.setItem(storageKey, JSON.stringify({ ...settings, volume: Math.max(0, Math.min(1, settings.volume)) }))
}

const tones: Record<GameSound, Array<[number, number, number]>> = {
  card: [[260, 0.04, 0.08]],
  bell: [[880, 0.02, 0.16], [1320, 0.08, 0.2]],
  correct: [[523, 0.01, 0.12], [659, 0.1, 0.14], [784, 0.2, 0.2]],
  wrong: [[240, 0.01, 0.16], [170, 0.14, 0.24]],
  victory: [[523, 0.01, 0.14], [659, 0.13, 0.14], [784, 0.26, 0.16], [1047, 0.4, 0.32]],
  defeat: [[330, 0.01, 0.18], [262, 0.17, 0.2], [196, 0.35, 0.32]],
}

export function playGameSound(kind: GameSound, settings: GameSettings) {
  if (settings.muted || settings.volume <= 0 || typeof window === 'undefined') return
  const AudioContextClass = window.AudioContext ?? (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
  if (!AudioContextClass) return
  const context = new AudioContextClass()
  const master = context.createGain()
  master.gain.value = settings.volume * 0.12
  master.connect(context.destination)
  for (const [frequency, delay, duration] of tones[kind]) {
    const oscillator = context.createOscillator()
    const gain = context.createGain()
    const start = context.currentTime + delay
    oscillator.type = kind === 'bell' ? 'sine' : 'triangle'
    oscillator.frequency.setValueAtTime(frequency, start)
    gain.gain.setValueAtTime(0.0001, start)
    gain.gain.exponentialRampToValueAtTime(1, start + 0.015)
    gain.gain.exponentialRampToValueAtTime(0.0001, start + duration)
    oscillator.connect(gain); gain.connect(master)
    oscillator.start(start); oscillator.stop(start + duration + 0.02)
  }
  window.setTimeout(() => void context.close(), 1000)
}

export function vibrateGame(pattern: number | number[], settings: GameSettings) {
  if (!settings.vibration || typeof navigator === 'undefined' || !navigator.vibrate) return false
  return navigator.vibrate(pattern)
}
