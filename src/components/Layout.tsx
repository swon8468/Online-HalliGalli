import { Bell, Building2, LogIn, UsersRound } from 'lucide-react'
import { Link, NavLink, Outlet, useLocation } from 'react-router-dom'
import { useAuth } from '../auth/AuthContext'
import { isDevelopment } from '../lib/environment'
import InviteCenter from './InviteCenter'
import PwaCenter from './PwaCenter'
import DialogFocusManager from './DialogFocusManager'

export default function Layout() {
  const location = useLocation()
  const { user } = useAuth()
  const isGame = location.pathname === '/game'

  return (
    <div className={isGame ? 'app app--game' : 'app'}>
      {!isGame && (
        <header className="topbar">
          <Link to="/" className="brand" aria-label="홈으로 이동">
            <span className="brand-mark"><Bell size={17} strokeWidth={2.5} /></span>
            <span>Halli Galli</span>
            {isDevelopment && <i className="environment-badge">DEV</i>}
          </Link>
          <nav className="topnav" aria-label="주요 메뉴">
            <NavLink to="/rules">게임 룰</NavLink>
            <NavLink to="/friends" aria-label="친구"><UsersRound size={17} /><span>친구</span></NavLink>
            {user && <NavLink to="/spaces" aria-label="스페이스"><Building2 size={17} /><span>스페이스</span></NavLink>}
            <InviteCenter />
            {user ? <Link to="/account" className="profile-button" aria-label={`${user.label} 계정 관리`} title={`${user.label} · 계정 관리`}><UsersRound size={17} /></Link> : <Link to="/auth" className="profile-button" aria-label="로그인"><LogIn size={17} /></Link>}
          </nav>
        </header>
      )}
      <main className={isGame ? 'main main--game' : 'main'}>
        <Outlet />
      </main>
      <PwaCenter />
      <DialogFocusManager />
    </div>
  )
}
