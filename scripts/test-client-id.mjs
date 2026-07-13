import assert from 'node:assert/strict'
import { createShortId, createUuid } from '../src/lib/id.ts'

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
const nativeDescriptor = Object.getOwnPropertyDescriptor(globalThis.crypto, 'randomUUID')

try {
  Object.defineProperty(globalThis.crypto, 'randomUUID', { configurable: true, value: undefined })
  const generated = Array.from({ length: 50 }, () => createUuid())
  assert.equal(generated.every(value => uuidPattern.test(value)), true)
  assert.equal(new Set(generated).size, generated.length)
  assert.match(createShortId(), /^[0-9a-f]{12}$/)
} finally {
  if (nativeDescriptor) Object.defineProperty(globalThis.crypto, 'randomUUID', nativeDescriptor)
}

assert.match(createUuid(), uuidPattern)
console.log('Client UUID fallback tests passed.')
