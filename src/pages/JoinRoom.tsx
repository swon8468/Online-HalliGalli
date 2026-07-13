import { ArrowRight, Crown, Hash, LockKeyhole, LogOut, UserRound } from 'lucide-react'
import { FormEvent, useCallback, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import PageHeader from '../components/PageHeader'
import { joinPrivateRoom, leaveRoom, loadRoomGame, loadRoomMembers, subscribeToRoom, type RoomInfo, type RoomMemberInfo } from '../lib/rooms'

export default function JoinRoom() {
  const navigate = useNavigate()
  const [code, setCode] = useState('')
  const [error, setError] = useState('')
  const [room, setRoom] = useState<RoomInfo | null>(null)
  const [players, setPlayers] = useState<RoomMemberInfo[]>([])
  const [busy, setBusy] = useState(false)

  const refreshMembers = useCallback(async (roomId?: string) => { if (roomId) setPlayers(await loadRoomMembers(roomId)) }, [])
  const syncRoom = useCallback(async (roomId: string) => {
    await refreshMembers(roomId)
    const gameId = await loadRoomGame(roomId)
    if (gameId) navigate(`/game?game=${gameId}`)
  }, [navigate, refreshMembers])
  useEffect(() => { if (!room) return; void syncRoom(room.id); return subscribeToRoom(room.id, () => void syncRoom(room.id)) }, [room, syncRoom])

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (!/^[A-Z]{3}[0-9]{3}$/.test(code)) return setError('영문 대문자 3개와 숫자 3개를 입력해 주세요.')
    setBusy(true); setError('')
    try { const joinedRoom = await joinPrivateRoom(code); setRoom(joinedRoom); await refreshMembers(joinedRoom.id) }
    catch (caught) { setError(caught instanceof Error ? caught.message : '방에 참여하지 못했습니다.') }
    finally { setBusy(false) }
  }

  if (room) return <div className="content-page narrow-page play-flow-page"><PageHeader eyebrow="WAITING ROOM" title="게임이 곧 시작돼요." description="방장이 게임을 시작할 때까지 잠시 기다려 주세요." /><section className="member-card joined-lobby"><div className="joined-room-code"><span>방 코드</span><strong>{room.code.slice(0, 3)}<em>{room.code.slice(3)}</em></strong></div><div className="section-title"><div><h2>참가자</h2><p>{players.length} / {room.maxPlayers}명</p></div><span className="live-dot">대기 중</span></div><ul className="member-list">{players.map((player, index) => <li key={player.userId}><span className={`avatar avatar--${index + 1}`}>{player.nickname[0]}</span><span><strong>{player.nickname}</strong><small>{player.role === 'host' ? '방장' : '준비됨'}</small></span>{player.role === 'host' && <Crown className="host-crown" />}</li>)}{Array.from({ length: Math.max(0, room.maxPlayers - players.length) }, (_, index) => <li className="empty-member" key={index}><span className="avatar"><UserRound /></span><span>기다리는 중...</span></li>)}</ul><button className="danger-text-button full-button" onClick={() => void leaveRoom(room.id).then(() => { setRoom(null); setPlayers([]) })}><LogOut /> 방 나가기</button></section></div>

  return <div className="content-page narrow-page play-flow-page"><PageHeader eyebrow="JOIN ROOM" title="초대받은 방으로 들어가세요." description="친구에게 받은 6자리 코드가 필요해요." /><form className="form-card join-form" onSubmit={submit}><label><span><Hash /> 방 코드</span><input className="code-input" value={code} onChange={event => { setCode(event.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6)); setError('') }} placeholder="ABC123" autoComplete="off" /></label>{error && <p className="form-error" role="alert">{error}</p>}<button className="primary-button full-button" type="submit" disabled={busy}>{busy ? '참여하는 중...' : <>방 참여하기 <ArrowRight /></>}</button><p className="privacy-note"><LockKeyhole /> 계정 닉네임으로 참여해요.</p></form></div>
}
