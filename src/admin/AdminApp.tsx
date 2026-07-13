import { FormEvent, useEffect, useState } from 'react'
import { KeyRound, LockKeyhole, ShieldCheck } from 'lucide-react'
import { useAuth } from '../auth/AuthContext'
import { isSupabaseConfigured, supabase } from '../lib/supabase'
import { translateAuthError } from '../lib/authErrors'
import AdminDashboard from './AdminDashboard'

export default function AdminApp() {
  const { user } = useAuth()
  if (!user) return <AdminLogin />
  if (!['support', 'admin', 'super_admin'].includes(user.role)) return <div className="admin-access-denied"><ShieldCheck /><h1>관리자 권한이 필요합니다.</h1><p>플랫폼 관리자에게 권한을 요청하세요.</p></div>
  return <AdminDashboard />
}

function AdminLogin() {
  const { signIn } = useAuth()
  const [identifier, setIdentifier] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [bootstrapAvailable, setBootstrapAvailable] = useState(false)
  const [bootstrapMode, setBootstrapMode] = useState(false)

  useEffect(() => {
    if (!supabase) return
    void supabase.functions.invoke('bootstrap-super-admin', { body: { action: 'status' } }).then(({ data }) => setBootstrapAvailable(Boolean(data?.available)))
  }, [])
  const submit = async (event: FormEvent) => {
    event.preventDefault()
    try { await signIn(identifier, password) }
    catch (caught) { setError(translateAuthError(caught, '로그인할 수 없습니다.')) }
  }
  if (bootstrapMode) return <BootstrapSuperAdmin onCancel={() => setBootstrapMode(false)} />
  return <div className="admin-login"><form onSubmit={submit}><span><ShieldCheck /></span><p>HALLI ADMIN</p><h1>관리자 로그인</h1>{!isSupabaseConfigured && <div className="admin-config-warning">Supabase 환경 값을 먼저 설정하세요.</div>}<label>이메일 또는 전화번호<input value={identifier} onChange={event => setIdentifier(event.target.value)} required /></label><label>비밀번호<input type="password" value={password} onChange={event => setPassword(event.target.value)} minLength={8} required /></label>{error && <small>{error}</small>}<button><LockKeyhole /> 안전하게 로그인</button>{bootstrapAvailable && <button type="button" className="bootstrap-link" onClick={() => setBootstrapMode(true)}><KeyRound /> 최초 슈퍼 관리자 생성</button>}</form></div>
}

function BootstrapSuperAdmin({ onCancel }: { onCancel: () => void }) {
  const { signIn } = useAuth()
  const [email, setEmail] = useState('')
  const [nickname, setNickname] = useState('')
  const [password, setPassword] = useState('')
  const [secret, setSecret] = useState('')
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (!supabase) return setError('Supabase가 설정되지 않았습니다.')
    setSubmitting(true); setError('')
    const { data, error: invokeError } = await supabase.functions.invoke('bootstrap-super-admin', { body: { action: 'create', email, nickname, password, secret } })
    if (invokeError || !data?.created) { setError(data?.error ?? invokeError?.message ?? '생성하지 못했습니다.'); setSubmitting(false); return }
    try { await signIn(email, password) }
    catch (caught) { setError(translateAuthError(caught, '생성 후 로그인하지 못했습니다.')) }
    finally { setSubmitting(false) }
  }
  return <div className="admin-login bootstrap-admin"><form onSubmit={submit}><span><KeyRound /></span><p>ONE-TIME BOOTSTRAP</p><h1>최초 슈퍼 관리자</h1><div className="bootstrap-warning">이 작업은 프로젝트당 한 번만 실행되며 되돌릴 수 없습니다.</div><label>관리자 이메일<input type="email" value={email} onChange={event => setEmail(event.target.value)} required /></label><label>표시 이름<input value={nickname} onChange={event => setNickname(event.target.value)} minLength={2} required /></label><label>비밀번호<input type="password" value={password} onChange={event => setPassword(event.target.value)} minLength={12} required /></label><label>부트스트랩 비밀값<input type="password" value={secret} onChange={event => setSecret(event.target.value)} required /></label>{error && <small>{error}</small>}<button disabled={submitting}><ShieldCheck /> {submitting ? '생성 중...' : '슈퍼 관리자 생성'}</button><button type="button" className="bootstrap-link" onClick={onCancel}>로그인으로 돌아가기</button></form></div>
}
