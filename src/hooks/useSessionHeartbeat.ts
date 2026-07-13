import { useEffect, useRef, useState } from 'react'
import { heartbeatGameSession, heartbeatRoomSession, markGameSessionDisconnected, markRoomSessionDisconnected } from '../lib/rooms'

export function useSessionHeartbeat(kind: 'room' | 'game', id: string | null | undefined, onReconnect?: () => void) {
  const [online, setOnline] = useState(() => navigator.onLine)
  const [serverConnected, setServerConnected] = useState(true)
  const reconnectRef = useRef(onReconnect)
  reconnectRef.current = onReconnect

  useEffect(() => {
    if (!id) return
    let active = true
    let pulsePromise: Promise<boolean> | null = null
    let reconcilePromise: Promise<void> | null = null
    const runPulse = async () => {
      if (!navigator.onLine) { if (active) { setOnline(false); setServerConnected(false) }; return false }
      try {
        if (kind === 'game') await heartbeatGameSession(id)
        else await heartbeatRoomSession(id)
        if (active) { setOnline(true); setServerConnected(true) }
        return true
      } catch {
        if (active) setServerConnected(false)
        return false
      }
    }
    const pulse = () => {
      if (pulsePromise) return pulsePromise
      pulsePromise = runPulse().finally(() => { pulsePromise = null })
      return pulsePromise
    }
    const reconcile = () => {
      if (reconcilePromise) return
      reconcilePromise = pulse()
        .then(connected => { if (connected && active) reconnectRef.current?.() })
        .finally(() => { reconcilePromise = null })
    }
    const reconnect = () => { setOnline(true); reconcile() }
    const disconnect = () => { setOnline(false); setServerConnected(false) }
    const visible = () => { if (document.visibilityState === 'visible') reconcile() }
    const pageHide = () => {
      if (kind === 'game') void markGameSessionDisconnected(id)
      else void markRoomSessionDisconnected(id)
    }

    void pulse()
    const timer = window.setInterval(() => void pulse(), 10_000)
    window.addEventListener('online', reconnect)
    window.addEventListener('offline', disconnect)
    window.addEventListener('pagehide', pageHide)
    document.addEventListener('visibilitychange', visible)
    return () => {
      active = false
      window.clearInterval(timer)
      window.removeEventListener('online', reconnect)
      window.removeEventListener('offline', disconnect)
      window.removeEventListener('pagehide', pageHide)
      document.removeEventListener('visibilitychange', visible)
    }
  }, [id, kind])

  return { online, serverConnected }
}
