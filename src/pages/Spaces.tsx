import { ArrowLeft, ArrowRight, Building2, Check, Copy, Link2, Plus, ShieldCheck, UsersRound, X } from 'lucide-react'
import { FormEvent, useCallback, useEffect, useRef, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { useAuth } from '../auth/AuthContext'
import PageHeader from '../components/PageHeader'
import { copyText } from '../lib/clipboard'
import { normalizeInstitutionEmailDomain } from '../lib/emailDomain'
import { getErrorMessage } from '../lib/errorMessage'
import { checkSpaceSlug, createSpace, fetchMySpaces, joinSpace, type CreatedCredential, type MySpace } from '../lib/spaces'

type ManagerMode = 'none' | 'create' | 'existing'
interface CreateDraft {
  name: string; slug: string; description: string; emailDomains: string[]; domainInput: string
  joinPolicy: 'code' | 'invite_only' | 'closed'; joinEnabled: boolean
  managerMode: ManagerMode; managerEmail: string; managerNickname: string; managerPassword: string
}

const blankDraft: CreateDraft = { name: '', slug: '', description: '', emailDomains: [], domainInput: '', joinPolicy: 'code', joinEnabled: true, managerMode: 'none', managerEmail: '', managerNickname: '', managerPassword: '' }
function slugFromName(name: string) {
  const ascii = name.normalize('NFKD').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 49)
  return ascii.length >= 3 ? ascii : `space-${Math.random().toString(36).slice(2, 8)}`
}

