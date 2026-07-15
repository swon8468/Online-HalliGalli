import { ArrowRight, Building2, Copy, Link2, Plus, ShieldCheck, UsersRound } from 'lucide-react'
import { FormEvent, useCallback, useEffect, useRef, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { useAuth } from '../auth/AuthContext'
import PageHeader from '../components/PageHeader'
import { copyText } from '../lib/clipboard'
import { emailUsesInstitutionDomain, normalizeInstitutionEmailDomain } from '../lib/emailDomain'
import { getErrorMessage } from '../lib/errorMessage'
import { createSpace, fetchMySpaces, joinSpace, type MySpace } from '../lib/spaces'

export default function Spaces() {
  const { user } = useAuth()
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const requestedJoinCode = params.get('code')?.toUpperCase().replace(/[^A-F0-9]/g, '').slice(0, 8) ?? ''
  const [spaces, setSpaces] = useState<MySpace[]>([])
  const [joinCode, setJoinCode] = useState(requestedJoinCode)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState('')
  const [loadError, setLoadError] = useState('')
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const [createOpen, setCreateOpen] = useState(false)
  const [name, setName] = useState('')
  const [slug, setSlug] = useState('')
  const [description, setDescription] = useState('')
  const [emailDomain, setEmailDomain] = useState('')
  const [managerEmail, setManagerEmail] = useState('')
  const [managerNickname, setManagerNickname] = useState('')
  const [managerPassword, setManagerPassword] = useState('')
  const [createdSpace, setCreatedSpace] = useState<{ slug: string; managerEmail: string; managerPassword: string } | null>(null)
  const refreshPromiseRef = useRef<ReturnType<typeof fetchMySpaces> | null>(null)
  const lastRequestedJoinCode = useRef(requestedJoinCode)
  const joinCodeVersionRef = useRef(0)
  const actionTokenRef = useRef<symbol | null>(null)
  const createSlugRef = useRef(slug)
  createSlugRef.current = slug

  const refresh = useCallback(async (ensureFresh = false) => {
    if (ensureFresh && refreshPromiseRef.current) await refreshPromiseRef.current.catch(() => undefined)
    setLoading(true)
    if (!refreshPromiseRef.current) refreshPromiseRef.current = fetchMySpaces().finally(() => { refreshPromiseRef.current = null })
    try { setSpaces(await refreshPromiseRef.current); setLoadError('') }
    catch { setLoadError('스페이스를 불러오지 못했어요. 잠시 후 다시 시도해 주세요.') }
    finally { setLoading(false) }
  }, [])
  useEffect(() => { void refresh() }, [refresh])
  useEffect(() => {
    if (requestedJoinCode === lastRequestedJoinCode.current) return
    lastRequestedJoinCode.current = requestedJoinCode
    joinCodeVersionRef.current += 1
    setJoinCode(requestedJoinCode)
    setError(''); setMessage('')
  }, [requestedJoinCode])
  const join = async (event: FormEvent) => {
    event.preventDefault()
    if (actionTokenRef.current) return
    const version = joinCodeVersionRef.current
    const token = Symbol('join')
    actionTokenRef.current = token
    setBusy('join'); setError(''); setMessage('')
    try {
      const joined = await joinSpace(joinCode)
      await refresh(true)
      if (joinCodeVersionRef.current === version) {
        setMessage(`${joined.name}에 가입했어요.`); setJoinCode(''); joinCodeVersionRef.current += 1
      }
    } catch (cause) {
      if (joinCodeVersionRef.current === version) setError(getErrorMessage(cause, '가입하지 못했어요.'))
    } finally {
      if (actionTokenRef.current === token) { actionTokenRef.current = null; setBusy('') }
    }
  }
  const create = async (event: FormEvent) => {
    event.preventDefault()
    if (actionTokenRef.current) return
    const normalizedDomain = normalizeInstitutionEmailDomain(emailDomain)
    const normalizedManagerEmail = managerEmail.trim().toLowerCase()
    if (!normalizedDomain) { setError('기관 이메일 도메인을 @example.org 형식으로 입력해 주세요.'); return }
    if (!emailUsesInstitutionDomain(normalizedManagerEmail, normalizedDomain)) {
      setError(`스페이스 관리자 이메일은 ${normalizedDomain} 도메인을 사용해야 합니다.`); return
    }
    const token = Symbol('create')
    actionTokenRef.current = token
    setBusy('create'); setError(''); setMessage('')
    try {
      const result = await createSpace({ name, slug, description, emailDomain: normalizedDomain, managerEmail: normalizedManagerEmail, managerNickname, managerPassword: managerPassword || undefined, reason: '관리자 화면에서 스페이스와 별도 관리자 생성' })
      setCreatedSpace({ slug: result.space.slug, managerEmail: result.manager.email, managerPassword: result.manager.password })
      await refresh()
    } catch (cause) { setError(getErrorMessage(cause, '스페이스를 만들지 못했어요.')) }
    finally { if (actionTokenRef.current === token) { actionTokenRef.current = null; setBusy('') } }
  }
  const canCreate = ['admin', 'super_admin'].includes(user?.role ?? '')
  const openCreateSpace = () => {
    setName(''); setSlug(''); setDescription(''); setEmailDomain(''); setManagerEmail(''); setManagerNickname(''); setManagerPassword(''); setCreatedSpace(null); setError(''); setMessage(''); setCreateOpen(true)
  }
  const copyAdminUrl = async () => {
    const value = slug
    setError(''); setMessage('')
    const copied = await copyText(`${window.location.origin}/spaces/${value}/admin`)
    if (createSlugRef.current !== value) return
    if (copied) setMessage('관리 URL을 복사했어요.')
    else setError('관리 URL을 복사하지 못했어요. 스페이스 생성 후 주소창에서 복사해 주세요.')
  }
  const copyManagerCredentials = async () => {
    if (!createdSpace) return
    const copied = await copyText(`${createdSpace.managerEmail}\n${createdSpace.managerPassword}`)
    if (copied) setMessage('스페이스 관리자 로그인 정보를 복사했어요.')
    else setError('로그인 정보를 복사하지 못했어요. 화면에서 직접 선택해 주세요.')
  }

  return <div className="content-page spaces-page"><PageHeader eyebrow="ORGANIZATION SPACES" title="함께 운영할 공간이에요." description="회사, 행사, 동아리 등 단체별 멤버와 전용 카드·게임을 분리해 관리하세요." />
    {(loadError || error || message) && <p className={`friends-notice ${loadError || error ? 'is-error' : ''}`} role={loadError || error ? 'alert' : 'status'}>{loadError || error || message}</p>}
    {loadError && !loading && <button className="secondary-button resource-retry" onClick={() => void refresh()}>스페이스 다시 불러오기</button>}
    <section className="space-join-panel"><div><Link2 /><span><strong>가입 코드가 있나요?</strong><small>8자리 코드를 입력하면 스페이스 멤버가 됩니다.</small></span></div><form onSubmit={join}><input aria-label="스페이스 가입 코드" value={joinCode} disabled={Boolean(busy)} onChange={event => { joinCodeVersionRef.current += 1; setJoinCode(event.target.value.toUpperCase().replace(/[^A-F0-9]/g, '').slice(0, 8)); setError(''); setMessage('') }} placeholder="A1B2C3D4" minLength={8} maxLength={8} required /><button disabled={Boolean(busy)}>{busy === 'join' ? '가입 중...' : '가입하기'}</button></form></section>
    <section className="space-directory"><header><div><h2>내 스페이스</h2><p>{loading ? '불러오는 중...' : `${spaces.length}개 스페이스에 참여 중이에요.`}</p></div>{canCreate && <button className="primary-button" disabled={Boolean(busy)} onClick={openCreateSpace}><Plus /> 스페이스 생성</button>}</header>
      {loading ? <div className="admin-loading"><span /><span /><span /></div> : spaces.length ? <div className="space-directory-grid">{spaces.map(space => <article key={space.id}><span><Building2 /></span><div><i>{space.status}</i><h3>{space.name}</h3><p>{space.description || '등록된 설명이 없습니다.'}</p><small>{space.slug} · {space.role === 'owner' ? '소유자' : space.role === 'manager' ? '관리자' : '멤버'}</small></div><div><Link className="secondary-button" to={`/create?space=${encodeURIComponent(space.id)}`}>전용 방 만들기 <ArrowRight /></Link>{(['owner', 'manager'].includes(space.role) || canCreate) && <Link className="text-button" to={`/spaces/${encodeURIComponent(space.slug)}/admin`}><ShieldCheck /> 관리</Link>}</div></article>)}</div> : <div className="admin-empty"><UsersRound /><strong>가입한 스페이스가 없어요.</strong><p>가입 코드로 참여하거나 플랫폼 관리자에게 생성을 요청하세요.</p></div>}
    </section>
    {createOpen && <div className="admin-modal-backdrop" onMouseDown={event => { if (event.target === event.currentTarget && !busy && !createdSpace) setCreateOpen(false) }}><form className="admin-modal space-create-modal" role="dialog" aria-modal="true" aria-labelledby="create-space-title" onSubmit={create}><span><Building2 /></span><h2 id="create-space-title">스페이스 생성</h2>{createdSpace ? <><p>스페이스와 별도 관리자 계정을 만들었어요.</p><div className="space-created-manager" role="status"><strong>스페이스 관리자 로그인 정보</strong><code>{createdSpace.managerEmail}</code><code>{createdSpace.managerPassword}</code><small>임시 비밀번호는 이 화면을 닫으면 다시 표시되지 않습니다.</small></div><div><button type="button" className="secondary-button" onClick={() => void copyManagerCredentials()}><Copy /> 로그인 정보 복사</button><button type="button" className="full-button" onClick={() => navigate(`/spaces/${encodeURIComponent(createdSpace.slug)}/admin`)}>관리 화면 열기</button></div></> : <><p>기관 도메인과 별도 스페이스 관리자를 함께 지정합니다.</p><fieldset><legend>스페이스 정보</legend><label>이름<input value={name} onChange={event => setName(event.target.value)} minLength={2} maxLength={80} required disabled={Boolean(busy)} /></label><label>Slug<input value={slug} onChange={event => setSlug(event.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '').slice(0, 49))} minLength={3} placeholder="team-event" required disabled={Boolean(busy)} /></label><label>기관 이메일 도메인<input value={emailDomain} onChange={event => setEmailDomain(event.target.value.toLowerCase().replace(/\s/g, ''))} onBlur={() => { const normalized = normalizeInstitutionEmailDomain(emailDomain); if (normalized) setEmailDomain(normalized) }} placeholder="@swonport.kr" required disabled={Boolean(busy)} /></label><small>가입 코드와 계정 생성에는 이 도메인의 이메일만 허용됩니다.</small><label>설명<textarea rows={3} value={description} onChange={event => setDescription(event.target.value)} disabled={Boolean(busy)} /></label></fieldset><fieldset><legend>별도 스페이스 관리자</legend><label>관리자 이메일<input type="email" value={managerEmail} onChange={event => setManagerEmail(event.target.value)} placeholder={normalizeInstitutionEmailDomain(emailDomain) ? `manager${normalizeInstitutionEmailDomain(emailDomain)}` : 'manager@swonport.kr'} required disabled={Boolean(busy)} /></label><label>관리자 표시 이름<input value={managerNickname} onChange={event => setManagerNickname(event.target.value)} minLength={2} maxLength={12} required disabled={Boolean(busy)} /></label><label>관리자 임시 비밀번호<input type="password" value={managerPassword} onChange={event => setManagerPassword(event.target.value)} minLength={managerPassword ? 12 : undefined} placeholder="비워두면 안전하게 자동 생성" disabled={Boolean(busy)} /></label></fieldset><div className="space-code-preview">관리 URL<span>/spaces/{slug || 'slug'}/admin</span><button type="button" aria-label="관리 URL 복사" disabled={Boolean(busy) || slug.length < 3} onClick={() => void copyAdminUrl()}><Copy /></button></div><div><button data-dialog-dismiss type="button" className="secondary-button" disabled={Boolean(busy)} onClick={() => setCreateOpen(false)}>취소</button><button className="full-button" disabled={Boolean(busy)}>{busy === 'create' ? '생성 중...' : '스페이스와 관리자 생성'}</button></div></>}</form></div>}
  </div>
}
