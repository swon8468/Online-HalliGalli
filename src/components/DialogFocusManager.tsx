import { useEffect } from 'react'

const focusableSelector = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled]):not([type="hidden"])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',')

function focusableElements(dialog: HTMLElement) {
  return Array.from(dialog.querySelectorAll<HTMLElement>(focusableSelector)).filter(element => {
    const style = window.getComputedStyle(element)
    return style.visibility !== 'hidden' && style.display !== 'none' && !element.hidden
  })
}

/**
 * Applies one consistent keyboard focus policy to every aria-modal dialog.
 * This also covers dialogs rendered by individual feature pages without making
 * each page duplicate fragile Tab/Shift+Tab code.
 */
export default function DialogFocusManager() {
  useEffect(() => {
    let activeDialog: HTMLElement | null = null
    let previousFocus: HTMLElement | null = null
    let previousOverflow = ''

    const findTopDialog = () => {
      const dialogs = Array.from(document.querySelectorAll<HTMLElement>('[role="dialog"][aria-modal="true"]'))
      return dialogs.filter(dialog => dialog.getClientRects().length > 0).at(-1) ?? null
    }

    const refresh = () => {
      const nextDialog = findTopDialog()
      if (nextDialog === activeDialog) return
      if (!activeDialog && nextDialog) {
        previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null
        previousOverflow = document.body.style.overflow
        document.body.style.overflow = 'hidden'
      }
      activeDialog = nextDialog
      if (activeDialog) {
        window.requestAnimationFrame(() => {
          const preferred = activeDialog?.querySelector<HTMLElement>('[autofocus]')
          ;(preferred ?? (activeDialog ? focusableElements(activeDialog)[0] : null) ?? activeDialog)?.focus({ preventScroll: true })
        })
      } else {
        document.body.style.overflow = previousOverflow
        previousFocus?.focus({ preventScroll: true })
        previousFocus = null
      }
    }

    const onKeyDown = (event: KeyboardEvent) => {
      if (!activeDialog || event.key !== 'Tab') return
      const elements = focusableElements(activeDialog)
      if (!elements.length) { event.preventDefault(); activeDialog.focus(); return }
      const first = elements[0]
      const last = elements[elements.length - 1]
      if (event.shiftKey && (document.activeElement === first || !activeDialog.contains(document.activeElement))) {
        event.preventDefault(); last.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault(); first.focus()
      }
    }

    const onFocus = (event: FocusEvent) => {
      if (!activeDialog || activeDialog.contains(event.target as Node)) return
      ;(focusableElements(activeDialog)[0] ?? activeDialog).focus({ preventScroll: true })
    }

    const observer = new MutationObserver(refresh)
    observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['aria-modal', 'hidden', 'class'] })
    document.addEventListener('keydown', onKeyDown)
    document.addEventListener('focusin', onFocus)
    refresh()
    return () => {
      observer.disconnect(); document.removeEventListener('keydown', onKeyDown); document.removeEventListener('focusin', onFocus)
      document.body.style.overflow = previousOverflow
    }
  }, [])
  return null
}
