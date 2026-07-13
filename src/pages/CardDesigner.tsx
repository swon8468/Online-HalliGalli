import { ArrowLeft, Brush, CheckCircle2, Copy, ImageUp, Layers3, Save, Send, SlidersHorizontal, Undo2, X } from 'lucide-react'
import { ChangeEvent, useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { Fruit } from '../components/Fruit'
import { getErrorMessage } from '../lib/errorMessage'
import {
  cardAssetUrl, loadCardSet, publishCardSet, saveCardDesign, saveCardSetMeta, unpublishCardSet,
  uploadCardAsset, type CardDesignRecord, type CardFruit, type CardSetDetail,
} from '../lib/cards'

const fruitLabels: Record<CardFruit, string> = { strawberry: '딸기', banana: '바나나', lime: '라임', plum: '자두' }

export default function CardDesigner() {
  const { cardSetId = '' } = useParams()
  const [cardSet, setCardSet] = useState<CardSetDetail | null>(null)
  const [selectedId, setSelectedId] = useState('back')
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [backAssetPath, setBackAssetPath] = useState<string | null>(null)
  const [backBackground, setBackBackground] = useState('#0878dd')
  const [backAccent, setBackAccent] = useState('#ffffff')
  const [designs, setDesigns] = useState<CardDesignRecord[]>([])
  const [busy, setBusy] = useState('')
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const [propertiesOpen, setPropertiesOpen] = useState(false)

  const refresh = useCallback(async () => {
    try {
      const value = await loadCardSet(cardSetId); setCardSet(value); setName(value.name); setDescription(value.description ?? ''); setBackAssetPath(value.backAssetPath); setBackBackground(value.backDesign.background ?? '#0878dd'); setBackAccent(value.backDesign.accent ?? '#ffffff'); setDesigns(value.designs)
    } catch (cause) { setError(getErrorMessage(cause, '카드 세트를 불러오지 못했어요.')) }
  }, [cardSetId])
  useEffect(() => { void refresh() }, [refresh])
  const selected = useMemo(() => designs.find(design => design.id === selectedId) ?? null, [designs, selectedId])
  const editable = Boolean(cardSet?.canManage && cardSet.status !== 'published' && !cardSet.isPlatformDefault)
  const updateSelected = (patch: Partial<CardDesignRecord>) => { if (!selected) return; setDesigns(items => items.map(item => item.id === selected.id ? { ...item, ...patch } : item)) }
  const run = async (key: string, action: () => Promise<void>, success: string) => { setBusy(key); setError(''); setMessage(''); try { await action(); await refresh(); setMessage(success) } catch (cause) { setError(getErrorMessage(cause, '작업을 완료하지 못했어요.')) } finally { setBusy('') } }
  const save = () => void run('save', async () => {
    if (!cardSet) return
    await saveCardSetMeta(cardSet.id, { name, description, backAssetPath, backDesign: { ...cardSet.backDesign, background: backBackground, accent: backAccent } })
    if (selected) await saveCardDesign(selected)
  }, '초안을 저장했어요.')
  const upload = async (event: ChangeEvent<HTMLInputElement>, kind: 'back' | 'front') => {
    const file = event.target.files?.[0]; if (!file || !cardSet) return
    setBusy('upload'); setError('')
    try {
      const path = await uploadCardAsset(cardSet.id, file, kind === 'back' ? 'back' : `${selected?.fruit}-${selected?.count}`)
      if (kind === 'back') setBackAssetPath(path); else updateSelected({ frontAssetPath: path })
      setMessage('이미지를 업로드했어요. 저장 버튼을 눌러 반영하세요.')
    } catch (cause) { setError(getErrorMessage(cause, '이미지를 업로드하지 못했어요.')) }
    finally { setBusy('') }
  }
  if (!cardSet) return <div className="route-loading">{error || '카드 스튜디오를 여는 중...'}</div>
  const assetPath = selectedId === 'back' ? backAssetPath : selected?.frontAssetPath ?? null

  return <div className="card-designer-page"><header className="card-designer-header"><Link to={cardSet.spaceId ? `/cards?space=${encodeURIComponent(cardSet.spaceId)}` : '/cards'} aria-label="카드 목록으로"><ArrowLeft /></Link><div><p>CARD STUDIO</p><input aria-label="카드 세트 이름" value={name} onChange={event => setName(event.target.value)} disabled={!editable} /></div><span className={`card-status card-status--${cardSet.status}`}>{cardSet.status === 'published' ? `게시됨 v${cardSet.version}` : '초안'}</span><div>{editable && <button onClick={save} disabled={busy === 'save'}><Save /> 저장</button>}{cardSet.canManage && !cardSet.isPlatformDefault && (cardSet.status === 'published' ? <button onClick={() => void run('unpublish', () => unpublishCardSet(cardSet.id), '게시를 취소하고 편집 모드로 전환했어요.')}><Undo2 /> 게시 취소</button> : <button className="is-primary" onClick={() => void run('publish', () => publishCardSet(cardSet.id), '새 버전을 게시했어요.')}><Send /> 게시</button>)}</div></header>
    {(error || message) && <p className={`designer-notice ${error ? 'is-error' : ''}`} role={error ? 'alert' : 'status'}>{error || message}</p>}
    <main className="card-designer-main"><aside className="card-design-list"><button className={selectedId === 'back' ? 'is-selected' : ''} onClick={() => setSelectedId('back')}><span className="design-mini-back" style={{ background: backBackground }} /><strong>카드 뒷면</strong></button>{(['strawberry', 'banana', 'lime', 'plum'] as CardFruit[]).map(fruit => <section key={fruit}><h2>{fruitLabels[fruit]}</h2>{designs.filter(design => design.fruit === fruit).map(design => <button className={selectedId === design.id ? 'is-selected' : ''} onClick={() => setSelectedId(design.id)} key={design.id}><Fruit kind={fruit} count={Math.min(design.count, 3)} decorative /><span><strong>{design.count}개</strong><small>{design.quantity}장</small></span></button>)}</section>)}</aside>
      <section className="card-design-canvas"><button className="designer-properties-toggle" aria-label="디자인 속성 열기" onClick={() => setPropertiesOpen(true)}><SlidersHorizontal /> 설정</button><div className="designer-card" style={{ background: selectedId === 'back' ? backBackground : selected?.design.background ?? '#ffffff', color: selectedId === 'back' ? backAccent : selected?.design.accent ?? '#111111' }}>{assetPath ? <img src={cardAssetUrl(assetPath) ?? ''} alt={selectedId === 'back' ? '업로드한 카드 뒷면' : `${selected ? fruitLabels[selected.fruit] : ''} 카드 이미지`} /> : selected ? <Fruit kind={selected.fruit} count={selected.count} size="large" /> : <><Layers3 /><strong>HALLI GALLI</strong></>} {selected && <small>{selected.label || fruitLabels[selected.fruit]}</small>}</div><div className="designer-count-preview">{selected && Array.from({ length: 5 }, (_, index) => <span className={index + 1 === selected.count ? 'is-current' : ''} key={index}><Fruit kind={selected.fruit} count={index + 1} /><small>{index + 1}</small></span>)}</div></section>
      <aside className={`card-properties ${propertiesOpen ? 'is-open' : ''}`}><button className="designer-properties-close" aria-label="디자인 속성 닫기" onClick={() => setPropertiesOpen(false)}><X /></button><h2><Brush /> 디자인 속성</h2><label>설명<textarea rows={3} value={description} onChange={event => setDescription(event.target.value)} disabled={!editable} /></label>{selectedId === 'back' ? <><label>배경색<input type="color" value={backBackground} onChange={event => setBackBackground(event.target.value)} disabled={!editable} /></label><label>강조색<input type="color" value={backAccent} onChange={event => setBackAccent(event.target.value)} disabled={!editable} /></label></> : selected && <><label>표시 이름<input value={selected.label} onChange={event => updateSelected({ label: event.target.value })} disabled={!editable} /></label><label>덱 수량<input type="number" min={1} max={12} value={selected.quantity} onChange={event => updateSelected({ quantity: Math.max(1, Math.min(12, Number(event.target.value))) })} disabled={!editable} /></label><label>배경색<input type="color" value={selected.design.background ?? '#ffffff'} onChange={event => updateSelected({ design: { ...selected.design, background: event.target.value } })} disabled={!editable} /></label><label>글자색<input type="color" value={selected.design.accent ?? '#111111'} onChange={event => updateSelected({ design: { ...selected.design, accent: event.target.value } })} disabled={!editable} /></label></>}<label className={`designer-upload ${!editable ? 'is-disabled' : ''}`}><ImageUp /> {selectedId === 'back' ? '뒷면 이미지' : '앞면 이미지'} 업로드<input type="file" accept="image/png,image/jpeg,image/webp,image/svg+xml" disabled={!editable || busy === 'upload'} onChange={event => void upload(event, selectedId === 'back' ? 'back' : 'front')} /></label>{assetPath && editable && <button className="designer-remove-image" onClick={() => selectedId === 'back' ? setBackAssetPath(null) : updateSelected({ frontAssetPath: null })}>이미지 제거</button>}<div className="version-history"><h3><CheckCircle2 /> 게시 버전</h3>{cardSet.versions.length ? cardSet.versions.map(version => <span key={version.id}><strong>v{version.version}</strong><small>{new Date(version.publishedAt).toLocaleString('ko-KR')}</small><Copy /></span>) : <p>아직 게시된 버전이 없습니다.</p>}</div></aside>
    </main>
  </div>
}