export default function Spaces() {
  const { user } = useAuth()
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const requestedJoinCode = params.get('code')?.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8) ?? ''
  const [spaces, setSpaces] = useState<MySpace[]>([])
  const [joinCode, setJoinCode] = useState(requestedJoinCode)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState('')
  const [loadError, setLoadError] = useState('')
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const [createOpen, setCreateOpen] = useState(false)
  const [step, setStep] = useState(1)
  const [draft, setDraft] = useState<CreateDraft>(blankDraft)
  const [slugManual, setSlugManual] = useState(false)
  const [slugState, setSlugState] = useState<'idle' | 'checking' | 'available' | 'taken' | 'invalid'>('idle')
  const [created, setCreated] = useState<{ slug: string; joinCode: string; manager: CreatedCredential | null } | null>(null)
  const refreshRef = useRef<Promise<MySpace[]> | null>(null)
  const lastJoinCodeRef = useRef(requestedJoinCode)
  const joinVersionRef = useRef(0)

  const refresh = useCallback(async () => {
    setLoading(true)
    if (!refreshRef.current) refreshRef.current = fetchMySpaces().finally(() => { refreshRef.current = null })
    try { setSpaces(await refreshRef.current); setLoadError('') }
    catch { setLoadError('스페이스를 불러오지 못했어요. 잠시 후 다시 시도해 주세요.') }
    finally { setLoading(false) }
  }, [])
  useEffect(() => { void refresh() }, [refresh])
  useEffect(() => {
    if (lastJoinCodeRef.current === requestedJoinCode) return
    lastJoinCodeRef.current = requestedJoinCode
    joinVersionRef.current += 1
    setJoinCode(requestedJoinCode); setError(''); setMessage('')
  }, [requestedJoinCode])
  useEffect(() => {
    if (!createOpen || draft.slug.length < 3) { setSlugState(draft.slug ? 'invalid' : 'idle'); return }
    setSlugState('checking')
    const timer = window.setTimeout(() => {
      void checkSpaceSlug(draft.slug).then(result => setSlugState(result.available ? 'available' : 'taken')).catch(() => setSlugState('invalid'))
    }, 350)
    return () => window.clearTimeout(timer)
  }, [createOpen, draft.slug])

  const patchDraft = (next: Partial<CreateDraft>) => setDraft(current => ({ ...current, ...next }))
  const changeName = (value: string) => setDraft(current => ({ ...current, name: value, slug: slugManual ? current.slug : slugFromName(value) }))
  const addDomain = () => {
    const domain = normalizeInstitutionEmailDomain(draft.domainInput)
    if (!domain) { setError('도메인은 @example.org 형식으로 입력해 주세요.'); return }
    if (draft.emailDomains.includes(domain)) { patchDraft({ domainInput: '' }); return }
    if (draft.emailDomains.length >= 10) { setError('허용 도메인은 최대 10개까지 등록할 수 있어요.'); return }
    patchDraft({ emailDomains: [...draft.emailDomains, domain], domainInput: '' }); setError('')
  }
  const openCreate = () => { setDraft(blankDraft); setSlugManual(false); setSlugState('idle'); setStep(1); setCreated(null); setError(''); setMessage(''); setCreateOpen(true) }
  const closeCreate = () => { if (!busy) setCreateOpen(false) }
  const next = () => {
    setError('')
    if (step === 1 && (draft.name.trim().length < 2 || slugState !== 'available')) { setError('이름과 사용 가능한 slug를 확인해 주세요.'); return }
    if (step === 2 && draft.emailDomains.length === 0) { setError('가입 계정에 허용할 도메인을 하나 이상 추가해 주세요.'); return }
    if (step === 3 && draft.managerMode !== 'none') {
      const domainOk = draft.emailDomains.some(domain => draft.managerEmail.trim().toLowerCase().endsWith(domain))
      if (!domainOk) { setError('관리자 이메일이 허용 도메인과 일치해야 합니다.'); return }
      if (draft.managerMode === 'create' && draft.managerNickname.trim().length < 2) { setError('새 관리자 표시 이름을 입력해 주세요.'); return }
      if (draft.managerPassword && draft.managerPassword.length < 12) { setError('임시 비밀번호는 12자 이상이어야 합니다.'); return }
    }
    setStep(current => Math.min(4, current + 1))
  }
  const create = async () => {
    if (busy) return
    setBusy('create'); setError('')
    try {
      const result = await createSpace({
        name: draft.name.trim(), slug: draft.slug, description: draft.description.trim(), emailDomains: draft.emailDomains,
        joinPolicy: draft.joinPolicy, joinEnabled: draft.joinEnabled,
        managerMode: draft.managerMode, managerEmail: draft.managerMode === 'none' ? undefined : draft.managerEmail.trim().toLowerCase(),
        managerNickname: draft.managerMode === 'create' ? draft.managerNickname.trim() : undefined,
        managerPassword: draft.managerMode === 'create' && draft.managerPassword ? draft.managerPassword : undefined,
      })
      setCreated({ slug: result.space.slug, joinCode: result.space.join_code, manager: result.manager }); setStep(5); await refresh()
    } catch (cause) { setError(getErrorMessage(cause, '스페이스를 만들지 못했어요.')) }
    finally { setBusy('') }
  }
  const join = async (event: FormEvent) => {
    event.preventDefault(); if (busy) return
    const version = joinVersionRef.current
    setBusy('join'); setError(''); setMessage('')
    try { const joined = await joinSpace(joinCode); if (joinVersionRef.current === version) { setMessage(`${joined.name}에 가입했어요.`); setJoinCode(''); joinVersionRef.current += 1 }; await refresh() }
    catch (cause) { if (joinVersionRef.current === version) setError(getErrorMessage(cause, '가입하지 못했어요.')) }
    finally { setBusy('') }
  }
  const canCreate = ['admin', 'super_admin'].includes(user?.role ?? '')
  const copyCredentials = async () => {
    if (!created?.manager?.password) return
    const done = await copyText(`${created.manager.email}\n${created.manager.password}`)
    setMessage(done ? '관리자 로그인 정보를 복사했어요.' : '복사하지 못했어요.')
  }

  return <div className="content-page spaces-page">
    <PageHeader eyebrow="ORGANIZATION SPACES" title="함께 운영할 공간이에요." description="회사, 행사, 동아리별 멤버와 전용 카드·게임을 분리해 관리하세요." />
    {(loadError || error || message) && <p className={`friends-notice ${loadError || error ? 'is-error' : ''}`} role={loadError || error ? 'alert' : 'status'}>{loadError || error || message}</p>}
    {loadError && !loading && <button className="secondary-button resource-retry" onClick={() => void refresh()}>스페이스 다시 불러오기</button>}
    <section className="space-join-panel"><div><Link2 /><span><strong>가입 코드가 있나요?</strong><small>8자리 코드를 입력하면 스페이스 멤버가 됩니다.</small></span></div><form onSubmit={join}><input aria-label="스페이스 가입 코드" value={joinCode} disabled={Boolean(busy)} onChange={event => setJoinCode(event.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8))} placeholder="A1B2C3D4" minLength={8} maxLength={8} required /><button disabled={Boolean(busy)}>{busy === 'join' ? '가입 중...' : '가입하기'}</button></form></section>
    <section className="space-directory"><header><div><h2>내 스페이스</h2><p>{loading ? '불러오는 중...' : `${spaces.length}개 스페이스에 참여 중이에요.`}</p></div>{canCreate && <button className="primary-button" onClick={openCreate}><Plus /> 스페이스 생성</button>}</header>
      {loading ? <div className="admin-loading"><span /><span /><span /></div> : spaces.length ? <div className="space-directory-grid">{spaces.map(space => <article key={space.id}><span><Building2 /></span><div><i>{space.status}</i><h3>{space.name}</h3><p>{space.description || '등록된 설명이 없습니다.'}</p><small>{space.slug} · {space.role === 'owner' ? '소유자' : space.role === 'manager' ? '관리자' : '멤버'}</small></div><div><Link className="secondary-button" to={`/create?space=${encodeURIComponent(space.id)}`}>전용 방 만들기 <ArrowRight /></Link>{(['owner', 'manager'].includes(space.role) || canCreate) && <Link className="text-button" to={`/spaces/${encodeURIComponent(space.slug)}/admin`}><ShieldCheck /> 관리</Link>}</div></article>)}</div> : <div className="admin-empty"><UsersRound /><strong>가입한 스페이스가 없어요.</strong><p>가입 코드로 참여하거나 플랫폼 관리자에게 생성을 요청하세요.</p></div>}
    </section>

    {createOpen && <div className="admin-modal-backdrop" onMouseDown={event => { if (event.target === event.currentTarget) closeCreate() }}><section className="admin-modal space-create-modal space-wizard" role="dialog" aria-modal="true" aria-labelledby="create-space-title">
      <header><div><span><Building2 /></span><div><small>SPACE CREATION</small><h2 id="create-space-title">스페이스 생성</h2></div></div><button aria-label="닫기" onClick={closeCreate}><X /></button></header>
      <ol className="space-wizard-steps" aria-label="생성 단계">{['기본 정보', '가입 정책', '관리자', '검토', '완료'].map((label, index) => <li key={label} className={step >= index + 1 ? 'is-active' : ''}><span>{step > index + 1 ? <Check /> : index + 1}</span><small>{label}</small></li>)}</ol>
      {error && <p className="space-form-error" role="alert">{error}</p>}
{step === 1 && <div className="space-wizard-body"><h3>기본 정보</h3><p>이름과 URL 주소는 나중에도 변경할 수 있고, 이전 주소는 안전하게 유지됩니다.</p><label>스페이스 이름<input data-testid="space-name" value={draft.name} onChange={event => changeName(event.target.value)} minLength={2} maxLength={80} /></label><label>Slug<div className="space-slug-input"><input data-testid="space-slug" value={draft.slug} onChange={event => { setSlugManual(true); patchDraft({ slug: event.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '').slice(0, 49) }) }} minLength={3} /><span className={`slug-state is-${slugState}`}>{slugState === 'checking' ? '확인 중' : slugState === 'available' ? '사용 가능' : slugState === 'taken' ? '사용 중' : slugState === 'invalid' ? '확인 필요' : ''}</span></div></label><label>설명<textarea rows={3} value={draft.description} onChange={event => patchDraft({ description: event.target.value })} maxLength={500} /></label></div>}
      {step === 2 && <div className="space-wizard-body"><h3>가입 정책</h3><p>가입 코드로 참여할 수 있는 기관 이메일 도메인을 최대 10개 지정하세요.</p><label>허용 이메일 도메인<div className="space-domain-input"><input value={draft.domainInput} onChange={event => patchDraft({ domainInput: event.target.value.toLowerCase().replace(/\s/g, '') })} placeholder="@example.org" onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); addDomain() } }} /><button onClick={addDomain}>추가</button></div></label><div className="space-domain-chips">{draft.emailDomains.map(domain => <button key={domain} onClick={() => patchDraft({ emailDomains: draft.emailDomains.filter(item => item !== domain) })}>{domain}<X /></button>)}</div><label>가입 방식<select value={draft.joinPolicy} onChange={event => patchDraft({ joinPolicy: event.target.value as CreateDraft['joinPolicy'] })}><option value="code">가입 코드</option><option value="invite_only">초대 전용</option><option value="closed">가입 중지</option></select></label><label className="space-toggle"><input type="checkbox" checked={draft.joinEnabled} onChange={event => patchDraft({ joinEnabled: event.target.checked })} /> 가입 기능 활성화</label><p className="space-policy-note"><ShieldCheck /> 코드는 생성 직후 발급됩니다. 만료 시간과 초대 전용/가입 중지는 관리 화면에서 설정할 수 있어요.</p></div>}
      {step === 3 && <div className="space-wizard-body"><h3>초기 관리자</h3><p>플랫폼 관리자가 소유자가 됩니다. 별도 관리자는 지금 지정하지 않아도 됩니다.</p><div className="space-manager-options">{([['none', '지금 지정 안 함', '나중에 멤버 화면에서 추가'], ['create', '전용 계정 생성', '임시 비밀번호를 한 번만 표시'], ['existing', '기존 계정 연결', '가입된 계정의 비밀번호는 건드리지 않음']] as const).map(option => <button key={option[0]} className={draft.managerMode === option[0] ? 'is-selected' : ''} onClick={() => patchDraft({ managerMode: option[0] })}><strong>{option[1]}</strong><small>{option[2]}</small></button>)}</div>{draft.managerMode !== 'none' && <><label>관리자 이메일<input type="email" value={draft.managerEmail} onChange={event => patchDraft({ managerEmail: event.target.value })} placeholder={`manager${draft.emailDomains[0] ?? '@example.org'}`} /></label>{draft.managerMode === 'create' && <><label>표시 이름<input value={draft.managerNickname} onChange={event => patchDraft({ managerNickname: event.target.value })} minLength={2} maxLength={12} /></label><label>임시 비밀번호<input type="password" value={draft.managerPassword} onChange={event => patchDraft({ managerPassword: event.target.value })} placeholder="비워두면 안전하게 자동 생성" /></label></>}</>}</div>}
      {step === 4 && <div className="space-wizard-body"><h3>생성 전 확인</h3><dl className="space-review"><div><dt>이름</dt><dd>{draft.name}</dd></div><div><dt>관리 URL</dt><dd>/spaces/{draft.slug}/admin</dd></div><div><dt>허용 도메인</dt><dd>{draft.emailDomains.join(', ')}</dd></div><div><dt>초기 관리자</dt><dd>{draft.managerMode === 'none' ? '지정 안 함' : `${draft.managerEmail} (${draft.managerMode === 'create' ? '전용 계정 생성' : '기존 계정 연결'})`}</dd></div></dl><p className="space-policy-note"><ShieldCheck /> 생성 작업은 중복 실행이 방지되며, 중간 실패 시 생성된 전용 계정과 스페이스가 함께 롤백됩니다.</p></div>}
{step === 5 && created && <div className="space-wizard-body space-wizard-complete"><span><Check /></span><h3>스페이스를 만들었어요.</h3><p>관리 화면에서 멤버, 방, 게임, 카드, 감사 기록과 가입 정책을 관리할 수 있습니다.</p><div className="space-success-links"><code>/spaces/{created.slug}/admin</code><button className="secondary-button" onClick={() => void copyText(`${window.location.origin}/spaces/${created.slug}/admin`)}><Copy /> 관리 URL 복사</button><code>/spaces?code={created.joinCode}</code><button className="secondary-button" onClick={() => void copyText(`${window.location.origin}/spaces?code=${created.joinCode}`)}><Link2 /> 가입 링크 복사</button></div>{created.manager?.password && <div className="space-created-manager"><strong>임시 로그인 정보 — 이 화면에서만 표시됩니다</strong><code>{created.manager.email}</code><code>{created.manager.password}</code><button className="secondary-button" onClick={() => void copyCredentials()}><Copy /> 복사</button></div>}</div>}
      <footer>{step < 5 && <><button className="secondary-button" disabled={step === 1 || Boolean(busy)} onClick={() => { setError(''); setStep(current => current - 1) }}><ArrowLeft /> 이전</button>{step < 4 ? <button className="primary-button" onClick={next}>다음 <ArrowRight /></button> : <button data-testid="create-space-submit" className="primary-button" disabled={Boolean(busy)} onClick={() => void create()}>{busy ? '생성 중...' : '스페이스 생성'}</button>}</>}{step === 5 && <><button className="secondary-button" onClick={closeCreate}>닫기</button><button className="primary-button" onClick={() => navigate(`/spaces/${encodeURIComponent(created?.slug ?? '')}/admin`)}>관리 화면 열기 <ArrowRight /></button></>}</footer>
    </section></div>}
  </div>
}
