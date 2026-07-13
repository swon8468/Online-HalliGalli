import { Check, Copy, Crown, LogOut, Minus, Plus, Share2, UserRound, X } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../auth/AuthContext'
import PageHeader from '../components/PageHeader'
import { createPrivateRoom, kickRoomMember, leaveRoom, loadRoomMembers, startRoomGame, subscribeToRoom, type RoomInfo, type RoomMemberInfo } from '../lib/rooms'

export default function CreateRoom() {
  const navigate = useNavigate()
  const { user } = useAuth()
  const [maxPlayers, setMaxPlayers] = useState(4)
  const [room, setRoom] = useState<RoomInfo | null>(null)
  const [copied, setCopied] = useState(false)
  const [players, setPlayers] = useState<RoomMemberInfo[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const refreshMembers = useCallback(async (roomId?: string) => {
    if (!roomId) return
    try { setPlayers(await loadRoomMembers(roomId)) }
    catch (caught) { setError(caught instanceof Error ? caught.message : '참가자 목록을 불러오지 못했습니다.') }
  }, [])

  useEffect(() => {
    if (!room) return
    void refreshMembers(room.id)
    return subscribeToRoom(room.id, () => void refreshMembers(room.id))
  }, [room, refreshMembers])

  const create = async () => {
    setBusy(true); setError('')
    try {
      const createdRoom = await createPrivateRoom(maxPlayers)
      setRoom(createdRoom)
      await refreshMembers(createdRoom.id)
    } catch (caught) { setError(caught instanceof Error ? caught.message : '방을 생성하지 못했습니다.') }
    finally { setBusy(false) }
  }

  if (!room) {
    return <div className="content-page narrow-page play-flow-page"><PageHeader eyebrow="PRIVATE ROOM" title="새 게임을 준비할게요." description="함께 플레이할 최대 인원을 선택하세요." /><section className="form-card player-picker-card"><div className="people-visual" aria-hidden="true">{Array.from({ length: maxPlayers }, (_, index) => <span key={index}><UserRound /></span>)}</div><div className="stepper-label"><span>최대 인원</span><strong>{maxPlayers}명</strong></div><div className="stepper"><button onClick={() => setMaxPlayers(value => Math.max(2, value - 1))} disabled={maxPlayers === 2} aria-label="인원 줄이기"><Minus /></button><output>{maxPlayers}</output><button onClick={() => setMaxPlayers(value => Math.min(6, value + 1))} disabled={maxPlayers === 6} aria-label="인원 늘리기"><Plus /></button></div><p className="helper-text">2명부터 6명까지 함께할 수 있어요.</p>{error && <p className="form-error" role="alert">{error}</p>}<button className="primary-button full-button" onClick={() => void create()} disabled={busy}>{busy ? '방 만드는 중...' : '방 만들기'}</button></section></div>
  }

  const copyCode = async () => { await navigator.clipboard?.writeText(room.code); setCopied(true); window.setTimeout(() => setCopied(false), 1600) }
  const kick = async (member: RoomMemberInfo) => { try { await kickRoomMember(room.id, member.userId); await refreshMembers(room.id) } catch (caught) { setError(caught instanceof Error ? caught.message : '강퇴하지 못했습니다.') } }
  const start = async () => { setBusy(true); try { const gameId = await startRoomGame(room.id); navigate(`/game?game=${gameId}`) } catch (caught) { setError(caught instanceof Error ? caught.message : '게임을 시작하지 못했습니다.') } finally { setBusy(false) } }
  const close = async () => { await leaveRoom(room.id); setRoom(null); setPlayers([]) }

  return <div className="content-page lobby-page play-flow-page"><PageHeader eyebrow="WAITING ROOM" title="친구들을 기다리고 있어요." description="코드를 공유하면 바로 참여할 수 있어요." /><div className="lobby-layout"><section className="room-code-card"><p>초대 코드</p><div className="room-code">{room.code.slice(0, 3)}<span>{room.code.slice(3)}</span></div><button className="secondary-button" onClick={copyCode}>{copied ? <Check /> : <Copy />}{copied ? '복사했어요' : '코드 복사'}</button><button className="text-button" onClick={() => void navigator.share?.({ title: 'Halli Galli 초대', text: `방 코드 ${room.code}` })}><Share2 /> 초대 링크 공유</button></section><section className="member-card"><div className="section-title"><div><h2>참가자</h2><p>{players.length} / {room.maxPlayers}명</p></div><span className="live-dot">대기 중</span></div><ul className="member-list">{players.map((player, index) => <li key={player.userId}><span className={`avatar avatar--${index + 1}`}>{player.nickname[0]}</span><span><strong>{player.nickname}</strong><small>{player.role === 'host' ? '방장' : '준비됨'}{player.userId === user?.id ? ' · 나' : ''}</small></span>{player.role === 'host' ? <Crown className="host-crown" /> : <button className="kick-button" onClick={() => void kick(player)} aria-label={`${player.nickname} 강퇴`}><X /></button>}</li>)}{Array.from({ length: Math.max(0, room.maxPlayers - players.length) }, (_, index) => <li className="empty-member" key={index}><span className="avatar"><UserRound /></span><span>기다리는 중...</span></li>)}</ul>{error && <p className="form-error" role="alert">{error}</p>}<button className="primary-button full-button" disabled={players.length < 2 || busy} onClick={() => void start()}>{busy ? '시작하는 중...' : '게임 시작'}</button><button className="danger-text-button" onClick={() => void close()}><LogOut /> 방 닫기</button></section></div></div>
}
