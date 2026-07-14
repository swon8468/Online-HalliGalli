import { ArrowLeft, MailCheck } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Link, Navigate, useLocation } from 'react-router-dom'
import PageHeader from '../components/PageHeader'
import { readRecoveryRequestReceipt, RECOVERY_REQUEST_COOLDOWN_MS } from '../lib/recoveryRequest'

type RecoveryLocationState = {
  method?: 'email'
  identifier?: string
}

function maskEmail(email?: string) {
  if (!email?.includes('@')) return ''
  const [name, domain] = email.split('@')
  const visible = name.slice(0, Math.min(2, name.length))
  return `${visible}${'*'.repeat(Math.max(2, name.length - visible.length))}@${domain}`
}

export default function RecoverySent() {
  const location = useLocation()
  const state = location.state as RecoveryLocationState | null
  const receipt = readRecoveryRequestReceipt()
  const requestedEmail = state?.identifier ?? receipt?.identifier
  const maskedEmail = maskEmail(requestedEmail)
  const [remainingSeconds, setRemainingSeconds] = useState(() => receipt
    ? Math.max(0, Math.ceil((receipt.requestedAt + RECOVERY_REQUEST_COOLDOWN_MS - Date.now()) / 1000))
    : 0)

  useEffect(() => {
    if (!receipt || remainingSeconds <= 0) return
    const update = () => setRemainingSeconds(Math.max(0, Math.ceil((receipt.requestedAt + RECOVERY_REQUEST_COOLDOWN_MS - Date.now()) / 1000)))
    const timer = window.setInterval(update, 1_000)
    return () => window.clearInterval(timer)
  }, [receipt, remainingSeconds])

  if (!requestedEmail) return <Navigate to="/recover" replace />

  return <div className="content-page narrow-page auth-page play-flow-page recovery-sent-page">
    <PageHeader eyebrow="CHECK YOUR EMAIL" title="메일을 확인해 주세요." description="비밀번호 재설정 메일 요청이 접수되었습니다." />
    <section className="form-card auth-card recovery-sent-card" aria-labelledby="recovery-sent-title">
      <span className="recovery-sent-icon" aria-hidden="true"><MailCheck /></span>
      <h2 id="recovery-sent-title">복구 메일을 요청했어요.</h2>
      {maskedEmail && <strong>{maskedEmail}</strong>}
      <p>메일 서비스 처리에 잠시 걸릴 수 있어요. 링크가 도착하면 열어서 새 비밀번호를 설정하고, 보이지 않으면 스팸함도 확인해 주세요.</p>
      <div className="recovery-sent-note" role="status">{remainingSeconds > 0 ? `중복 요청을 막기 위해 ${remainingSeconds}초 후 다시 요청할 수 있어요.` : '메일이 도착하지 않았다면 주소를 확인한 뒤 한 번만 다시 요청해 주세요.'}</div>
      {remainingSeconds === 0 && <Link className="secondary-button full-button" to="/recover" state={{ method: 'email', identifier: requestedEmail }}>메일 다시 요청하기</Link>}
      <Link className="primary-button full-button" to="/auth"><ArrowLeft /> 로그인으로 돌아가기</Link>
    </section>
  </div>
}
