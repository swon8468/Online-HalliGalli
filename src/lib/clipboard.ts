export async function copyText(value: string) {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(value)
      return true
    }
  } catch {
    // Permission can be denied in installed PWAs or embedded browsers. Use the
    // legacy selection fallback before asking the user to copy manually.
  }

  if (typeof document === 'undefined' || typeof document.execCommand !== 'function') return false
  const input = document.createElement('textarea')
  input.value = value
  input.setAttribute('readonly', '')
  input.style.position = 'fixed'
  input.style.opacity = '0'
  document.body.append(input)
  input.select()
  try { return document.execCommand('copy') }
  catch { return false }
  finally { input.remove() }
}

export function shareWasCancelled(cause: unknown) {
  return Boolean(cause && typeof cause === 'object' && 'name' in cause && cause.name === 'AbortError')
}
