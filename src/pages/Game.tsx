import { Bell, ChevronLeft, Clock3, Settings, Volume2, VolumeX } from 'lucide-react'
import { useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { Fruit, type FruitKind } from '../components/Fruit'

const deck: { kind: FruitKind; count: number }[] = [
  { kind: 'strawberry', count: 3 }, { kind: 'lime', count: 2 }, { kind: 'banana', count: 4 },
  { kind: 'plum', count: 1 }, { kind: 'lime', count: 3 }, { kind: 'banana', count: 1 },
]

export default function Game() {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const isBotMode = searchParams.get('mode') === 'bot'
  const difficulty = searchParams.get('difficulty') ?? 'normal'
  const [cardIndex, setCardIndex] = useState(0)
  const [sound, setSound] = useState(true)
  const [message, setMessage] = useState('내 차례예요. 카드를 뒤집으세요.')
  const [score, setScore] = useState(14)
  const card = deck[cardIndex % deck.length]
  const isCorrect = card.kind === 'strawberry' && card.count === 3

  const reveal = () => {
    setCardIndex(index => index + 1)
    setMessage('같은 과일의 합을 확인하세요.')
  }
  const ring = () => {
    if (isCorrect) {
      setMessage('정답이에요. 공개된 카드를 가져왔어요.')
      setScore(value => value + 4)
    } else {
      setMessage('아직 다섯이 아니에요. 카드 한 장을 잃었어요.')
      setScore(value => Math.max(0, value - 1))
    }
  }

  return (
    <div className="game-page">
      <header className="game-topbar">
        <button onClick={() => navigate('/')} aria-label="게임 나가기"><ChevronLeft /></button>
        <div><span>ROUND 1</span><strong><Clock3 /> 00:42</strong></div>
        <div><button onClick={() => setSound(value => !value)} aria-label="소리 켜기 또는 끄기">{sound ? <Volume2 /> : <VolumeX />}</button><button aria-label="게임 설정"><Settings /></button></div>
      </header>

      <div className="opponents">
        {isBotMode ? <div className="opponent is-turn bot-opponent"><span className="avatar avatar--2">BOT<i className="is-online" /></span><strong>연습 봇</strong><small>{difficulty === 'easy' ? '천천히' : difficulty === 'hard' ? '빠르게' : '보통'} · 카드 28장</small></div> : <><div className="opponent"><span className="avatar avatar--1">제<i className="is-online" /></span><strong>제이미</strong><small>카드 18장</small></div><div className="opponent is-turn"><span className="avatar avatar--2">민<i className="is-online" /></span><strong>민서</strong><small>카드 12장</small></div><div className="opponent"><span className="avatar avatar--3">수<i className="is-online" /></span><strong>수현</strong><small>카드 16장</small></div></>}
      </div>

      <section className="game-table">
        <div className="played-card played-card--left"><Fruit kind="strawberry" count={2} size="large" /></div>
        <button className="played-card played-card--center" onClick={reveal} aria-label="카드 뒤집기"><Fruit kind={card.kind} count={card.count} size="large" /><span>카드 뒤집기</span></button>
        <div className="played-card played-card--right"><Fruit kind="banana" count={4} size="large" /></div>
        <div className="deck-stack"><i /><i /><strong>{score}</strong><small>내 카드</small></div>
      </section>

      <div className={`game-message ${message.startsWith('정답') ? 'is-success' : ''}`} aria-live="polite">{message}</div>
      <button className="bell-button" onClick={ring}><span /><Bell /><strong>종 울리기</strong></button>
      <p className="game-hint">같은 과일이 정확히 5개일 때 누르세요.</p>
    </div>
  )
}
