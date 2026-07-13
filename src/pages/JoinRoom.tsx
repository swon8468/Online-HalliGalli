import { ArrowRight, Crown, Hash, LockKeyhole, LogOut, UserRound } from 'lucide-react'
import { FormEvent, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import PageHeader from '../components/PageHeader'

export default function JoinRoom() {
  const navigate = useNavigate()
  const [code, setCode] = useState('')
  const [nickname, setNickname] = useState('')
  const [error, setError] = useState('')
  const [joined, setJoined] = useState(false)

  const submit = (event: FormEvent) => {
    event.preventDefault()
    if (!/^[A-Z]{3}[0-9]{3}$/.test(code)) {
      setError('영문 대문자 3개와 숫자 3개를 입력해 주세요.')
      return
    }
    if (nickname.trim().length < 2) {
      setError('닉네임은 2자 이상 입력해 주세요.')
      return
    }
    setJoined(true)
  }

  if (joined) {
    return (
      <div className="content-page narrow-page play-flow-page">
        <PageHeader eyebrow="WAITING ROOM" title="게임이 곧 시작돼요." description="방장이 게임을 시작할 때까지 잠시 기다려 주세요." />
        <section className="member-card joined-lobby">
          <div className="joined-room-code"><span>방 코드</span><strong>{code.slice(0, 3)}<em>{code.slice(3)}</em></strong></div>
          <div className="section-title"><div><h2>참가자</h2><p>3 / 4명</p></div><span className="live-dot">대기 중</span></div>
          <ul className="member-list">
            <li><span className="avatar avatar--1">제</span><span><strong>제이미</strong><small>방장</small></span><Crown className="host-crown" /></li>
            <li><span className="avatar avatar--2">민</span><span><strong>민서</strong><small>준비됨</small></span></li>
            <li><span className="avatar avatar--3">{nickname[0]}</span><span><strong>{nickname}</strong><small>나 · 준비됨</small></span></li>
            <li className="empty-member"><span className="avatar"><UserRound /></span><span>기다리는 중...</span></li>
          </ul>
          <button className="secondary-button full-button" onClick={() => navigate('/game')}>데모 게임 미리보기 <ArrowRight /></button>
          <button className="danger-text-button full-button" onClick={() => setJoined(false)}><LogOut /> 방 나가기</button>
        </section>
      </div>
    )
  }

  return (
    <div className="content-page narrow-page play-flow-page">
      <PageHeader eyebrow="JOIN ROOM" title="초대받은 방으로 들어가세요." description="친구에게 받은 6자리 코드가 필요해요." />
      <form className="form-card join-form" onSubmit={submit}>
        <label><span><Hash /> 방 코드</span>
          <input className="code-input" value={code} onChange={event => { setCode(event.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6)); setError('') }} placeholder="ABC123" autoComplete="off" />
        </label>
        <label><span><UserRound /> 닉네임</span>
          <input value={nickname} onChange={event => { setNickname(event.target.value.slice(0, 12)); setError('') }} placeholder="게임에서 사용할 이름" autoComplete="nickname" />
          <small>{nickname.length} / 12</small>
        </label>
        {error && <p className="form-error" role="alert">{error}</p>}
        <button className="primary-button full-button" type="submit">방 참여하기 <ArrowRight /></button>
        <p className="privacy-note"><LockKeyhole /> 닉네임은 이번 게임에만 표시돼요.</p>
      </form>
    </div>
  )
}
