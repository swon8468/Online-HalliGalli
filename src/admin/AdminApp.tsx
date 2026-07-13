import { FormEvent, useCallback, useEffect, useState, type ReactNode } from 'react'
import { ChevronLeft, KeyRound, LockKeyhole, ShieldCheck } from 'lucide-react'
import { Link, Route, Routes } from 'react-router-dom'
import { useAuth } from '../auth/AuthContext'
import { isSupabaseConfigured, supabase } from '../lib/supabase'
import { translateAuthError } from '../lib/authErrors'
import CardDesigner from '../pages/CardDesigner'
import CardSets from '../pages/CardSets'
import CreateRoom from '../pages/CreateRoom'
import Game from '../pages/Game'
import RoomLobby from '../pages/RoomLobby'
import SpaceAdmin from '../pages/SpaceAdmin'
import Spaces from '../pages/Spaces'
import AdminDashboard from './AdminDashboard'

export default function AdminApp() {
  const { user } = useAuth()
  if (!user) return <AdminLogin />
  if (!['support', 'admin', 'super_admin'].includes(user.role)) return <div className="admin-access-denied"><ShieldCheck /><h1>관리자 권한이 필요합니다.</h1><p>플랫폼 관리자에게 권한을 요청하세요.</p></div>
  return <Routes>
    <Route path="cards" element={<AdminToolPage><CardSets /></AdminToolPage>} />
    <Route path="cards/:cardSetId" element={<AdminToolPage><CardDesigner /></AdminToolPage>} />
    <Route path="spaces" element={<AdminToolPage><Spaces /></AdminToolPage>} />
    <Route path="spaces/:slug/admin" element={<AdminToolPage><SpaceAdmin /></AdminToolPage>} />
    <Route path="create" element={<AdminToolPage><CreateRoom /></AdminToolPage>} />
    <Route path="room/:roomId" element={<RoomLobby />} />
    <Route path="game" element={<Game />} />
    <Route path="*" element={<AdminDashboard />} />
  </Routes>
}

function AdminToolPage({ children }: { children: ReactNode }) {
  return <div className="admin-tool-route"><nav className="admin-tool-nav" aria-label="관리자 도구 이동"><Link to="/admin"><ChevronLeft /> 관리자 콘솔로</Link></nav>{children}</div>
}

function AdminLogin() {
  const { signIn } = useAuth()
  const [identifier, setIdentifier] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [bootstrapAvailable, setBootstrapAvailable] = useState(false)
  const [bootstrapStatusError, setBootstrapStatusError] = useState(false)
  const [bootstrapStatusLoading, setBootstrapStatusLoading] = useState(false)
  const [bootstrapMode, setBootstrapMode] = useState(false)
  const [submitting, setSubmitting] = useState(false)

  const loadBootstrapStatus = useCallback(async () => {
    if (!supabase) return
    setBootstrapStatusLoading(true); setBootstrapStatusError(false)
    try {
      const { data, error: invokeError } = await supabase.functions.invoke('bootstrap-super-admin', { body: { action: 'status' } })
      if (invokeError || data?.error) throw invokeError ?? new Error(String(data.error))
      setBootstrapAvailable(Boolean(data?.available))
    } catch {
      setBootstrapAvailable(false)
      setBootstrapStatusError(true)
    } finally { setBootstrapStatusLoading(false) }
  }, [])
  useEffect(() => { void loadBootstrapStatus() }, [loadBootstrapStatus])
  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (submitting) return
    setSubmitting(true); setError('')
    try { await signIn(identifier, password) }
    catch (caught) { setError(translateAuthError(caught, '로그인할 수 없습니다.')) }
    finally { setSubmitting(false) }
  }
  if (bootstrapMode) return <BootstrapSuperAdmin onCancel={() => setBootstrapMode(false)} />
  return <div className="admin-login"><form onSubmit={submit}><span><ShieldCheck /></span><p>HALLI ADMIN</p><h1>관리자 로그인</h1>{!isSupabaseConfigured && <div className="admin-config-warning">Supabase 환경 값을 먼저 설정하세요.</div>}{bootstrapStatusError && <div className="admin-config-warning" role="alert">최초 관리자 상태를 확인하지 못했습니다.<button type="button" onClick={() => void loadBootstrapStatus()}>다시 확인</button></div>}<label>이메일 또는 전화번호<input value={identifier} onChange={event => setIdentifier(event.target.value)} required /></label><label>비밀번호<input type="password" value={password} onChange={event => setPassword(event.target.value)} minLength={8} required /></label>{error && <small role="alert">{error}</small>}<button disabled={submitting}><LockKeyhole /> {submitting ? '로그인 중...' : '안전하게 로그인'}</button>{bootstrapAvailable && <button type="button" className="bootstrap-link" onClick={() => setBootstrapMode(true)}><KeyRound /> 최초 슈퍼 관리자 생성</button>}{bootstrapStatusLoading && <small role="status">최초 관리자 상태 확인 중...</small>}</form></div>
}

function bootstrapErrorMessage(error?: string) {
  const messages: Record<string, string> = {
    bootstrap_already_completed: '최초 슈퍼 관리자가 이미 생성되었습니다.',
    invalid_bootstrap_secret: '부트스트랩 비밀값이 올바르지 않습니다.',
    invalid_account_data: '이메일, 표시 이름과 12자 이상 비밀번호를 확인해 주세요.',
    user_creation_failed: '관리자 계정을 생성하지 못했습니다. 이메일 중복 여부를 확인해 주세요.',
    bootstrap_failed: '관리자 권한 설정을 완료하지 못했습니다. 잠시 후 다시 시도해 주세요.',
    server_not_configured: '개발 Supabase의 부트스트랩 비밀값 설정을 확인해 주세요.',
  }
  return messages[error ?? ''] ?? '슈퍼 관리자를 생성하지 못했습니다. 잠시 후 다시 시도해 주세요.'
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
    try {
      const { data, error: invokeError } = await supabase.functions.invoke('bootstrap-super-admin', { body: { action: 'create', email, nickname, password, secret } })
      if (invokeError || !data?.created) throw new Error(bootstrapErrorMessage(data?.error))
      await signIn(email, password)
    }
    catch (caught) { setError(translateAuthError(caught, '생성 후 로그인하지 못했습니다.')) }
    finally { setSubmitting(false) }
  }
  return <div className="admin-login bootstrap-admin"><form onSubmit={submit}><span><KeyRound /></span><p>ONE-TIME BOOTSTRAP</p><h1>최초 슈퍼 관리자</h1><div className="bootstrap-warning">이 작업은 프로젝트당 한 번만 실행되며 되돌릴 수 없습니다.</div><label>관리자 이메일<input type="email" value={email} onChange={event => setEmail(event.target.value)} required /></label><label>표시 이름<input value={nickname} onChange={event => setNickname(event.target.value)} minLength={2} required /></label><label>비밀번호<input type="password" value={password} onChange={event => setPassword(event.target.value)} minLength={12} required /></label><label>부트스트랩 비밀값<input type="password" value={secret} onChange={event => setSecret(event.target.value)} required /></label>{error && <small role="alert">{error}</small>}<button disabled={submitting}><ShieldCheck /> {submitting ? '생성 중...' : '슈퍼 관리자 생성'}</button><button type="button" className="bootstrap-link" onClick={onCancel}>로그인으로 돌아가기</button></form></div>
}
