import { Check, Copy, Crown, LogOut, Minus, Plus, Share2, UserRound, X } from 'lucide-react'
import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import PageHeader from '../components/PageHeader'

function makeRoomCode() {
  const letters = 'ABCDEFGHJKLMNPQRSTUVWXYZ'
  const numbers = '0123456789'
  return Array.from({ length: 3 }, () => letters[Math.floor(Math.random() * letters.length)]).join('')
    + Array.from({ length: 3 }, () => numbers[Math.floor(Math.random() * numbers.length)]).join('')
}

export default function CreateRoom() {
  const navigate = useNavigate()
  const [maxPlayers, setMaxPlayers] = useState(4)
  const [created, setCreated] = useState(false)
  const [copied, setCopied] = useState(false)
  const [players, setPlayers] = useState(['나', '제이미', '민서'])
  const roomCode = useMemo(makeRoomCode, [])

  if (!created) {
    return (
      <div className="content-page narrow-page play-flow-page">
        <PageHeader eyebrow="PRIVATE ROOM" title="새 게임을 준비할게요." description="함께 플레이할 최대 인원을 선택하세요." />
        <section className="form-card player-picker-card">
          <div className="people-visual" aria-hidden="true">
            {Array.from({ length: maxPlayers }, (_, index) => <span key={index}><UserRound /></span>)}
          </div>
          <div className="stepper-label"><span>최대 인원</span><strong>{maxPlayers}명</strong></div>
          <div className="stepper">
            <button onClick={() => setMaxPlayers(value => Math.max(2, value - 1))} disabled={maxPlayers === 2} aria-label="인원 줄이기"><Minus /></button>
            <output>{maxPlayers}</output>
            <button onClick={() => setMaxPlayers(value => Math.min(6, value + 1))} disabled={maxPlayers === 6} aria-label="인원 늘리기"><Plus /></button>
          </div>
          <p className="helper-text">2명부터 6명까지 함께할 수 있어요.</p>
          <button className="primary-button full-button" onClick={() => setCreated(true)}>방 만들기</button>
        </section>
      </div>
    )
  }

  const kick = (name: string) => setPlayers(current => current.filter(player => player !== name))
  const copyCode = async () => {
    await navigator.clipboard?.writeText(roomCode)
    setCopied(true)
    window.setTimeout(() => setCopied(false), 1600)
  }

  return (
    <div className="content-page lobby-page play-flow-page">
      <PageHeader eyebrow="WAITING ROOM" title="친구들을 기다리고 있어요." description="코드를 공유하면 바로 참여할 수 있어요." />
      <div className="lobby-layout">
        <section className="room-code-card">
          <p>초대 코드</p>
          <div className="room-code">{roomCode.slice(0, 3)}<span>{roomCode.slice(3)}</span></div>
          <button className="secondary-button" onClick={copyCode}>{copied ? <Check /> : <Copy />}{copied ? '복사했어요' : '코드 복사'}</button>
          <button className="text-button"><Share2 /> 초대 링크 공유</button>
        </section>
        <section className="member-card">
          <div className="section-title"><div><h2>참가자</h2><p>{players.length} / {maxPlayers}명</p></div><span className="live-dot">대기 중</span></div>
          <ul className="member-list">
            {players.map((player, index) => (
              <li key={player}>
                <span className={`avatar avatar--${index + 1}`}>{player[0]}</span>
                <span><strong>{player}</strong><small>{index === 0 ? '방장' : '준비됨'}</small></span>
                {index === 0 ? <Crown className="host-crown" /> : <button className="kick-button" onClick={() => kick(player)} aria-label={`${player} 강퇴`}><X /></button>}
              </li>
            ))}
            {Array.from({ length: maxPlayers - players.length }, (_, index) => <li className="empty-member" key={index}><span className="avatar"><UserRound /></span><span>기다리는 중...</span></li>)}
          </ul>
          <button className="primary-button full-button" disabled={players.length < 2} onClick={() => navigate('/game')}>게임 시작</button>
          <button className="danger-text-button" onClick={() => setCreated(false)}><LogOut /> 방 닫기</button>
        </section>
      </div>
    </div>
  )
}
