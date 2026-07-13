import { Minus, Plus, UserRound } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import PageHeader from '../components/PageHeader'
import { createPrivateRoom, createSpaceRoom } from '../lib/rooms'
import { getErrorMessage } from '../lib/errorMessage'
import { fetchMySpaces, type MySpace } from '../lib/spaces'
import { listCardSets, type CardSetSummary } from '../lib/cards'

export default function CreateRoom() {
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const [maxPlayers, setMaxPlayers] = useState(4)
  const [spaces, setSpaces] = useState<MySpace[]>([])
  const [spaceId, setSpaceId] = useState(params.get('space') ?? '')
  const [cardSets, setCardSets] = useState<CardSetSummary[]>([])
  const [cardSetId, setCardSetId] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => { void fetchMySpaces().then(items => setSpaces(items.filter(item => item.status === 'active'))).catch(() => undefined) }, [])
  useEffect(() => {
    setCardSetId('')
    if (!spaceId) { setCardSets([]); return }
    void listCardSets(spaceId).then(items => setCardSets(items.filter(item => item.status === 'published'))).catch(() => setCardSets([]))
  }, [spaceId])

  const create = async () => {
    setBusy(true); setError('')
    try {
      const room = spaceId ? await createSpaceRoom(spaceId, maxPlayers, cardSetId || null) : await createPrivateRoom(maxPlayers)
      navigate(`/room/${encodeURIComponent(room.id)}`, { replace: true })
    } catch (cause) {
      setError(getErrorMessage(cause, '방을 생성하지 못했어요.'))
      setBusy(false)
    }
  }

  return <div className="content-page narrow-page play-flow-page"><PageHeader eyebrow={spaceId ? 'SPACE ROOM' : 'PRIVATE ROOM'} title="새 게임을 준비할게요." description="함께 플레이할 최대 인원을 선택하세요." /><section className="form-card player-picker-card">{spaces.length > 0 && <label className="space-room-select"><span>게임 공간</span><select value={spaceId} onChange={event => setSpaceId(event.target.value)}><option value="">일반 비공개 방</option>{spaces.map(space => <option value={space.id} key={space.id}>{space.name}</option>)}</select></label>}{spaceId && <label className="space-room-select"><span>카드 세트</span><select value={cardSetId} onChange={event => setCardSetId(event.target.value)}><option value="">기본 과일 카드</option>{cardSets.filter(card => !card.isPlatformDefault).map(card => <option value={card.id} key={card.id}>{card.name} · v{card.version}</option>)}</select></label>}<div className="people-visual" aria-hidden="true">{Array.from({ length: maxPlayers }, (_, index) => <span key={index}><UserRound /></span>)}</div><div className="stepper-label"><span>최대 인원</span><strong>{maxPlayers}명</strong></div><div className="stepper"><button onClick={() => setMaxPlayers(value => Math.max(2, value - 1))} disabled={maxPlayers === 2} aria-label="인원 줄이기"><Minus /></button><output>{maxPlayers}</output><button onClick={() => setMaxPlayers(value => Math.min(6, value + 1))} disabled={maxPlayers === 6} aria-label="인원 늘리기"><Plus /></button></div><p className="helper-text">{spaceId ? '스페이스 멤버만 코드로 참여할 수 있어요.' : '2명부터 6명까지 함께할 수 있어요.'}</p>{error && <p className="form-error" role="alert">{error}</p>}<button className="primary-button full-button" onClick={() => void create()} disabled={busy}>{busy ? '방 만드는 중...' : '방 만들기'}</button></section></div>
}
