import { Bell, LogIn, LogOut, UsersRound } from 'lucide-react'
import { Link, NavLink, Outlet, useLocation } from 'react-router-dom'
import { useAuth } from '../auth/AuthContext'
import { isDevelopment } from '../lib/environment'

export default function Layout() {
  const location = useLocation()
  const { user, signOut } = useAuth()
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
            <NavLink to="/friends"><UsersRound size={17} /><span>친구</span></NavLink>
            {user ? <button className="profile-button" onClick={() => void signOut()} aria-label={`${user.label} 로그아웃`} title={`${user.label} · 로그아웃`}><LogOut size={17} /></button> : <Link to="/auth" className="profile-button" aria-label="로그인"><LogIn size={17} /></Link>}
          </nav>
        </header>
      )}
      <main className={isGame ? 'main main--game' : 'main'}>
        <Outlet />
      </main>
    </div>
  )
}
