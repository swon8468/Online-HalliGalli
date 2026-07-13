import { ArrowLeft, MailCheck } from 'lucide-react'
import { Link, useLocation } from 'react-router-dom'
import PageHeader from '../components/PageHeader'

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
  const maskedEmail = maskEmail(state?.identifier)

  return <div className="content-page narrow-page auth-page play-flow-page recovery-sent-page">
    <PageHeader eyebrow="CHECK YOUR EMAIL" title="메일을 확인해 주세요." description="비밀번호 재설정 안내를 요청한 주소로 보냈습니다." />
    <section className="form-card auth-card recovery-sent-card" aria-labelledby="recovery-sent-title">
      <span className="recovery-sent-icon" aria-hidden="true"><MailCheck /></span>
      <h2 id="recovery-sent-title">재설정 링크를 보냈어요.</h2>
      {maskedEmail && <strong>{maskedEmail}</strong>}
      <p>메일의 링크를 열어 새 비밀번호를 설정해 주세요. 메일이 보이지 않으면 스팸함도 확인해 주세요.</p>
      <div className="recovery-sent-note" role="status">중복 요청을 막기 위해 이 화면에서는 다시 전송하지 않습니다.</div>
      <Link className="primary-button full-button" to="/auth"><ArrowLeft /> 로그인으로 돌아가기</Link>
    </section>
  </div>
}
