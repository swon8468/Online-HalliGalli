import { ArrowRightLeft, Check, Copy, Crown, LogOut, Minus, Plus, Share2, UserRound, X } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useAuth } from '../auth/AuthContext'
import PageHeader from '../components/PageHeader'
import { useSessionHeartbeat } from '../hooks/useSessionHeartbeat'
import { copyText, shareWasCancelled } from '../lib/clipboard'
import { getErrorMessage } from '../lib/errorMessage'
import { closeWaitingRoom, getMyRoomRemoval, kickRoomMember, leaveRoom, loadRoom, loadRoomGame, loadRoomMembers, setRoomReady, startRoomGame, subscribeToRoom, transferRoomHost, updateRoomCapacity, type RoomInfo, type RoomMemberInfo } from '../lib/rooms'

function roomErrorMessage(cause: unknown) {
  const raw = getErrorMessage(cause)
  const messages: Record<string, string> = {
    host_only: '방장만 이 작업을 할 수 있어요.', players_not_ready: '모든 참가자가 준비해야 게임을 시작할 수 있어요.',
    room_not_waiting: '이미 시작되었거나 닫힌 방이에요.', capacity_below_members: '현재 참가자 수보다 최대 인원을 줄일 수 없어요.',
    room_full: '방이 가득 찼어요.', member_not_found: '참가자를 찾지 못했어요.', invalid_kick_reason: '강퇴 사유를 2자 이상 입력해 주세요.',
  }
  const key = Object.keys(messages).find(value => raw.includes(value))
  if (key) return messages[key]
  if (raw.includes('at least two')) return '게임을 시작하려면 두 명 이상 필요해요.'
  return raw || '대기방 상태를 처리하지 못했어요.'
}

