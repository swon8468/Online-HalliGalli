import { Check, LoaderCircle, Radio, UserRound, X } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../auth/AuthContext'
import PageHeader from '../components/PageHeader'
import { getErrorMessage } from '../lib/errorMessage'
import { cancelMatchmaking, getMatchmakingStatus, heartbeatMatchmaking, joinMatchmaking, subscribeToMatchmaking, subscribeToOnlinePresence, type MatchmakingStatus } from '../lib/matchmaking'

const idleStatus: MatchmakingStatus = { status: 'idle', queueCount: 0, members: [] }

function matchingError(error: unknown) {
  const message = getErrorMessage(error)
  if (message.includes('active room or game')) return '이미 참여 중인 방이나 게임이 있어요.'
  if (message.includes('match already created')) return '이미 매칭이 완료되어 게임으로 이동합니다.'
  if (message.includes('invalid player count')) return '2명부터 6명까지 선택해 주세요.'
  return message || '매칭 상태를 처리하지 못했습니다.'
}

export default function Online() {
  const navigate = useNavigate()
  const { user } = useAuth()
  const [count, setCount] = useState(4)
  const [status, setStatus] = useState<MatchmakingStatus>(idleStatus)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [onlineCount, setOnlineCount] = useState(1)
  const [error, setError] = useState('')
  const statusRequestRef = useRef<Promise<MatchmakingStatus> | null>(null)
  const operationVersionRef = useRef(0)

  const requestStatus = useCallback(() => {
    if (!statusRequestRef.current) {
      statusRequestRef.current = getMatchmakingStatus().finally(() => { statusRequestRef.current = null })
    }
    return statusRequestRef.current
  }, [])

  const applyStatus = useCallback((next: MatchmakingStatus) => {
    setStatus(next)
    if (next.playerCount) setCount(next.playerCount)
    if (next.status === 'matched' && next.gameId) {
      navigate(`/game?game=${encodeURIComponent(next.gameId)}`, { replace: true })
    }
  }, [navigate])

  useEffect(() => {
    if (!user) return
    let active = true
    const refresh = () => {
      const version = operationVersionRef.current
      return requestStatus()
        .then(next => { if (active && operationVersionRef.current === version) applyStatus(next) })
        .catch(caught => { if (active) setError(matchingError(caught)) })
        .finally(() => { if (active) setLoading(false) })
    }
    void refresh()
    const unsubscribeQueue = subscribeToMatchmaking(user.id, () => void refresh())
    const unsubscribePresence = subscribeToOnlinePresence(user.id, value => active && setOnlineCount(value))
    return () => { active = false; unsubscribeQueue(); unsubscribePresence() }
  }, [applyStatus, requestStatus, user])

  useEffect(() => {
    if (status.status !== 'waiting') return
    let active = true
    let pulsePromise: Promise<void> | null = null
    const pulse = () => {
      if (pulsePromise) return pulsePromise
      const version = operationVersionRef.current
      pulsePromise = heartbeatMatchmaking()
        .then(next => { if (active && operationVersionRef.current === version) applyStatus(next) })
        .catch(caught => { if (active) setError(matchingError(caught)) })
        .finally(() => { pulsePromise = null })
      return pulsePromise
    }
    const timer = window.setInterval(() => void pulse(), 10_000)
    const reconnect = () => void pulse()
    window.addEventListener('online', reconnect)
    return () => { active = false; window.clearInterval(timer); window.removeEventListener('online', reconnect) }
  }, [applyStatus, status.status])

  const start = async () => {
    const version = ++operationVersionRef.current
    setBusy(true)
    setError('')
    try {
      const next = await joinMatchmaking(count)
      if (operationVersionRef.current === version) applyStatus(next)
    }
    catch (caught) { setError(matchingError(caught)) }
    finally { setBusy(false); setLoading(false) }
  }

  const cancel = async () => {
    const version = ++operationVersionRef.current
    setBusy(true)
    setError('')
    try {
      const next = await cancelMatchmaking()
      if (operationVersionRef.current === version) applyStatus(next)
    }
    catch (caught) {
      setError(matchingError(caught))
      try {
        const next = await getMatchmakingStatus()
        if (operationVersionRef.current === version) applyStatus(next)
      } catch { /* keep the original error */ }
    } finally { setBusy(false) }
  }

  if (status.status === 'waiting' || status.status === 'matched') {
    const selectedCount = status.playerCount ?? count
    const found = Math.min(status.queueCount, selectedCount)
    return (
      <div className="content-page narrow-page matching-page play-flow-page">
        <button className="match-close" onClick={() => void cancel()} disabled={busy || status.status === 'matched'} aria-label="매칭 취소"><X /></button>
        <div className="radar" aria-hidden="true"><i /><i /><i /><span><Radio /></span></div>
        <p className="eyebrow">QUICK MATCH</p>
        <h1>{status.status === 'matched' ? '모두 모였어요.' : '플레이어를 찾고 있어요.'}</h1>
        <p>{status.status === 'matched' ? '게임으로 이동하고 있어요.' : '새로고침해도 대기 상태가 유지됩니다.'}</p>
        <div className="match-slots">
          {Array.from({ length: selectedCount }, (_, index) => {
            const member = status.members[index]
            const isFound = status.status === 'matched' ? Boolean(member) : index < found
            return <div className={isFound ? 'match-slot is-found' : 'match-slot'} key={index}>
              {isFound ? (index === 0 ? <UserRound /> : <Check />) : <LoaderCircle />}
              <span>{member?.nickname ?? (index === 0 ? '나' : isFound ? `대기 중인 플레이어 ${index + 1}` : '검색 중')}</span>
            </div>
          })}
        </div>
        <strong className="match-count">{found} / {selectedCount}</strong>
        {error && <p className="form-error match-error" role="alert">{error}</p>}
        <button className="secondary-button" onClick={() => void cancel()} disabled={busy || status.status === 'matched'}>{busy ? '취소하는 중...' : '매칭 취소'}</button>
      </div>
    )
  }

  return (
    <div className="content-page narrow-page play-flow-page">
      <PageHeader eyebrow="QUICK MATCH" title="몇 명이서 플레이할까요?" description="원하는 인원을 선택하면 바로 매칭해 드려요." />
      <section className="form-card online-card">
        <div className="count-options">
          {[2, 3, 4, 5, 6].map(value => <button className={count === value ? 'is-selected' : ''} onClick={() => setCount(value)} disabled={loading || busy} key={value}><strong>{value}</strong><span>명</span>{count === value && <Check />}</button>)}
        </div>
        <div className="queue-info"><Radio /><span><strong>{count}인 대기열</strong><small>현재 온라인 {onlineCount}명 · 실제 접속 상태</small></span><i>LIVE</i></div>
        {error && <p className="form-error" role="alert">{error}</p>}
        <button className="primary-button full-button" onClick={() => void start()} disabled={loading || busy}>{loading ? '대기열 확인 중...' : busy ? '참가하는 중...' : '매칭 시작'}</button>
      </section>
    </div>
  )
}
