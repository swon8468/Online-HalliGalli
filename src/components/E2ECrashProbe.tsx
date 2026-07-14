import type { ReactNode } from 'react'

export default function E2ECrashProbe({ children }: { children: ReactNode }) {
  if (import.meta.env.MODE === 'e2e' && new URLSearchParams(window.location.search).get('_testCrash') === '1') {
    throw new Error('E2E render crash')
  }
  return children
}
