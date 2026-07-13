import { BellRing, Check, Clock3, LoaderCircle, X } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../auth/AuthContext'
import { cancelGameInvite, getGameInvites, inviteErrorMessage, respondGameInvite, subscribeToGameInvites, type GameInvitesOverview } from '../lib/invites'

const EMPTY: GameInvitesOverview = { received: [], sent: [] }

function remaining(expiresAt: string) {
  const minutes = Math.max(0, Math.ceil((new Date(expiresAt).getTime() - Date.now()) / 60_000))
  return minutes > 0 ? `${minutes}분 남음` : '만료됨'
}

export default function InviteCenter() {
  const { user } = useAuth()
  const navigate = useNavigate()
  const [open, setOpen] = useState(false)
  const [invites, setInvites] = useState<GameInvitesOverview>(EMPTY)
  const [loading, setLoading] = useState(false)
  const [busyId, setBusyId] = useState('')
  const [error, setError] = useState('')
  const userId = user?.id ?? null
  const activeUserIdRef = useRef(userId)
  const refreshPromiseRef = useRef<{ userId: string; promise: Promise<GameInvitesOverview> } | null>(null)
  activeUserIdRef.current = userId

  const requestInvites = useCallback((requestedUserId: string) => {
    if (refreshPromiseRef.current?.userId === requestedUserId) return refreshPromiseRef.current.promise
    const promise = getGameInvites().finally(() => {
      if (refreshPromiseRef.current?.promise === promise) refreshPromiseRef.current = null
    })
    refreshPromiseRef.current = { userId: requestedUserId, promise }
    return promise
  }, [])

  const refresh = useCallback(async (ensureFresh = false) => {
    if (!userId) return
    if (ensureFresh && refreshPromiseRef.current?.userId === userId) await refreshPromiseRef.current.promise.catch(() => undefined)
    setLoading(true)
    try {
      const nextInvites = await requestInvites(userId)
      if (activeUserIdRef.current !== userId) return
      setInvites(nextInvites); setError('')
    } catch (cause) {
      if (activeUserIdRef.current === userId) setError(inviteErrorMessage(cause))
    } finally {
      if (activeUserIdRef.current === userId) setLoading(false)
    }
  }, [requestInvites, userId])

  useEffect(() => {
    if (!userId) {
      setInvites(EMPTY); setOpen(false); setLoading(false); setBusyId(''); setError('')
      return
    }
    setInvites(EMPTY); setOpen(false); setError('')
    void refresh()
    const unsubscribe = subscribeToGameInvites(userId, () => void refresh())
    const timer = window.setInterval(() => void refresh(), 30_000)
    return () => { unsubscribe(); window.clearInterval(timer) }
  }, [refresh, userId])

  const respond = async (inviteId: string, accept: boolean) => {
    const actorUserId = userId
    if (!actorUserId) return
    setBusyId(inviteId); setError('')
    try {
      const result = await respondGameInvite(inviteId, accept)
      await refresh(true)
      if (activeUserIdRef.current !== actorUserId) return
      if (accept && result.roomId) { setOpen(false); navigate(`/room/${encodeURIComponent(result.roomId)}`) }
    } catch (cause) {
      const actionError = inviteErrorMessage(cause)
      await refresh(true)
      if (activeUserIdRef.current === actorUserId) setError(actionError)
    }
    finally { if (activeUserIdRef.current === actorUserId) setBusyId('') }
  }

  const cancel = async (inviteId: string) => {
    const actorUserId = userId
    if (!actorUserId) return
    setBusyId(inviteId); setError('')
    try { await cancelGameInvite(inviteId); await refresh(true) }
    catch (cause) { if (activeUserIdRef.current === actorUserId) setError(inviteErrorMessage(cause)) }
    finally { if (activeUserIdRef.current === actorUserId) setBusyId('') }
  }

  if (!user) return null
  const count = invites.received.length
  return (
    <div className="invite-center">
      <button className="profile-button invite-center-button" aria-label={`게임 초대 ${count}개`} aria-expanded={open} onClick={() => setOpen(value => !value)}>
        <BellRing size={17} />{count > 0 && <span>{count}</span>}
      </button>
      {open && <section className="invite-popover" aria-label="게임 초대함">
        <header><div><strong>게임 초대</strong><small>친구의 방으로 바로 참여하세요.</small></div><button aria-label="초대함 닫기" onClick={() => setOpen(false)}><X /></button></header>
        {error && <p className="invite-error" role="alert">{error}</p>}
        {loading && invites.received.length === 0 ? <div className="invite-empty" role="status"><LoaderCircle className="is-spinning" /> 불러오는 중...</div> : invites.received.length > 0 ? invites.received.map(invite => (
          <article className="invite-item" key={invite.id}>
            <span className="avatar">{invite.nickname.slice(0, 1)}</span>
            <span><strong>{invite.nickname}</strong><small>{invite.roomCode} · {remaining(invite.expiresAt)}</small></span>
            <div><button aria-label={`${invite.nickname} 초대 수락`} onClick={() => void respond(invite.id, true)} disabled={Boolean(busyId)}>{busyId === invite.id ? <LoaderCircle className="is-spinning" /> : <Check />}</button><button aria-label={`${invite.nickname} 초대 거절`} onClick={() => void respond(invite.id, false)} disabled={Boolean(busyId)}><X /></button></div>
          </article>
        )) : <div className="invite-empty"><BellRing /><strong>받은 초대가 없어요.</strong></div>}
        {invites.sent.length > 0 && <><h3><Clock3 /> 보낸 초대</h3>{invites.sent.map(invite => <article className="invite-item invite-item--sent" key={invite.id}><span className="avatar">{invite.nickname.slice(0, 1)}</span><span><strong>{invite.nickname}</strong><small>{invite.roomCode} · {remaining(invite.expiresAt)}</small></span><button className="text-button" onClick={() => void cancel(invite.id)} disabled={Boolean(busyId)}>취소</button></article>)}</>}
      </section>}
    </div>
  )
}
