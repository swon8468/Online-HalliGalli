import { Brush, Copy, Plus, ShieldCheck, Trash2 } from 'lucide-react'
import { FormEvent, useCallback, useEffect, useRef, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { useAuth } from '../auth/AuthContext'
import PageHeader from '../components/PageHeader'
import { cloneCardSet, createCardSet, deleteCardSet, listCardSets, type CardSetSummary } from '../lib/cards'
import { getErrorMessage } from '../lib/errorMessage'
import { fetchMySpaces, type MySpace } from '../lib/spaces'

export default function CardSets() {
  const { user } = useAuth()
  const [params] = useSearchParams()
  const requestedSpace = params.get('space')
  const [sets, setSets] = useState<CardSetSummary[]>([])
  const [spaces, setSpaces] = useState<MySpace[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)
  const [modal, setModal] = useState<'create' | 'clone' | null>(null)
  const [source, setSource] = useState<CardSetSummary | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<CardSetSummary | null>(null)
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [spaceId, setSpaceId] = useState(requestedSpace ?? '')
  const scopeKey = requestedSpace ?? ''
  const activeScopeRef = useRef(scopeKey)
  const refreshPromiseRef = useRef<{ key: string; promise: Promise<{ cards: CardSetSummary[]; memberships: MySpace[] }> } | null>(null)
  activeScopeRef.current = scopeKey

  const refresh = useCallback(async (ensureFresh = false) => {
    const key = requestedSpace ?? ''
    if (ensureFresh && refreshPromiseRef.current?.key === key) await refreshPromiseRef.current.promise.catch(() => undefined)
    setLoading(true)
    if (refreshPromiseRef.current?.key !== key) {
      const promise = Promise.all([listCardSets(requestedSpace), fetchMySpaces()])
        .then(([cards, memberships]) => ({ cards, memberships }))
        .finally(() => { if (refreshPromiseRef.current?.promise === promise) refreshPromiseRef.current = null })
      refreshPromiseRef.current = { key, promise }
    }
    try {
      const { cards, memberships } = await refreshPromiseRef.current.promise
      if (activeScopeRef.current !== key) return
      setSets(cards); setSpaces(memberships.filter(space => ['owner', 'manager'].includes(space.role) && space.status === 'active')); setError('')
    } catch { if (activeScopeRef.current === key) setError('카드 세트를 불러오지 못했어요. 잠시 후 다시 시도해 주세요.') }
    finally { if (activeScopeRef.current === key) setLoading(false) }
  }, [requestedSpace])
  useEffect(() => { void refresh() }, [refresh])
  const openCreate = () => { setError(''); setMessage(''); setModal('create'); setSource(null); setName(''); setDescription(''); setSpaceId(requestedSpace ?? spaces[0]?.id ?? '') }
  const openClone = (card: CardSetSummary) => { setError(''); setMessage(''); setModal('clone'); setSource(card); setName(`${card.name} 복사본`); setDescription(card.description ?? ''); setSpaceId(requestedSpace ?? card.spaceId ?? spaces[0]?.id ?? '') }
  const submit = async (event: FormEvent) => {
    event.preventDefault(); setBusy(true); setError(''); setMessage('')
    try {
      if (modal === 'clone' && source) await cloneCardSet(source.id, name, spaceId || null)
      else await createCardSet(name, description, spaceId || null)
      setModal(null); await refresh(true); setMessage(modal === 'clone' ? '카드 세트를 복제했어요.' : '초안 카드 세트를 만들었어요.')
    } catch (cause) { setError(getErrorMessage(cause, '카드 세트를 만들지 못했어요.')) }
    finally { setBusy(false) }
  }
  const remove = async () => {
    if (!deleteTarget) return
    setBusy(true); setError(''); setMessage('')
    try { await deleteCardSet(deleteTarget.id); setDeleteTarget(null); await refresh(true); setMessage('카드 세트를 삭제했어요.') }
    catch (cause) { setError(getErrorMessage(cause, '삭제하지 못했어요.')) }
    finally { setBusy(false) }
  }
  const canCreatePlatform = ['admin', 'super_admin'].includes(user?.role ?? '')
  const canCreate = canCreatePlatform || spaces.length > 0

  return <div className="content-page card-library-page"><PageHeader eyebrow="CARD STUDIO" title="게임의 표정을 디자인해요." description="과일 앞면과 카드 뒷면을 만들고, 게시 버전을 안전하게 관리하세요." />
    {(error || message) && <p className={`friends-notice ${error ? 'is-error' : ''}`} role={error ? 'alert' : 'status'}>{error || message}</p>}
    {error && !loading && <button className="secondary-button resource-retry" onClick={() => void refresh()}>카드 세트 다시 불러오기</button>}
    <section className="card-library-toolbar"><div><ShieldCheck /><span><strong>{requestedSpace ? '스페이스 카드 라이브러리' : '사용 가능한 카드 라이브러리'}</strong><small>게시된 카드만 실제 방에서 선택할 수 있습니다.</small></span></div>{canCreate && <button className="primary-button" onClick={openCreate}><Plus /> 새 카드 세트</button>}</section>
    {loading ? <div className="admin-loading"><span /><span /><span /></div> : sets.length ? <section className="card-library-grid">{sets.map(card => <article key={card.id}><div className="card-library-preview" style={{ background: card.backDesign.background ?? '#0878dd', color: card.backDesign.accent ?? '#fff' }}><Brush /><span>HALLI</span></div><div><i className={`card-status card-status--${card.status}`}>{card.status === 'published' ? '게시됨' : card.status === 'draft' ? '초안' : '보관'}</i><h2>{card.name}</h2><p>{card.description || '설명이 없습니다.'}</p><small>{card.isPlatformDefault ? '플랫폼 기본' : card.spaceName ?? '플랫폼'} · v{card.version}</small></div><div className="card-library-actions"><Link to={`/cards/${encodeURIComponent(card.id)}`}><Brush /> {card.isPlatformDefault && !canCreatePlatform ? '미리보기' : '편집'}</Link>{canCreate && <button onClick={() => openClone(card)}><Copy /> 복제</button>}{!card.isPlatformDefault && <button className="is-danger" onClick={() => setDeleteTarget(card)}><Trash2 /> 삭제</button>}</div></article>)}</section> : <div className="admin-empty"><Brush /><strong>카드 세트가 없어요.</strong><p>새 카드 세트를 만들면 기본 56장 구성이 복사됩니다.</p></div>}
    {modal && <div className="admin-modal-backdrop" onMouseDown={event => { if (event.target === event.currentTarget) setModal(null) }}><form className="admin-modal" role="dialog" aria-modal="true" aria-labelledby="card-set-modal-title" onSubmit={submit}><span>{modal === 'clone' ? <Copy /> : <Brush />}</span><h2 id="card-set-modal-title">{modal === 'clone' ? '카드 세트 복제' : '새 카드 세트'}</h2><p>기본 56장 구성을 가진 초안으로 시작합니다.</p><label>이름<input value={name} onChange={event => setName(event.target.value)} minLength={2} maxLength={80} required /></label>{modal === 'create' && <label>설명<textarea rows={3} value={description} onChange={event => setDescription(event.target.value)} /></label>}<label>소속<select value={spaceId} onChange={event => setSpaceId(event.target.value)} required={!canCreatePlatform}>{canCreatePlatform && <option value="">플랫폼</option>}{spaces.map(space => <option value={space.id} key={space.id}>{space.name}</option>)}</select></label><div><button data-dialog-dismiss type="button" className="secondary-button" onClick={() => setModal(null)}>취소</button><button className="full-button" disabled={busy}>{busy ? '처리 중...' : modal === 'clone' ? '복제' : '생성'}</button></div></form></div>}
    {deleteTarget && <div className="action-confirm" role="dialog" aria-modal="true" aria-labelledby="card-delete-title"><div><Trash2 aria-hidden="true" /><h2 id="card-delete-title">카드 세트를 삭제할까요?</h2><p><strong>{deleteTarget.name}</strong> 초안과 디자인이 삭제됩니다. 사용 중이거나 게시된 세트는 서버에서 차단됩니다.</p><button className="danger-button" autoFocus disabled={busy} onClick={() => void remove()}>{busy ? '삭제 중...' : '삭제하기'}</button><button data-dialog-dismiss className="secondary-button" disabled={busy} onClick={() => setDeleteTarget(null)}>취소</button></div></div>}
  </div>
}
