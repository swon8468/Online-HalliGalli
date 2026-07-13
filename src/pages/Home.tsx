import { ArrowRight, BookOpen, Bot, Building2, DoorOpen, Radio, Sparkles } from 'lucide-react'
import { useEffect } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useAuth } from '../auth/AuthContext'
import { Fruit } from '../components/Fruit'
import { findMyActiveSession } from '../lib/rooms'

const menuItems = [
  { to: '/create', icon: Sparkles, title: '방 만들기', copy: '친구들을 초대하고 바로 시작하세요.', tone: 'blue' },
  { to: '/join', icon: DoorOpen, title: '방 참여하기', copy: '6자리 초대 코드로 입장하세요.', tone: 'dark' },
  { to: '/online', icon: Radio, title: '온라인', copy: '새로운 플레이어와 빠르게 매칭하세요.', tone: 'light' },
  { to: '/rules', icon: BookOpen, title: '게임 룰', copy: '종을 울리는 완벽한 순간을 알아보세요.', tone: 'light' },
  { to: '/practice', icon: Bot, title: '봇 연습', copy: '혼자서 규칙과 타이밍을 연습하세요.', tone: 'light' },
  { to: '/spaces', icon: Building2, title: '스페이스', copy: '단체·행사 전용 공간을 관리하세요.', tone: 'light' },
] as const

export default function Home() {
  const { user } = useAuth()
  const navigate = useNavigate()
  useEffect(() => {
    if (!user) return
    let active = true
    void findMyActiveSession().then(session => {
      if (!active || !session) return
      navigate(session.type === 'game' ? `/game?game=${encodeURIComponent(session.gameId)}` : `/room/${encodeURIComponent(session.roomId)}`, { replace: true })
    }).catch(() => undefined)
    return () => { active = false }
  }, [navigate, user])

  return (
    <div className="home-page">
      <section className="hero">
        <div className="hero-copy">
          <div className="presence"><span /> 실시간 온라인</div>
          <h1>다섯이 되는 순간,<br /><em>종을 울리세요.</em></h1>
          <p>친구와 함께, 어디서든. 가장 빠른 손이 승리합니다.</p>
        </div>
        <div className="hero-art" aria-hidden="true">
          <div className="hero-card hero-card--one"><Fruit kind="strawberry" count={3} size="large" /></div>
          <div className="hero-card hero-card--two"><Fruit kind="lime" count={2} size="large" /></div>
          <div className="hero-bell">
            <span className="bell-knob" />
            <span className="bell-dome" />
            <span className="bell-base" />
          </div>
        </div>
      </section>

      <section className="action-grid" aria-label="게임 메뉴">
        {menuItems.map(({ to, icon: Icon, title, copy, tone }) => (
          <Link to={to} className={`action-card action-card--${tone}`} key={to}>
            <div className="action-icon"><Icon size={23} /></div>
            <div>
              <h2>{title}</h2>
              <p>{copy}</p>
            </div>
            <ArrowRight className="action-arrow" size={22} />
          </Link>
        ))}
      </section>

    </div>
  )
}
