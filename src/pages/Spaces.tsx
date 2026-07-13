import { ArrowRight, Building2, Copy, Link2, Plus, ShieldCheck, UsersRound } from 'lucide-react'
import { FormEvent, useEffect, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { useAuth } from '../auth/AuthContext'
import PageHeader from '../components/PageHeader'
import { createSpace, fetchMySpaces, joinSpace, type MySpace } from '../lib/spaces'

export default function Spaces() {
  const { user } = useAuth()
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const [spaces, setSpaces] = useState<MySpace[]>([])
  const [joinCode, setJoinCode] = useState(params.get('code')?.toUpperCase().slice(0, 8) ?? '')
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState('')
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const [createOpen, setCreateOpen] = useState(false)
  const [name, setName] = useState('')
  const [slug, setSlug] = useState('')
  const [description, setDescription] = useState('')

  const refresh = async () => {
    try { setSpaces(await fetchMySpaces()) }
    catch (cause) { setError(cause instanceof Error ? cause.message : '스페이스를 불러오지 못했어요.') }
    finally { setLoading(false) }
  }
  useEffect(() => { void refresh() }, [])
  const join = async (event: FormEvent) => {
    event.preventDefault(); setBusy('join'); setError(''); setMessage('')
    try { const joined = await joinSpace(joinCode); await refresh(); setMessage(`${joined.name}에 가입했어요.`); setJoinCode('') }
    catch (cause) { setError(cause instanceof Error ? cause.message : '가입하지 못했어요.') }
    finally { setBusy('') }
  }
  const create = async (event: FormEvent) => {
    event.preventDefault(); setBusy('create'); setError(''); setMessage('')
    try {
      const result = await createSpace({ name, slug, description, reason: '관리자 화면에서 스페이스 생성' })
      setCreateOpen(false); await refresh(); navigate(`/spaces/${encodeURIComponent(result.space.slug)}/admin`)
    } catch (cause) { setError(cause instanceof Error ? cause.message : '스페이스를 만들지 못했어요.') }
    finally { setBusy('') }
  }
  const canCreate = ['admin', 'super_admin'].includes(user?.role ?? '')

  return <div className="content-page spaces-page"><PageHeader eyebrow="ORGANIZATION SPACES" title="함께 운영할 공간이에요." description="회사, 행사, 동아리 등 단체별 멤버와 전용 카드·게임을 분리해 관리하세요." />
    {(error || message) && <p className={`friends-notice ${error ? 'is-error' : ''}`} role={error ? 'alert' : 'status'}>{error || message}</p>}
    <section className="space-join-panel"><div><Link2 /><span><strong>가입 코드가 있나요?</strong><small>8자리 코드를 입력하면 스페이스 멤버가 됩니다.</small></span></div><form onSubmit={join}><input aria-label="스페이스 가입 코드" value={joinCode} onChange={event => setJoinCode(event.target.value.toUpperCase().replace(/[^A-F0-9]/g, '').slice(0, 8))} placeholder="A1B2C3D4" minLength={8} maxLength={8} required /><button disabled={busy === 'join'}>{busy === 'join' ? '가입 중...' : '가입하기'}</button></form></section>
    <section className="space-directory"><header><div><h2>내 스페이스</h2><p>{loading ? '불러오는 중...' : `${spaces.length}개 스페이스에 참여 중이에요.`}</p></div>{canCreate && <button className="primary-button" onClick={() => setCreateOpen(true)}><Plus /> 스페이스 생성</button>}</header>
      {loading ? <div className="admin-loading"><span /><span /><span /></div> : spaces.length ? <div className="space-directory-grid">{spaces.map(space => <article key={space.id}><span><Building2 /></span><div><i>{space.status}</i><h3>{space.name}</h3><p>{space.description || '등록된 설명이 없습니다.'}</p><small>{space.slug} · {space.role === 'owner' ? '소유자' : space.role === 'manager' ? '관리자' : '멤버'}</small></div><div><Link className="secondary-button" to={`/create?space=${encodeURIComponent(space.id)}`}>전용 방 만들기 <ArrowRight /></Link>{(['owner', 'manager'].includes(space.role) || canCreate) && <Link className="text-button" to={`/spaces/${encodeURIComponent(space.slug)}/admin`}><ShieldCheck /> 관리</Link>}</div></article>)}</div> : <div className="admin-empty"><UsersRound /><strong>가입한 스페이스가 없어요.</strong><p>가입 코드로 참여하거나 플랫폼 관리자에게 생성을 요청하세요.</p></div>}
    </section>
    {createOpen && <div className="admin-modal-backdrop" onMouseDown={event => { if (event.target === event.currentTarget) setCreateOpen(false) }}><form className="admin-modal" role="dialog" aria-modal="true" aria-labelledby="create-space-title" onSubmit={create}><span><Building2 /></span><h2 id="create-space-title">스페이스 생성</h2><p>생성한 계정이 자동으로 소유자가 됩니다.</p><label>이름<input value={name} onChange={event => setName(event.target.value)} minLength={2} maxLength={80} required /></label><label>Slug<input value={slug} onChange={event => setSlug(event.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '').slice(0, 49))} minLength={3} placeholder="team-event" required /></label><label>설명<textarea rows={3} value={description} onChange={event => setDescription(event.target.value)} /></label><div className="space-code-preview">관리 URL<span>/spaces/{slug || 'slug'}/admin</span><button type="button" aria-label="관리 URL 복사" onClick={() => void navigator.clipboard?.writeText(`/spaces/${slug}/admin`)}><Copy /></button></div><div><button type="button" className="secondary-button" onClick={() => setCreateOpen(false)}>취소</button><button className="full-button" disabled={busy === 'create'}>{busy === 'create' ? '생성 중...' : '생성'}</button></div></form></div>}
  </div>
}
