import { Check, LoaderCircle, Radio, UserRound, X } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import PageHeader from '../components/PageHeader'

export default function Online() {
  const navigate = useNavigate()
  const [count, setCount] = useState(4)
  const [searching, setSearching] = useState(false)
  const [found, setFound] = useState(1)

  useEffect(() => {
    if (!searching || found >= count) return
    const timer = window.setTimeout(() => setFound(value => value + 1), 1200)
    return () => window.clearTimeout(timer)
  }, [searching, found, count])

  useEffect(() => {
    if (searching && found === count) {
      const timer = window.setTimeout(() => navigate('/game'), 900)
      return () => window.clearTimeout(timer)
    }
  }, [searching, found, count, navigate])

  if (searching) {
    return (
      <div className="content-page narrow-page matching-page play-flow-page">
        <button className="match-close" onClick={() => { setSearching(false); setFound(1) }} aria-label="매칭 취소"><X /></button>
        <div className="radar" aria-hidden="true"><i /><i /><i /><span><Radio /></span></div>
        <p className="eyebrow">QUICK MATCH</p>
        <h1>{found === count ? '모두 모였어요.' : '플레이어를 찾고 있어요.'}</h1>
        <p>{found === count ? '게임을 곧 시작할게요.' : '잠시만 기다려 주세요.'}</p>
        <div className="match-slots">
          {Array.from({ length: count }, (_, index) => (
            <div className={index < found ? 'match-slot is-found' : 'match-slot'} key={index}>
              {index < found ? (index === 0 ? <UserRound /> : <Check />) : <LoaderCircle />}
              <span>{index === 0 ? '나' : index < found ? `플레이어 ${index + 1}` : '검색 중'}</span>
            </div>
          ))}
        </div>
        <strong className="match-count">{found} / {count}</strong>
        <button className="secondary-button" onClick={() => { setSearching(false); setFound(1) }}>매칭 취소</button>
      </div>
    )
  }

  return (
    <div className="content-page narrow-page play-flow-page">
      <PageHeader eyebrow="QUICK MATCH" title="몇 명이서 플레이할까요?" description="원하는 인원을 선택하면 바로 매칭해 드려요." />
      <section className="form-card online-card">
        <div className="count-options">
          {[2, 3, 4, 5, 6].map(value => <button className={count === value ? 'is-selected' : ''} onClick={() => setCount(value)} key={value}><strong>{value}</strong><span>명</span>{count === value && <Check />}</button>)}
        </div>
        <div className="queue-info"><Radio /><span><strong>{count}인 대기열</strong><small>평균 대기 시간 약 10초</small></span><i>빠름</i></div>
        <button className="primary-button full-button" onClick={() => setSearching(true)}>매칭 시작</button>
      </section>
    </div>
  )
}
