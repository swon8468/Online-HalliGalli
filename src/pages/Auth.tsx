import { ArrowRight, AtSign, LoaderCircle, LockKeyhole, Phone, ShieldCheck, UserRound } from 'lucide-react'
import { FormEvent, useRef, useState } from 'react'
import { Navigate, useNavigate, useSearchParams } from 'react-router-dom'
import { useAuth } from '../auth/AuthContext'
import PageHeader from '../components/PageHeader'
import { isSupabaseConfigured, supabase } from '../lib/supabase'
import { translateAuthError } from '../lib/authErrors'
import { phoneAuthEnabled } from '../lib/environment'

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
  const [checkedIdentifier, setCheckedIdentifier] = useState('')
  const [identifierError, setIdentifierError] = useState('')
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const duplicateCheckVersion = useRef(0)
  const identifierInput = useRef<HTMLInputElement>(null)
  const requestedNext = searchParams.get('next')
  const next = requestedNext?.startsWith('/') && !requestedNext.startsWith('//') ? requestedNext : '/'
  const checkingDuplicate = duplicateStatus === 'checking'
  const identifierVerified = duplicateStatus === 'available' && checkedIdentifier === identifier.trim()

  if (user) return <Navigate to={next} replace />

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (password.length < 8) return setError('비밀번호는 8자 이상 입력해 주세요.')
    if (mode === 'signup' && password !== passwordConfirm) return setError('비밀번호가 서로 일치하지 않아요.')
    if (mode === 'signup' && nickname.trim().length < 2) return setError('닉네임은 2자 이상 입력해 주세요.')
    if (mode === 'signup' && !identifierVerified) {
      setIdentifierError(`${method === 'email' ? '이메일' : '전화번호'} 중복 확인을 완료해 주세요.`)
      return
    }
    setSubmitting(true)
    setError(''); setNotice('')
    try {
      if (mode === 'signup') {
        const result = await signUp(identifier.trim(), password, nickname.trim())
        if (result.requiresVerification) {
          setNotice(method === 'email' ? '가입 확인 메일을 보냈어요. 이메일 인증 후 로그인해 주세요.' : '가입 확인 문자를 보냈어요. 전화번호 인증 후 로그인해 주세요.')
          setMode('signin'); setPassword(''); setPasswordConfirm(''); setDuplicateStatus('idle'); setCheckedIdentifier('')
          return
        }
      } else await signIn(identifier, password)
      navigate(next, { replace: true })
    } catch (caught) {
      setError(translateAuthError(caught))
    } finally {
      setSubmitting(false)
    }
  }

  const checkDuplicate = async () => {
    const normalized = identifier.trim()
    if (!normalized) return setIdentifierError(`${method === 'email' ? '이메일' : '전화번호'}를 입력해 주세요.`)
    if (method === 'email' && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized)) return setIdentifierError('올바른 이메일 주소를 입력해 주세요.')
    if (method === 'phone' && normalized.replace(/[^0-9]/g, '').length < 9) return setIdentifierError('국가번호를 포함한 올바른 전화번호를 입력해 주세요.')
    const checkVersion = ++duplicateCheckVersion.current
    const checkedMethod = method
    setIdentifier(normalized)
    setCheckedIdentifier('')
    setDuplicateStatus('checking'); setIdentifierError(''); setError('')
    if (!supabase) { setCheckedIdentifier(normalized); setDuplicateStatus('available'); return }
    try {
      const { data, error: invokeError } = await supabase.functions.invoke('check-identifier', { body: { type: checkedMethod, value: normalized } })
      if (checkVersion !== duplicateCheckVersion.current) return
      if (invokeError || data?.error) {
        setDuplicateStatus('idle')
        setCheckedIdentifier('')
        setIdentifierError(data?.error === 'rate_limited' ? '중복 확인을 너무 많이 시도했어요. 잠시 후 다시 해 주세요.' : '중복 확인에 실패했어요. 잠시 후 다시 시도해 주세요.')
        return
      }
      const available = data?.available === true
      setDuplicateStatus(available ? 'available' : 'taken')
      setCheckedIdentifier(available ? normalized : '')
      setIdentifierError(available ? '' : checkedMethod === 'email' ? '이미 사용 중인 이메일이에요.' : '이미 사용 중인 전화번호예요.')
    } catch {
      if (checkVersion !== duplicateCheckVersion.current) return
      setDuplicateStatus('idle')
      setCheckedIdentifier('')
      setIdentifierError('중복 확인에 실패했어요. 잠시 후 다시 시도해 주세요.')
    }
  }

  const switchMethod = () => {
    duplicateCheckVersion.current += 1
    setMethod(current => current === 'email' ? 'phone' : 'email')
    setIdentifier('')
    setDuplicateStatus('idle')
    setCheckedIdentifier('')
    setIdentifierError('')
    setError('')
    setNotice('')
  }

  const editIdentifier = () => {
    duplicateCheckVersion.current += 1
    setDuplicateStatus('idle')
    setCheckedIdentifier('')
    setIdentifierError('')
    setError('')
    requestAnimationFrame(() => identifierInput.current?.focus())
  }

  return (
    <div className="content-page narrow-page auth-page play-flow-page">
      <PageHeader eyebrow="PLAYER ACCOUNT" title={mode === 'signin' ? '게임을 시작하려면 로그인하세요.' : '플레이어 계정을 만들어요.'} description="방 만들기, 참여하기, 온라인 매칭은 계정이 필요해요." />
      <form className="form-card auth-card" onSubmit={submit} aria-busy={checkingDuplicate || submitting}>
        {!isSupabaseConfigured && <div className="demo-notice"><ShieldCheck /> 개발용 데모 인증이 활성화되어 있어요.</div>}
        <div className="auth-tabs"><button type="button" disabled={checkingDuplicate || submitting} className={mode === 'signin' ? 'is-active' : ''} onClick={() => { duplicateCheckVersion.current += 1; setMode('signin'); setDuplicateStatus('idle'); setCheckedIdentifier(''); setIdentifierError(''); setNotice('') }}>로그인</button><button type="button" disabled={checkingDuplicate || submitting} className={mode === 'signup' ? 'is-active' : ''} onClick={() => { duplicateCheckVersion.current += 1; setMode('signup'); setDuplicateStatus('idle'); setCheckedIdentifier(''); setIdentifierError(''); setNotice('') }}>가입하기</button></div>
        {mode === 'signup' && <label><span><UserRound /> 닉네임</span><input value={nickname} disabled={checkingDuplicate || submitting} onChange={event => setNickname(event.target.value.slice(0, 12))} placeholder="게임에서 사용할 이름" required /></label>}
        <div className="auth-field">
          <label htmlFor="auth-identifier"><span>{method === 'email' ? <AtSign /> : <Phone />}{method === 'email' ? '이메일' : '전화번호'}</span></label>
          <div className={`identifier-control ${identifierError ? 'has-error' : ''} ${duplicateStatus === 'available' ? 'is-available' : ''}`}>
            <input ref={identifierInput} id="auth-identifier" type={method === 'email' ? 'email' : 'tel'} value={identifier} disabled={checkingDuplicate || identifierVerified || submitting} onChange={event => { duplicateCheckVersion.current += 1; setIdentifier(event.target.value); setDuplicateStatus('idle'); setCheckedIdentifier(''); setIdentifierError(''); setError('') }} placeholder={method === 'email' ? 'player@example.com' : '+82 10 1234 5678'} aria-invalid={Boolean(identifierError)} aria-describedby={identifierError ? 'auth-identifier-error' : duplicateStatus === 'available' ? 'auth-identifier-success' : undefined} required />
            {mode === 'signup' && <button type="button" onClick={() => identifierVerified ? editIdentifier() : void checkDuplicate()} disabled={checkingDuplicate || submitting}>{checkingDuplicate ? '확인 중' : identifierVerified ? '다시 입력' : '중복 확인'}</button>}
          </div>
          {identifierError && <small id="auth-identifier-error" className="field-message field-message--error">{identifierError}</small>}
          {!identifierError && duplicateStatus === 'available' && <small id="auth-identifier-success" className="field-message field-message--success">사용할 수 있어요.</small>}
        </div>
        <label><span><LockKeyhole /> 비밀번호</span><input type="password" value={password} disabled={checkingDuplicate || submitting} onChange={event => setPassword(event.target.value)} placeholder="8자 이상" minLength={8} required /></label>
        {mode === 'signup' && <label><span><LockKeyhole /> 비밀번호 확인</span><input type="password" value={passwordConfirm} disabled={checkingDuplicate || submitting} onChange={event => setPasswordConfirm(event.target.value)} placeholder="비밀번호를 다시 입력" minLength={8} required /></label>}
        {notice && <p className="field-message field-message--success auth-notice" role="status">{notice}</p>}
        {error && <p className="form-error" role="alert">{error}</p>}
        <button className="primary-button full-button" disabled={submitting || checkingDuplicate || (mode === 'signup' && !identifierVerified)}>{submitting ? '확인 중...' : mode === 'signin' ? '로그인' : '계정 만들기'} <ArrowRight /></button>
        {mode === 'signin' && <button type="button" className="method-switch" disabled={checkingDuplicate || submitting} onClick={() => navigate('/recover')}>비밀번호를 잊으셨나요?</button>}
        {phoneAuthEnabled && <button type="button" className="method-switch" disabled={checkingDuplicate || submitting} onClick={switchMethod}>{method === 'email' ? '전화번호' : '이메일'}로 {mode === 'signin' ? '로그인하기' : '가입하기'}</button>}
      </form>
      {checkingDuplicate && <div className="auth-duplicate-overlay" role="status" aria-live="assertive" aria-label="중복 확인 진행 중"><div><LoaderCircle className="is-spinning" /><strong>중복 확인 중이에요.</strong><span>확인이 끝날 때까지 잠시 기다려 주세요.</span></div></div>}
    </div>
  )
}
