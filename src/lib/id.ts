function fillRandomBytes(bytes: Uint8Array) {
  if (globalThis.crypto?.getRandomValues) return globalThis.crypto.getRandomValues(bytes)
  for (let index = 0; index < bytes.length; index += 1) bytes[index] = Math.floor(Math.random() * 256)
  return bytes
}

/** Returns an RFC 4122 v4 UUID even in webviews without crypto.randomUUID. */
export function createUuid() {
  const nativeUuid = globalThis.crypto?.randomUUID?.()
  if (nativeUuid) return nativeUuid

  const bytes = fillRandomBytes(new Uint8Array(16))
  bytes[6] = (bytes[6] & 0x0f) | 0x40
  bytes[8] = (bytes[8] & 0x3f) | 0x80
  const hex = Array.from(bytes, value => value.toString(16).padStart(2, '0')).join('')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}

export function createShortId(length = 12) {
  return createUuid().replaceAll('-', '').slice(0, Math.max(1, length))
}
