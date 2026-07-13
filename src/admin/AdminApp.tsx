import { FormEvent, useState } from 'react'
import { LockKeyhole, ShieldCheck } from 'lucide-react'
import { useAuth } from '../auth/AuthContext'
import AdminDashboard from './AdminDashboard'

export default function AdminApp() {
  const { user } = useAuth()
  if (!user) return <AdminLogin />
  if (!['admin', 'super_admin'].includes(user.role)) return <div className="admin-access-denied"><ShieldCheck /><h1>관리자 권한이 필요합니다.</h1><p>플랫폼 관리자에게 권한을 요청하세요.</p></div>
  return <AdminDashboard />
}

function AdminLogin() {
  const { signIn } = useAuth()
  const [identifier, setIdentifier] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const submit = async (event: FormEvent) => {
    event.preventDefault()
    try { await signIn(identifier, password) }
    catch (caught) { setError(caught instanceof Error ? caught.message : '로그인할 수 없습니다.') }
  }
  return <div className="admin-login"><form onSubmit={submit}><span><ShieldCheck /></span><p>HALLI ADMIN</p><h1>관리자 로그인</h1><label>이메일 또는 전화번호<input value={identifier} onChange={event => setIdentifier(event.target.value)} required /></label><label>비밀번호<input type="password" value={password} onChange={event => setPassword(event.target.value)} minLength={8} required /></label>{error && <small>{error}</small>}<button><LockKeyhole /> 안전하게 로그인</button></form></div>
}
