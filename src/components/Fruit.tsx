type FruitKind = 'strawberry' | 'banana' | 'lime' | 'plum'

interface FruitProps {
  kind: FruitKind
  count?: number
  size?: 'small' | 'large'
  decorative?: boolean
}

function FruitShape({ kind }: { kind: FruitKind }) {
  if (kind === 'banana') {
    return (
      <svg viewBox="0 0 90 90" aria-hidden="true">
        <path d="M23 18c1 31 18 48 51 42-9 24-32 29-49 14C10 60 10 35 23 18Z" fill="#ffd60a" />
        <path d="M24 18 19 9" stroke="#6b5218" strokeWidth="6" strokeLinecap="round" />
      </svg>
    )
  }
  if (kind === 'lime') {
    return (
      <svg viewBox="0 0 90 90" aria-hidden="true">
        <circle cx="45" cy="48" r="29" fill="#72c61d" />
        <path d="M46 19c7-11 16-13 25-8-5 10-13 14-25 12" fill="#3a8d12" />
        <path d="M45 23V12" stroke="#356d18" strokeWidth="5" strokeLinecap="round" />
      </svg>
    )
  }
  if (kind === 'plum') {
    return (
      <svg viewBox="0 0 90 90" aria-hidden="true">
        <ellipse cx="45" cy="50" rx="29" ry="32" fill="#7352b8" />
        <path d="M45 21c4-10 11-15 21-13-1 9-8 15-20 17" fill="#4a8c2b" />
        <path d="M45 24 49 9" stroke="#4f3321" strokeWidth="5" strokeLinecap="round" />
      </svg>
    )
  }
  return (
    <svg viewBox="0 0 90 90" aria-hidden="true">
      <path d="M45 80C29 80 16 65 16 46c0-17 12-27 29-24 17-3 29 7 29 24 0 19-13 34-29 34Z" fill="#f33b4f" />
      <path d="m45 27-16-9 11-3 5-10 6 10 12 3-18 9Z" fill="#36963e" />
      <circle cx="33" cy="46" r="2.5" fill="#ffd9a2" /><circle cx="55" cy="53" r="2.5" fill="#ffd9a2" />
      <circle cx="38" cy="63" r="2.5" fill="#ffd9a2" /><circle cx="58" cy="38" r="2.5" fill="#ffd9a2" />
    </svg>
  )
}

export function Fruit({ kind, count = 1, size = 'small', decorative = false }: FruitProps) {
  return (
    <div className={`fruit-cluster fruit-cluster--${size} fruit-cluster--${count}`} aria-hidden={decorative || undefined} aria-label={decorative ? undefined : `${kind} ${count}개`}>
      {Array.from({ length: count }, (_, index) => <FruitShape kind={kind} key={index} />)}
    </div>
  )
}

export type { FruitKind }
