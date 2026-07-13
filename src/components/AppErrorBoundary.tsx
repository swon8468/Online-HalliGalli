import { Component, type ErrorInfo, type ReactNode } from 'react'
import { AlertTriangle, Home, RefreshCw } from 'lucide-react'
import { createShortId } from '../lib/id'

type Props = { children: ReactNode }
type State = { failed: boolean; incidentId: string }

function createIncidentId() {
  return `UI-${Date.now().toString(36).toUpperCase()}-${createShortId(6).toUpperCase()}`
}

export default class AppErrorBoundary extends Component<Props, State> {
  state: State = { failed: false, incidentId: '' }

  static getDerivedStateFromError(): State {
    return { failed: true, incidentId: createIncidentId() }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    if (import.meta.env.DEV) console.error(`[ui-error:${this.state.incidentId}]`, error.message, info.componentStack)
  }

  render() {
    if (!this.state.failed) return this.props.children
    return <main className="fatal-error-page" aria-labelledby="fatal-error-title"><section>
      <span aria-hidden="true"><AlertTriangle /></span><p>RECOVERY MODE</p>
      <h1 id="fatal-error-title">화면을 불러오지 못했어요.</h1>
      <p>입력 중이던 내용은 저장되지 않았을 수 있어요. 문제가 계속되면 아래 오류 번호를 관리자에게 알려 주세요.</p>
      <code>{this.state.incidentId}</code>
      <div><button className="primary-button" onClick={() => window.location.reload()}><RefreshCw /> 다시 불러오기</button><a className="secondary-button" href="/"><Home /> 홈으로 이동</a></div>
    </section></main>
  }
}
