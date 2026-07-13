import { ArrowLeft } from 'lucide-react'
import { useNavigate } from 'react-router-dom'

interface PageHeaderProps {
  eyebrow?: string
  title: string
  description?: string
}

export default function PageHeader({ eyebrow, title, description }: PageHeaderProps) {
  const navigate = useNavigate()
  return (
    <header className="page-heading">
      <button className="icon-button back-button" onClick={() => navigate(-1)} aria-label="뒤로 가기">
        <ArrowLeft size={21} />
      </button>
      {eyebrow && <p className="eyebrow">{eyebrow}</p>}
      <h1>{title}</h1>
      {description && <p>{description}</p>}
    </header>
  )
}
