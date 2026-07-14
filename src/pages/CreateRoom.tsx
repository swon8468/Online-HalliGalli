import { Minus, Plus, UserRound } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import PageHeader from '../components/PageHeader'
import { createPrivateRoom, createSpaceRoom } from '../lib/rooms'
import { getErrorMessage } from '../lib/errorMessage'
import { fetchMySpaces, type MySpace } from '../lib/spaces'
import { listCardSets, type CardSetSummary } from '../lib/cards'
import { isSupabaseConfigured } from '../lib/supabase'

export default function CreateRoom() {
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const requestedSpaceId = params.get('space') ?? ''
  const [maxPlayers, setMaxPlayers] = useState(4)
  const [spaces, setSpaces] = useState<MySpace[]>([])
  const [spacesLoading, setSpacesLoading] = useState(true)
  const [spacesError, setSpacesError] = useState('')
  const [spacesAttempt, setSpacesAttempt] = useState(0)
  const [spaceId, setSpaceId] = useState(requestedSpaceId)
  const [cardSets, setCardSets] = useState<CardSetSummary[]>([])
  const [cardSetsLoading, setCardSetsLoading] = useState(false)
  const [cardSetsError, setCardSetsError] = useState('')
  const [cardSetsAttempt, setCardSetsAttempt] = useState(0)
  const [cardSetId, setCardSetId] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const lastRequestedSpaceId = useRef(requestedSpaceId)

  useEffect(() => {
    if (requestedSpaceId === lastRequestedSpaceId.current) return
    lastRequestedSpaceId.current = requestedSpaceId
    setSpaceId(requestedSpaceId && !spacesLoading && !spaces.some(space => space.id === requestedSpaceId) ? '' : requestedSpaceId)
  }, [requestedSpaceId, spaces, spacesLoading])

  useEffect(() => {
    if (!isSupabaseConfigured) { setSpaces([]); setSpacesLoading(false); setSpacesError(''); return }
    let active = true
    setSpacesLoading(true); setSpacesError('')
    void fetchMySpaces()
      .then(items => {
        if (!active) return
        const available = items.filter(item => item.status === 'active')
        setSpaces(available)
        setSpaceId(current => current && !available.some(item => item.id === current) ? '' : current)
      })
      .catch(() => { if (active) { setSpaces([]); setSpacesError('게임 공간 목록을 불러오지 못했어요.') } })
      .finally(() => { if (active) setSpacesLoading(false) })
    return () => { active = false }
  }, [spacesAttempt])
  useEffect(() => {
    setCardSetId('')
    setCardSetsError('')
    if (!spaceId) { setCardSets([]); setCardSetsLoading(false); return }
    let active = true
    setCardSetsLoading(true)
    void listCardSets(spaceId)
      .then(items => { if (active) setCardSets(items.filter(item => item.status === 'published')) })
      .catch(() => { if (active) { setCardSets([]); setCardSetsError('카드 세트 목록을 불러오지 못했어요.') } })
      .finally(() => { if (active) setCardSetsLoading(false) })
    return () => { active = false }
  }, [cardSetsAttempt, spaceId])

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

  const optionsUnavailable = spacesLoading || Boolean(spacesError) || Boolean(spaceId && (cardSetsLoading || cardSetsError))
  return <div className="content-page narrow-page play-flow-page"><PageHeader eyebrow={spaceId ? 'SPACE ROOM' : 'PRIVATE ROOM'} title="새 게임을 준비할게요." description="함께 플레이할 최대 인원을 선택하세요." /><section className="form-card player-picker-card">
    {spacesLoading && <p className="option-load-state" role="status">게임 공간을 확인하고 있어요.</p>}
    {spacesError && <div className="option-load-state is-error" role="alert"><span>{spacesError}</span><button type="button" onClick={() => setSpacesAttempt(value => value + 1)}>게임 공간 다시 불러오기</button></div>}
    {!spacesLoading && !spacesError && spaces.length > 0 && <label className="space-room-select"><span>게임 공간</span><select value={spaceId} onChange={event => setSpaceId(event.target.value)}><option value="">일반 비공개 방</option>{spaces.map(space => <option value={space.id} key={space.id}>{space.name}</option>)}</select></label>}
    {spaceId && !cardSetsError && <label className="space-room-select"><span>카드 세트</span><select value={cardSetId} onChange={event => setCardSetId(event.target.value)} disabled={cardSetsLoading}><option value="">{cardSetsLoading ? '카드 세트 확인 중...' : '기본 과일 카드'}</option>{cardSets.filter(card => !card.isPlatformDefault).map(card => <option value={card.id} key={card.id}>{card.name} · v{card.version}</option>)}</select></label>}
    {spaceId && cardSetsError && <div className="option-load-state is-error" role="alert"><span>{cardSetsError}</span><button type="button" onClick={() => setCardSetsAttempt(value => value + 1)}>카드 세트 다시 불러오기</button></div>}
    <div className="people-visual" aria-hidden="true">{Array.from({ length: maxPlayers }, (_, index) => <span key={index}><UserRound /></span>)}</div><div className="stepper-label"><span>최대 인원</span><strong>{maxPlayers}명</strong></div><div className="stepper"><button onClick={() => setMaxPlayers(value => Math.max(2, value - 1))} disabled={maxPlayers === 2} aria-label="인원 줄이기"><Minus /></button><output>{maxPlayers}</output><button onClick={() => setMaxPlayers(value => Math.min(6, value + 1))} disabled={maxPlayers === 6} aria-label="인원 늘리기"><Plus /></button></div><p className="helper-text">{spaceId ? '스페이스 멤버만 코드로 참여할 수 있어요.' : '2명부터 6명까지 함께할 수 있어요.'}</p>{error && <p className="form-error" role="alert">{error}</p>}<button className="primary-button full-button" onClick={() => void create()} disabled={busy || optionsUnavailable}>{busy ? '방 만드는 중...' : optionsUnavailable ? '방 옵션 확인 중...' : '방 만들기'}</button></section></div>
}
