import { useEffect, useState, type ReactNode } from 'react'
import { Navigate } from 'react-router-dom'
import { findMyActiveSession, type ActiveSession } from '../lib/rooms'

export default function ActiveSessionRoute({ children }: { children: ReactNode }) {
  const [checking, setChecking] = useState(true)
  const [session, setSession] = useState<ActiveSession | null>(null)

  useEffect(() => {
    let active = true
    void findMyActiveSession()
      .then(result => { if (active) setSession(result) })
      .catch(() => undefined)
      .finally(() => { if (active) setChecking(false) })
    return () => { active = false }
  }, [])

  if (checking) return <div className="route-loading" aria-live="polite">진행 중인 게임을 확인하고 있어요.</div>
  if (session?.type === 'game') return <Navigate to={`/game?game=${encodeURIComponent(session.gameId)}`} replace />
  if (session?.type === 'room') return <Navigate to={`/room/${encodeURIComponent(session.roomId)}`} replace />
  return children
}
