import { ArrowLeft, Home, MapPinOff } from 'lucide-react'
import { Link, useNavigate } from 'react-router-dom'

export default function NotFound() {
  const navigate = useNavigate()
  return <div className="content-page narrow-page not-found-page"><section aria-labelledby="not-found-title">
    <span aria-hidden="true"><MapPinOff /></span><p>404 · PAGE NOT FOUND</p>
    <h1 id="not-found-title">요청한 화면을 찾지 못했어요.</h1>
    <p>링크가 만료됐거나 주소가 잘못되었을 수 있어요. 이전 화면으로 돌아가거나 홈에서 다시 시작해 주세요.</p>
    <div><button className="secondary-button" onClick={() => navigate(-1)}><ArrowLeft /> 이전 화면</button><Link className="primary-button" to="/"><Home /> 홈으로 이동</Link></div>
  </section></div>
}
