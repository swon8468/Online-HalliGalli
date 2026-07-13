import { ArrowRight, AtSign, LockKeyhole, Phone, ShieldCheck, UserRound } from 'lucide-react'
import { FormEvent, useState } from 'react'
import { Navigate, useNavigate, useSearchParams } from 'react-router-dom'
import { useAuth } from '../auth/AuthContext'
import PageHeader from '../components/PageHeader'
import { isSupabaseConfigured, supabase } from '../lib/supabase'

export default function Auth() {
  const { user, signIn, signUp } = useAuth()
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const [mode, setMode] = useState<'signin' | 'signup'>('signin')
  const [method, setMethod] = useState<'email' | 'phone'>('email')
  const [identifier, setIdentifier] = useState('')
  const [password, setPassword] = useState('')
  const [passwordConfirm, setPasswordConfirm] = useState('')
  const [nickname, setNickname] = useState('')
  const [duplicateStatus, setDuplicateStatus] = useState<'idle' | 'checking' | 'available' | 'taken'>('idle')
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const next = searchParams.get('next') || '/'

  if (user) return <Navigate to={next} replace />

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (password.length < 8) return setError('비밀번호는 8자 이상 입력해 주세요.')
    if (mode === 'signup' && password !== passwordConfirm) return setError('비밀번호가 서로 일치하지 않아요.')
    if (mode === 'signup' && nickname.trim().length < 2) return setError('닉네임은 2자 이상 입력해 주세요.')
    if (mode === 'signup' && duplicateStatus !== 'available') return setError(`${method === 'email' ? '이메일' : '전화번호'} 중복 확인을 완료해 주세요.`)
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

  const checkDuplicate = async () => {
    if (!identifier.trim()) return setError(`${method === 'email' ? '이메일' : '전화번호'}를 입력해 주세요.`)
    setDuplicateStatus('checking'); setError('')
    if (!supabase) { setDuplicateStatus('available'); return }
    const { data, error: invokeError } = await supabase.functions.invoke('check-identifier', { body: { type: method, value: identifier } })
    if (invokeError || data?.error) {
      setDuplicateStatus('idle')
      setError(data?.error === 'rate_limited' ? '중복 확인을 너무 많이 시도했어요. 잠시 후 다시 해 주세요.' : '중복 확인에 실패했어요.')
      return
    }
    setDuplicateStatus(data?.available ? 'available' : 'taken')
    if (!data?.available) setError(`이미 사용 중인 ${method === 'email' ? '이메일' : '전화번호'}예요.`)
  }

  return (
    <div className="content-page narrow-page auth-page play-flow-page">
      <PageHeader eyebrow="PLAYER ACCOUNT" title={mode === 'signin' ? '게임을 시작하려면 로그인하세요.' : '플레이어 계정을 만들어요.'} description="방 만들기, 참여하기, 온라인 매칭은 계정이 필요해요." />
      <form className="form-card auth-card" onSubmit={submit}>
        {!isSupabaseConfigured && <div className="demo-notice"><ShieldCheck /> 개발용 데모 인증이 활성화되어 있어요.</div>}
        <div className="auth-tabs"><button type="button" className={mode === 'signin' ? 'is-active' : ''} onClick={() => setMode('signin')}>로그인</button><button type="button" className={mode === 'signup' ? 'is-active' : ''} onClick={() => { setMode('signup'); setDuplicateStatus('idle') }}>가입하기</button></div>
        <div className="auth-method"><button type="button" className={method === 'email' ? 'is-active' : ''} onClick={() => { setMethod('email'); setIdentifier(''); setDuplicateStatus('idle') }}><AtSign /> 이메일</button><button type="button" className={method === 'phone' ? 'is-active' : ''} onClick={() => { setMethod('phone'); setIdentifier(''); setDuplicateStatus('idle') }}><Phone /> 전화번호</button></div>
        {mode === 'signup' && <label><span><UserRound /> 닉네임</span><input value={nickname} onChange={event => setNickname(event.target.value.slice(0, 12))} placeholder="게임에서 사용할 이름" required /></label>}
        <label><span>{method === 'email' ? <AtSign /> : <Phone />}{method === 'email' ? '이메일' : '전화번호'}</span><input type={method === 'email' ? 'email' : 'tel'} value={identifier} onChange={event => { setIdentifier(event.target.value); setDuplicateStatus('idle'); setError('') }} placeholder={method === 'email' ? 'player@example.com' : '+82 10 1234 5678'} required /></label>
        {mode === 'signup' && <div className={`duplicate-check is-${duplicateStatus}`}><button type="button" onClick={() => void checkDuplicate()} disabled={duplicateStatus === 'checking'}>{duplicateStatus === 'checking' ? '확인 중...' : '중복 확인'}</button><span>{duplicateStatus === 'available' ? '사용할 수 있어요.' : duplicateStatus === 'taken' ? '이미 사용 중이에요.' : '가입 전에 확인해 주세요.'}</span></div>}
        <label><span><LockKeyhole /> 비밀번호</span><input type="password" value={password} onChange={event => setPassword(event.target.value)} placeholder="8자 이상" minLength={8} required /></label>
        {mode === 'signup' && <label><span><LockKeyhole /> 비밀번호 확인</span><input type="password" value={passwordConfirm} onChange={event => setPasswordConfirm(event.target.value)} placeholder="비밀번호를 다시 입력" minLength={8} required /></label>}
        {error && <p className="form-error" role="alert">{error}</p>}
        <button className="primary-button full-button" disabled={submitting}>{submitting ? '확인 중...' : mode === 'signin' ? '로그인' : '계정 만들기'} <ArrowRight /></button>
      </form>
    </div>
  )
}
