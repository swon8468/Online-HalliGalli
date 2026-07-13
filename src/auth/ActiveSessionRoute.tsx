import { useEffect, useState, type ReactNode } from 'react'
import { Navigate } from 'react-router-dom'
import { findMyActiveSession, type ActiveSession } from '../lib/rooms'

export default function ActiveSessionRoute({ children }: { children: ReactNode }) {
  const [checking, setChecking] = useState(true)
  const [session, setSession] = useState<ActiveSession | null>(null)
  const [failed, setFailed] = useState(false)
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    let active = true
    setChecking(true)
    setFailed(false)
    setSession(null)
    void findMyActiveSession()
      .then(result => { if (active) setSession(result) })
      .catch(() => { if (active) setFailed(true) })
      .finally(() => { if (active) setChecking(false) })
    return () => { active = false }
  }, [attempt])

  if (checking) return <div className="route-loading" aria-live="polite">진행 중인 게임을 확인하고 있어요.</div>
  if (failed) return <div className="route-loading"><div className="route-status-card" role="alert"><strong>진행 중인 게임을 확인하지 못했어요.</strong><p>연결을 확인한 뒤 다시 시도해 주세요.</p><button className="primary-button" onClick={() => setAttempt(value => value + 1)}>다시 확인</button></div></div>
  if (session?.type === 'game') return <Navigate to={`/game?game=${encodeURIComponent(session.gameId)}`} replace />
  if (session?.type === 'room') return <Navigate to={`/room/${encodeURIComponent(session.roomId)}`} replace />
  return children
}