export default function RoomLobby() {
  const { roomId } = useParams()
  const { user } = useAuth()
  const navigate = useNavigate()
  const [room, setRoom] = useState<RoomInfo | null>(null)
  const [players, setPlayers] = useState<RoomMemberInfo[]>([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [copied, setCopied] = useState(false)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const [confirmAction, setConfirmAction] = useState<'leave' | 'close' | null>(null)
  const [kickTarget, setKickTarget] = useState<RoomMemberInfo | null>(null)
  const [kickReason, setKickReason] = useState('')

  const refresh = useCallback(async () => {
    if (!roomId) return
    try {
      const [nextRoom, nextPlayers] = await Promise.all([loadRoom(roomId), loadRoomMembers(roomId)])
      if (user && !nextPlayers.some(player => player.userId === user.id)) {
        const removal = await getMyRoomRemoval(roomId).catch(() => ({ kicked: false, reason: undefined, left: false }))
        const query = new URLSearchParams({ reason: removal.kicked ? 'kicked' : 'removed' })
        if (removal.reason) query.set('detail', removal.reason)
        navigate(`/join?${query}`, { replace: true }); return
      }
      if (nextRoom.status === 'playing') {
        const gameId = await loadRoomGame(roomId)
        if (gameId) { navigate(`/game?game=${encodeURIComponent(gameId)}`, { replace: true }); return }
      }
      if (nextRoom.status === 'closed') { navigate('/join?reason=closed', { replace: true }); return }
      setRoom(nextRoom); setPlayers(nextPlayers); setError('')
    } catch (cause) { setError(roomErrorMessage(cause)) }
    finally { setLoading(false) }
  }, [navigate, roomId, user])

  const connection = useSessionHeartbeat('room', roomId, () => void refresh())
  useEffect(() => {
    void refresh()
    if (!roomId) return
    const unsubscribe = subscribeToRoom(roomId, () => void refresh())
    // Postgres Changes can be delayed or dropped while a mobile browser resumes
    // its websocket. Reconcile a small waiting-room snapshot as a bounded fallback.
    const reconcile = window.setInterval(() => {
      if (document.visibilityState === 'visible') void refresh()
    }, 2_000)
    return () => { unsubscribe(); window.clearInterval(reconcile) }
  }, [refresh, roomId])

  const run = async (action: () => Promise<unknown>, success?: string) => {
    setBusy(true); setError(''); setMessage('')
    try { await action(); if (success) setMessage(success); await refresh() }
    catch (cause) { setError(roomErrorMessage(cause)) }
    finally { setBusy(false) }
  }
  const copyCode = async () => {
    if (!room) return
    setError(''); setMessage('')
    if (!await copyText(room.code)) { setCopied(false); setError('초대 코드를 복사하지 못했어요. 화면의 코드를 직접 입력해 주세요.'); return }
    setCopied(true); setMessage('초대 코드를 복사했어요.'); window.setTimeout(() => setCopied(false), 1600)
  }
  const shareRoom = async () => {
    if (!room) return
    const url = `${window.location.origin}/join?code=${room.code}`
    setError(''); setMessage('')
    try {
      if (!navigator.share) throw new Error('share unavailable')
      await navigator.share({ title: 'Halli Galli 초대', text: `방 코드 ${room.code}`, url })
      setMessage('초대 링크를 공유했어요.')
    } catch (cause) {
      if (shareWasCancelled(cause)) { setMessage('공유를 취소했어요.'); return }
      if (!await copyText(url)) { setCopied(false); setError('초대 링크를 복사하지 못했어요. 주소창의 링크를 직접 공유해 주세요.'); return }
      setCopied(true); setMessage('초대 링크를 복사했어요.'); window.setTimeout(() => setCopied(false), 1600)
    }
  }
  const confirmKick = () => { if (room && kickTarget) void run(async () => { await kickRoomMember(room.id, kickTarget.userId, kickReason); setKickTarget(null); setKickReason('') }, `${kickTarget.nickname}님을 강퇴했어요.`) }
  const start = () => room && void run(async () => navigate(`/game?game=${encodeURIComponent(await startRoomGame(room.id))}`))
  const leave = () => room && void run(async () => { await leaveRoom(room.id); navigate('/', { replace: true }) })
  const close = () => room && void run(async () => { await closeWaitingRoom(room.id); navigate('/', { replace: true }) })

  if (loading) return <div className="content-page narrow-page play-flow-page"><section className="form-card admin-empty" aria-live="polite"><strong>대기방을 불러오는 중...</strong></section></div>
  if (!room) return <div className="content-page narrow-page play-flow-page"><section className="form-card admin-empty"><strong>대기방을 찾지 못했어요.</strong><p>{error}</p><button className="secondary-button" onClick={() => navigate('/')}>홈으로 돌아가기</button></section></div>

  const isHost = room.hostId === user?.id
  const me = players.find(player => player.userId === user?.id)
  const allReady = players.filter(player => player.role !== 'host').every(player => player.ready)
  return <div className="content-page lobby-page play-flow-page"><PageHeader eyebrow="WAITING ROOM" title="다음 게임을 준비해요." description="준비가 끝나면 방장이 게임을 시작할 수 있어요." />
    {(!connection.online || !connection.serverConnected) && <div className="connection-banner" role="status">연결이 끊겼어요. 복구되면 자동으로 다시 연결합니다.</div>}
    {(message || error) && <p className={`friends-notice ${error ? 'is-error' : ''}`} role={error ? 'alert' : 'status'}>{error || message}</p>}
    <div className="lobby-layout"><section className="room-code-card"><p>초대 코드</p><div className="room-code">{room.code.slice(0, 3)}<span>{room.code.slice(3)}</span></div><button className="secondary-button" onClick={() => void copyCode()}>{copied ? <Check /> : <Copy />}{copied ? '복사했어요' : '코드 복사'}</button><button className="text-button" onClick={() => void shareRoom()}><Share2 /> 초대 링크 공유</button>
      {isHost && <div className="lobby-capacity"><span>최대 인원</span><button aria-label="최대 인원 줄이기" disabled={busy || room.maxPlayers <= Math.max(2, players.length)} onClick={() => void run(() => updateRoomCapacity(room.id, room.maxPlayers - 1))}><Minus /></button><strong>{room.maxPlayers}명</strong><button aria-label="최대 인원 늘리기" disabled={busy || room.maxPlayers >= 6} onClick={() => void run(() => updateRoomCapacity(room.id, room.maxPlayers + 1))}><Plus /></button></div>}
    </section><section className="member-card"><div className="section-title"><div><h2>참가자</h2><p>{players.length} / {room.maxPlayers}명</p></div><span className="live-dot">대기 중</span></div><ul className="member-list">{players.map((player, index) => <li className={!player.connected ? 'is-disconnected' : ''} key={player.userId}><span className={`avatar avatar--${index + 1}`}>{player.nickname[0]}</span><span><strong>{player.nickname}{player.userId === user?.id ? ' · 나' : ''}</strong><small>{!player.connected ? '연결 끊김' : player.role === 'host' ? '방장 · 항상 준비' : player.ready ? '준비 완료' : '준비 중'}</small></span>{player.role === 'host' ? <Crown className="host-crown" /> : isHost ? <div className="lobby-member-actions"><button aria-label={`${player.nickname}에게 방장 위임`} title="방장 위임" onClick={() => void run(() => transferRoomHost(room.id, player.userId), `${player.nickname}님에게 방장을 위임했어요.`)}><ArrowRightLeft /></button><button aria-label={`${player.nickname} 강퇴`} title="강퇴" onClick={() => { setKickTarget(player); setKickReason('') }}><X /></button></div> : <span className={`ready-badge ${player.ready ? 'is-ready' : ''}`}>{player.ready ? 'READY' : 'WAIT'}</span>}</li>)}{Array.from({ length: Math.max(0, room.maxPlayers - players.length) }, (_, index) => <li className="empty-member" key={index}><span className="avatar"><UserRound /></span><span>기다리는 중...</span></li>)}</ul>
      {!isHost && me && <button className={`secondary-button full-button ready-toggle ${me.ready ? 'is-ready' : ''}`} disabled={busy} onClick={() => void run(() => setRoomReady(room.id, !me.ready), me.ready ? '준비를 취소했어요.' : '준비됐어요!')}>{me.ready ? <><Check /> 준비 완료 · 취소하기</> : '준비하기'}</button>}
      {isHost && <button className="primary-button full-button" disabled={players.length < 2 || !allReady || busy} onClick={start}>{busy ? '처리 중...' : !allReady ? '참가자 준비 대기 중' : '게임 시작'}</button>}
      <button className="danger-text-button full-button" onClick={() => setConfirmAction('leave')} disabled={busy}><LogOut /> {isHost ? '방 나가기 · 자동 위임' : '방 나가기'}</button>{isHost && <button className="danger-text-button full-button" onClick={() => setConfirmAction('close')} disabled={busy}><X /> 방 닫기</button>}
    </section></div>
    {confirmAction && <div className="action-confirm" role="dialog" aria-modal="true" aria-labelledby="room-confirm-title"><div><h2 id="room-confirm-title">{confirmAction === 'close' ? '방을 닫을까요?' : '방에서 나갈까요?'}</h2><p>{confirmAction === 'close' ? '모든 참가자가 퇴장하고 초대가 취소됩니다.' : isHost ? '다음 참가자에게 방장이 자동 위임됩니다.' : '대기방에서 나갑니다.'}</p><button className="danger-button" onClick={confirmAction === 'close' ? close : leave}>{confirmAction === 'close' ? '방 닫기' : '나가기'}</button><button className="secondary-button" onClick={() => setConfirmAction(null)}>취소</button></div></div>}
    {kickTarget && <div className="action-confirm" role="dialog" aria-modal="true" aria-labelledby="kick-title"><div><h2 id="kick-title">{kickTarget.nickname}님을 강퇴할까요?</h2><label><span>강퇴 사유</span><input value={kickReason} onChange={event => setKickReason(event.target.value.slice(0, 120))} placeholder="참가자에게 표시됩니다" autoFocus /></label><button className="danger-button" disabled={kickReason.trim().length < 2 || busy} onClick={confirmKick}>강퇴하기</button><button className="secondary-button" onClick={() => setKickTarget(null)}>취소</button></div></div>}
  </div>
}
