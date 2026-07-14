const RECOVERY_REQUEST_KEY = 'halli-galli:recovery-request'
const LEGACY_RECOVERY_REQUEST_KEY = 'halli-galli:recovery-requested-at'

export const RECOVERY_REQUEST_COOLDOWN_MS = 60_000
const RECOVERY_RECEIPT_LIFETIME_MS = 30 * 60_000

export type RecoveryRequestReceipt = {
  identifier: string
  requestedAt: number
}

export function normalizeRecoveryEmail(value: string) {
  return value.trim().toLowerCase()
}

export function readRecoveryRequestReceipt(now = Date.now()): RecoveryRequestReceipt | null {
  try {
    const raw = sessionStorage.getItem(RECOVERY_REQUEST_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as Partial<RecoveryRequestReceipt>
    if (typeof parsed.identifier !== 'string' || !parsed.identifier.includes('@') || typeof parsed.requestedAt !== 'number') return null
    if (parsed.requestedAt > now || now - parsed.requestedAt > RECOVERY_RECEIPT_LIFETIME_MS) {
      sessionStorage.removeItem(RECOVERY_REQUEST_KEY)
      return null
    }
    return { identifier: normalizeRecoveryEmail(parsed.identifier), requestedAt: parsed.requestedAt }
  } catch {
    sessionStorage.removeItem(RECOVERY_REQUEST_KEY)
    return null
  }
}

export function recoveryRequestIsCoolingDown(identifier: string, now = Date.now()) {
  const receipt = readRecoveryRequestReceipt(now)
  return Boolean(receipt && receipt.identifier === normalizeRecoveryEmail(identifier) && now - receipt.requestedAt < RECOVERY_REQUEST_COOLDOWN_MS)
}

export function saveRecoveryRequestReceipt(identifier: string, requestedAt = Date.now()) {
  sessionStorage.setItem(RECOVERY_REQUEST_KEY, JSON.stringify({ identifier: normalizeRecoveryEmail(identifier), requestedAt }))
  sessionStorage.removeItem(LEGACY_RECOVERY_REQUEST_KEY)
}

export function clearRecoveryRequestReceipt() {
  sessionStorage.removeItem(RECOVERY_REQUEST_KEY)
  sessionStorage.removeItem(LEGACY_RECOVERY_REQUEST_KEY)
}
