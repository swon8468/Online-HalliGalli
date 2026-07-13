import { ArrowRight, AtSign, KeyRound, Phone, ShieldCheck } from 'lucide-react'
import { useEffect, useRef, useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import PageHeader from '../components/PageHeader'
import { translateAuthError } from '../lib/authErrors'
import { supabase } from '../lib/supabase'
import { phoneAuthEnabled } from '../lib/environment'
import { clearRecoveryRequestReceipt, recoveryRequestIsCoolingDown, saveRecoveryRequestReceipt } from '../lib/recoveryRequest'

export default function PasswordRecovery() {
  const navigate = useNavigate()
  const [method, setMethod] = useState<'email' | 'phone'>('email')
  const [step, setStep] = useState<'request' | 'verify' | 'password'>('request')
  const query = new URLSearchParams(window.location.search)
  const hash = new URLSearchParams(window.location.hash.replace(/^#/, ''))
  const hasRecoveryToken = hash.get('type') === 'recovery' && Boolean(hash.get('access_token'))
  const hasRecoveryCode = query.get('type') === 'recovery' && Boolean(query.get('code'))
  const recoveryHint = hasRecoveryToken || hasRecoveryCode || query.get('type') === 'recovery' || query.has('error_code')
  const [recoveryLinkState, setRecoveryLinkState] = useState<'idle' | 'checking' | 'valid' | 'invalid'>(recoveryHint ? 'checking' : 'idle')
  const [identifier, setIdentifier] = useState('')
  const [otp, setOtp] = useState('')
  const [password, setPassword] = useState('')
  const [passwordConfirm, setPasswordConfirm] = useState('')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const redirectTimerRef = useRef<number | null>(null)

  useEffect(() => () => {
    if (redirectTimerRef.current !== null) window.clearTimeout(redirectTimerRef.current)
  }, [])

  useEffect(() => {
    if (!supabase) { if (recoveryHint) setRecoveryLinkState('invalid'); return }
    const hasLinkError = window.location.hash.includes('error=') || new URLSearchParams(window.location.search).has('error_code')
    if (hasLinkError) { setRecoveryLinkState('invalid'); return }
    let completed = false
    let invalidTimer = 0
    const acceptRecovery = () => { completed = true; setRecoveryLinkState('valid'); setStep('password') }
    const { data } = supabase.auth.onAuthStateChange(event => { if (event === 'PASSWORD_RECOVERY') acceptRecovery() })
    void supabase.auth.getSession().then(({ data: session }) => {
      if (session.session && (hasRecoveryToken || hasRecoveryCode)) acceptRecovery()
      else if (recoveryHint) invalidTimer = window.setTimeout(() => { if (!completed) setRecoveryLinkState('invalid') }, 1800)
    })
    return () => { data.subscription.unsubscribe(); window.clearTimeout(invalidTimer) }
  }, [hasRecoveryCode, hasRecoveryToken, recoveryHint])

  const requestRecovery = async (event: FormEvent) => {
    event.preventDefault(); setBusy(true); setError(''); setMessage('')
    try {
      if (!supabase) throw new Error('Supabase가 설정되지 않았습니다.')
      if (method === 'email') {
        const email = identifier.trim().toLowerCase()
        if (recoveryRequestIsCoolingDown(email)) {
          navigate('/recover/sent', { replace: true, state: { method: 'email', identifier: email } })
          return
        }
        const { error: requestError } = await supabase.auth.resetPasswordForEmail(email, { redirectTo: `${window.location.origin}/recover?type=recovery` })
        if (requestError) throw requestError
        saveRecoveryRequestReceipt(email)
        navigate('/recover/sent', {
          replace: true,
          state: { method: 'email', identifier: email },
        })
        return
      } else {
        const { error: requestError } = await supabase.auth.signInWithOtp({ phone: identifier.trim(), options: { shouldCreateUser: false } })
        if (requestError) throw requestError
        setStep('verify'); setMessage('문자로 받은 6자리 인증번호를 입력해 주세요.')
      }
    } catch (cause) { setError(translateAuthError(cause, '복구 요청을 보내지 못했어요.')) }
    finally { setBusy(false) }
  }
  const verifyPhone = async (event: FormEvent) => {
    event.preventDefault(); setBusy(true); setError('')
    try {
      if (!supabase) throw new Error('Supabase가 설정되지 않았습니다.')
      const { error: verifyError } = await supabase.auth.verifyOtp({ phone: identifier.trim(), token: otp.trim(), type: 'sms' })
      if (verifyError) throw verifyError
      setStep('password'); setMessage('전화번호 인증이 완료됐어요.')
    } catch (cause) { setError(translateAuthError(cause, '인증번호가 올바르지 않아요.')) }
    finally { setBusy(false) }
  }
  const savePassword = async (event: FormEvent) => {
    event.preventDefault()
    if (password.length < 8) return setError('비밀번호는 8자 이상 입력해 주세요.')
    if (password !== passwordConfirm) return setError('비밀번호가 서로 일치하지 않아요.')
    setBusy(true); setError('')
    try {
      if (!supabase) throw new Error('Supabase가 설정되지 않았습니다.')
      const { error: updateError } = await supabase.auth.updateUser({ password })
      if (updateError) throw updateError
      await supabase.auth.signOut()
      clearRecoveryRequestReceipt()
      setMessage('비밀번호를 변경했어요. 새 비밀번호로 로그인해 주세요.')
      if (redirectTimerRef.current !== null) window.clearTimeout(redirectTimerRef.current)
      redirectTimerRef.current = window.setTimeout(() => { redirectTimerRef.current = null; navigate('/auth', { replace: true }) }, 900)
    } catch (cause) { setError(translateAuthError(cause, '비밀번호를 변경하지 못했어요.')) }
    finally { setBusy(false) }
  }

  if (recoveryLinkState === 'checking') return <div className="content-page narrow-page auth-page play-flow-page"><PageHeader eyebrow="ACCOUNT RECOVERY" title="재설정 링크를 확인하고 있어요." description="안전한 링크인지 확인한 뒤 비밀번호 변경 화면을 열어 드립니다." /><section className="form-card auth-card recovery-link-state" role="status"><ShieldCheck /><strong>인증 정보를 확인하는 중...</strong><p>잠시만 기다려 주세요.</p></section></div>

  if (recoveryLinkState === 'invalid') return <div className="content-page narrow-page auth-page play-flow-page"><PageHeader eyebrow="LINK EXPIRED" title="재설정 링크를 사용할 수 없어요." description="링크가 만료되었거나 이미 사용되었습니다." /><section className="form-card auth-card recovery-link-state" role="alert"><KeyRound /><strong>새로운 재설정 링크가 필요해요.</strong><p>비밀번호 복구 화면에서 이메일을 다시 입력해 주세요.</p><button className="primary-button full-button" onClick={() => { window.history.replaceState({}, '', '/recover'); setRecoveryLinkState('idle'); setStep('request'); setError('') }}>다시 요청하기 <ArrowRight /></button><button className="method-switch" onClick={() => navigate('/auth')}>로그인으로 돌아가기</button></section></div>

  return <div className="content-page narrow-page auth-page play-flow-page"><PageHeader eyebrow="ACCOUNT RECOVERY" title="계정에 다시 접속해요." description={phoneAuthEnabled ? '가입한 이메일 또는 전화번호로 본인 확인을 진행합니다.' : '가입한 이메일로 본인 확인을 진행합니다.'} />
    <form className="form-card auth-card" onSubmit={step === 'request' ? requestRecovery : step === 'verify' ? verifyPhone : savePassword}>
      {step === 'request' && <>{phoneAuthEnabled && <div className="auth-tabs"><button type="button" className={method === 'email' ? 'is-active' : ''} onClick={() => { setMethod('email'); setIdentifier(''); setError('') }}>이메일</button><button type="button" className={method === 'phone' ? 'is-active' : ''} onClick={() => { setMethod('phone'); setIdentifier(''); setError('') }}>전화번호</button></div>}<label><span>{method === 'email' ? <AtSign /> : <Phone />}{method === 'email' ? '이메일' : '전화번호'}</span><input type={method === 'email' ? 'email' : 'tel'} value={identifier} onChange={event => { setIdentifier(event.target.value); setError('') }} placeholder={method === 'email' ? 'player@example.com' : '+82 10 1234 5678'} aria-invalid={Boolean(error)} aria-describedby={error ? 'recovery-form-error' : undefined} required /></label></>}
      {step === 'verify' && <label><span><ShieldCheck /> SMS 인증번호</span><input inputMode="numeric" value={otp} onChange={event => { setOtp(event.target.value.replace(/\D/g, '').slice(0, 6)); setError('') }} placeholder="6자리" minLength={6} maxLength={6} aria-invalid={Boolean(error)} aria-describedby={error ? 'recovery-form-error' : undefined} required /></label>}
      {step === 'password' && <><label><span><KeyRound /> 새 비밀번호</span><input type="password" value={password} onChange={event => { setPassword(event.target.value); setError('') }} minLength={8} placeholder="8자 이상" aria-invalid={Boolean(error)} aria-describedby={error ? 'recovery-form-error' : undefined} required /></label><label><span><KeyRound /> 새 비밀번호 확인</span><input type="password" value={passwordConfirm} onChange={event => { setPasswordConfirm(event.target.value); setError('') }} minLength={8} placeholder="한 번 더 입력" aria-invalid={Boolean(error)} aria-describedby={error ? 'recovery-form-error' : undefined} required /></label></>}
      {message && <p className="field-message field-message--success" role="status">{message}</p>}{error && <p id="recovery-form-error" className="form-error" role="alert">{error}</p>}
      <button className="primary-button full-button" disabled={busy}>{busy ? '처리 중...' : step === 'request' ? '복구 안내 받기' : step === 'verify' ? '인증번호 확인' : '새 비밀번호 저장'} <ArrowRight /></button>
      <button type="button" className="method-switch" onClick={() => navigate('/auth')}>로그인으로 돌아가기</button>
    </form></div>
}
