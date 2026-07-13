import { Bot, Check, Gauge, GraduationCap, Zap } from 'lucide-react'
import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import PageHeader from '../components/PageHeader'

const levels = [
  { id: 'easy', title: '천천히', copy: '종을 누르기까지 2.4초', icon: GraduationCap },
  { id: 'normal', title: '보통', copy: '종을 누르기까지 1.4초', icon: Gauge },
  { id: 'hard', title: '빠르게', copy: '종을 누르기까지 0.7초', icon: Zap },
] as const

export default function Practice() {
  const navigate = useNavigate()
  const [level, setLevel] = useState<(typeof levels)[number]['id']>('normal')
  return (
    <div className="content-page narrow-page practice-page play-flow-page">
      <PageHeader eyebrow="BOT PRACTICE" title="봇과 먼저 연습해 보세요." description="규칙과 종 타이밍을 부담 없이 익힐 수 있어요." />
      <section className="form-card practice-card">
        <div className="bot-portrait"><Bot /><span>연습 봇</span><i>준비됨</i></div>
        <div className="level-options">
          {levels.map(({ id, title, copy, icon: Icon }) => <button className={level === id ? 'is-selected' : ''} onClick={() => setLevel(id)} key={id}><Icon /><span><strong>{title}</strong><small>{copy}</small></span>{level === id && <Check />}</button>)}
        </div>
        <button className="primary-button full-button" onClick={() => navigate(`/game?mode=bot&difficulty=${level}`)}><Bot /> 연습 시작</button>
      </section>
    </div>
  )
}
