import assert from 'node:assert/strict'

const storage = new Map()
globalThis.window = {
  localStorage: {
    getItem: key => storage.get(key) ?? null,
    setItem: (key, value) => storage.set(key, value),
  },
  matchMedia: () => ({ matches: false }),
}
const { defaultGameSettings, loadGameSettings, playGameSound, saveGameSettings, vibrateGame } = await import('../src/game/settings.ts')
const defaults = defaultGameSettings()
assert.deepEqual(defaults, { muted: false, volume: 0.7, vibration: true, reducedMotion: false })

saveGameSettings({ muted: true, volume: 2, vibration: false, reducedMotion: true })
assert.deepEqual(loadGameSettings(), { muted: true, volume: 1, vibration: false, reducedMotion: true })
storage.set('halli-galli:game-settings:v1', JSON.stringify({ volume: -3 }))
assert.equal(loadGameSettings().volume, 0)
storage.set('halli-galli:game-settings:v1', '{invalid')
assert.deepEqual(loadGameSettings(), defaults)

assert.doesNotThrow(() => playGameSound('bell', { ...defaults, muted: true }))
assert.equal(vibrateGame(30, defaults), false)
console.log('verified persisted mute/volume/vibration/reduced-motion settings, value clamping, corrupt-storage fallback, and unsupported-device safety')
