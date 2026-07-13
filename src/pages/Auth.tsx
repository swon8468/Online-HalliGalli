import { ArrowRight, AtSign, LockKeyhole, Phone, ShieldCheck, UserRound } from 'lucide-react'
import { FormEvent, useState } from 'react'
import { Navigate, useNavigate, useSearchParams } from 'react-router-dom'
import { useAuth } from '../auth/AuthContext'
import PageHeader from '../components/PageHeader'
import { isSupabaseConfigured } from '../lib/supabase'

export default function Auth() {
  const { user, signIn, signUp } = useAuth()
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const [mode, setMode] = useState<'signin' | 'signup'>('signin')
  const [method, setMethod] = useState<'email' | 'phone'>('email')
  const [identifier, setIdentifier] = useState('')
  const [password, setPassword] = useState('')
  const [nickname, setNickname] = useState('')
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const next = searchParams.get('next') || '/'

  if (user) return <Navigate to={next} replace />

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (password.length < 8) return setError('비밀번호는 8자 이상 입력해 주세요.')
    if (mode === 'signup' && nickname.trim().length < 2) return setError('닉네임은 2자 이상 입력해 주세요.')
    setSubmitting(true)
    setError('')
    try {
      if (mode === 'signup') await signUp(identifier, password, nickname.trim())
      else await signIn(identifier, password)
      navigate(next, { replace: true })
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '계정 정보를 확인해 주세요.')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="content-page narrow-page auth-page play-flow-page">
      <PageHeader eyebrow="PLAYER ACCOUNT" title={mode === 'signin' ? '게임을 시작하려면 로그인하세요.' : '플레이어 계정을 만들어요.'} description="방 만들기, 참여하기, 온라인 매칭은 계정이 필요해요." />
      <form className="form-card auth-card" onSubmit={submit}>
        {!isSupabaseConfigured && <div className="demo-notice"><ShieldCheck /> 개발용 데모 인증이 활성화되어 있어요.</div>}
        <div className="auth-tabs"><button type="button" className={mode === 'signin' ? 'is-active' : ''} onClick={() => setMode('signin')}>로그인</button><button type="button" className={mode === 'signup' ? 'is-active' : ''} onClick={() => setMode('signup')}>가입하기</button></div>
        <div className="auth-method"><button type="button" className={method === 'email' ? 'is-active' : ''} onClick={() => { setMethod('email'); setIdentifier('') }}><AtSign /> 이메일</button><button type="button" className={method === 'phone' ? 'is-active' : ''} onClick={() => { setMethod('phone'); setIdentifier('') }}><Phone /> 전화번호</button></div>
        {mode === 'signup' && <label><span><UserRound /> 닉네임</span><input value={nickname} onChange={event => setNickname(event.target.value.slice(0, 12))} placeholder="게임에서 사용할 이름" required /></label>}
        <label><span>{method === 'email' ? <AtSign /> : <Phone />}{method === 'email' ? '이메일' : '전화번호'}</span><input type={method === 'email' ? 'email' : 'tel'} value={identifier} onChange={event => setIdentifier(event.target.value)} placeholder={method === 'email' ? 'player@example.com' : '+82 10 1234 5678'} required /></label>
        <label><span><LockKeyhole /> 비밀번호</span><input type="password" value={password} onChange={event => setPassword(event.target.value)} placeholder="8자 이상" minLength={8} required /></label>
        {error && <p className="form-error" role="alert">{error}</p>}
        <button className="primary-button full-button" disabled={submitting}>{submitting ? '확인 중...' : mode === 'signin' ? '로그인' : '계정 만들기'} <ArrowRight /></button>
      </form>
    </div>
  )
}
