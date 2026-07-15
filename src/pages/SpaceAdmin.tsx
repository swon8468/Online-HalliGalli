import { Archive, ArrowLeft, ArrowRight, Building2, Check, Copy, DoorOpen, Download, FileClock, FileUp, Gamepad2, KeyRound, Link2, RefreshCw, Save, Search, ShieldCheck, Trash2, UserCog, UserPlus, UsersRound, X } from 'lucide-react'
import { ChangeEvent, FormEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import PageHeader from '../components/PageHeader'
import { copyText } from '../lib/clipboard'
import { getErrorMessage } from '../lib/errorMessage'
import { credentialsCsv, downloadTextFile, parseSpaceAccountsCsv, SPACE_CSV_TEMPLATE, validateSpaceAccountRows, type CsvPreviewRow } from '../lib/spaceCsv'
import {
  addExistingSpaceMember, bulkCreateSpaceAccounts, bulkUpdateSpaceMembers, closeSpaceRoom, createSpaceAccount, deleteManagedSpaceAccount,
  loadSpaceAudit, loadSpaceCards, loadSpaceGames, loadSpaceMembers, loadSpaceOverview, loadSpaceRooms, reactivateManagedSpaceAccount,
  removeSpaceMember, resetManagedSpacePassword, rotateSpaceCode, suspendManagedSpaceAccount, transferSpaceOwner, updateManagedSpaceAccount,
  updateSpace, updateSpaceMember, type CreatedCredential, type JoinPolicy, type PageResult, type SpaceAccountInput, type SpaceAuditView,
  type SpaceCardSetView, type SpaceGameView, type SpaceMemberView, type SpaceOverview, type SpaceRoomView,
} from '../lib/spaces'

type SpaceTab = 'overview' | 'members' | 'rooms' | 'games' | 'cards' | 'audit' | 'settings'
type MemberFormMode = 'existing' | 'create' | 'csv'
interface PendingConfirmation { title: string; description: string; confirmLabel: string; action: () => Promise<void> }
const emptyPage = <T,>(): PageResult<T> => ({ items: [], page: 1, pageSize: 25, total: 0 })
const labels: Record<SpaceTab, string> = { overview: '개요', members: '멤버', rooms: '방', games: '게임', cards: '카드', audit: '감사 기록', settings: '설정' }
const actionLabels: Record<string, string> = {
  create_space: '스페이스 생성', update_space: '설정 변경', archive_space: '보관', restore_space: '복원', add_space_member: '멤버 추가',
  remove_space_member: '멤버 제외', change_space_role: '역할 변경', transfer_space_owner: '소유권 이전', space_account_update: '계정 정보 변경',
  space_account_reset: '비밀번호 재발급', space_account_suspend: '계정 정지', space_account_reactivate: '계정 재활성화',
  space_account_delete: '관리 계정 삭제', bulk_create_space_members: '계정 일괄 생성', bulk_update_space_members: '멤버 일괄 작업',
  space_access_denied: '관리 접근 거부', close_space_room: '방 종료',
}

function formatDate(value?: string | null) { return value ? new Intl.DateTimeFormat('ko-KR', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value)) : '-' }
function profileName(value: SpaceAuditView['profiles']) { return (Array.isArray(value) ? value[0] : value)?.nickname ?? '알 수 없음' }
function roomOf(game: SpaceGameView) { return Array.isArray(game.rooms) ? game.rooms[0] : game.rooms }

export default function SpaceAdmin() {
  const { slug = '' } = useParams()
  const navigate = useNavigate()
  const [overview, setOverview] = useState<SpaceOverview | null>(null)
  const [tab, setTab] = useState<SpaceTab>('overview')
  const [loading, setLoading] = useState(true)
  const [panelLoading, setPanelLoading] = useState(false)
  const [busy, setBusy] = useState('')
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const [page, setPage] = useState(1)
  const [search, setSearch] = useState('')
  const [roleFilter, setRoleFilter] = useState('all')
  const [kindFilter, setKindFilter] = useState('all')
  const [statusFilter, setStatusFilter] = useState('all')
  const [members, setMembers] = useState(emptyPage<SpaceMemberView>())
  const [rooms, setRooms] = useState(emptyPage<SpaceRoomView>())
  const [games, setGames] = useState(emptyPage<SpaceGameView>())
  const [cards, setCards] = useState(emptyPage<SpaceCardSetView>())
  const [audit, setAudit] = useState(emptyPage<SpaceAuditView>())
  const [selected, setSelected] = useState<string[]>([])
  const [memberOpen, setMemberOpen] = useState(false)
  const [memberMode, setMemberMode] = useState<MemberFormMode>('existing')
  const [account, setAccount] = useState<SpaceAccountInput>({ email: '', nickname: '', password: '', role: 'member', externalId: '' })
  const [csvRows, setCsvRows] = useState<CsvPreviewRow[]>([])
  const [credentials, setCredentials] = useState<CreatedCredential[]>([])
  const [target, setTarget] = useState<SpaceMemberView | null>(null)
  const [confirmation, setConfirmation] = useState<PendingConfirmation | null>(null)
  const [editNickname, setEditNickname] = useState('')
  const [editExternalId, setEditExternalId] = useState('')
  const [name, setName] = useState('')
  const [spaceSlug, setSpaceSlug] = useState('')
  const [description, setDescription] = useState('')
  const [joinEnabled, setJoinEnabled] = useState(true)
  const [joinPolicy, setJoinPolicy] = useState<JoinPolicy>('code')
  const [joinExpires, setJoinExpires] = useState('')
  const [domainsText, setDomainsText] = useState('')
  const overviewVersionRef = useRef(0)
  const activeSpaceIdRef = useRef<string | null>(null)

  const syncSettings = useCallback((value: SpaceOverview) => {
    setName(value.space.name); setSpaceSlug(value.space.slug); setDescription(value.space.description ?? '')
    setJoinEnabled(value.space.joinEnabled); setJoinPolicy(value.space.joinPolicy)
    setJoinExpires(value.space.joinCodeExpiresAt ? value.space.joinCodeExpiresAt.slice(0, 16) : '')
    setDomainsText(value.space.emailDomains.join('\n'))
  }, [])
  const refreshOverview = useCallback(async () => {
    const version = ++overviewVersionRef.current
    const value = await loadSpaceOverview(slug)
    if (version !== overviewVersionRef.current) return value
    activeSpaceIdRef.current = value.space.id
    setOverview(value); syncSettings(value)
    if (value.space.slug !== slug) navigate(`/spaces/${encodeURIComponent(value.space.slug)}/admin`, { replace: true })
    return value
  }, [navigate, slug, syncSettings])
  useEffect(() => {
    let active = true; setLoading(true); setError('')
    void refreshOverview().catch(cause => { if (active) setError(getErrorMessage(cause, '관리 화면을 불러오지 못했어요.')) }).finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [refreshOverview])
  useEffect(() => {
    setMemberOpen(false); setTarget(null); setConfirmation(null); setCredentials([]); setSelected([]); setError(''); setMessage('')
  }, [slug])

  const refreshPanel = useCallback(async () => {
    if (!overview || tab === 'overview' || tab === 'settings') return
    setPanelLoading(true)
    const options = { page, pageSize: 25, search, roleFilter: roleFilter as 'all' | 'member' | 'manager' | 'owner', kindFilter: kindFilter as 'all' | 'managed' | 'existing', statusFilter }
    try {
      if (tab === 'members') setMembers((await loadSpaceMembers(overview.space.id, options)).data)
      if (tab === 'rooms') setRooms((await loadSpaceRooms(overview.space.id, options)).data)
      if (tab === 'games') setGames((await loadSpaceGames(overview.space.id, options)).data)
      if (tab === 'cards') setCards((await loadSpaceCards(overview.space.id, options)).data)
      if (tab === 'audit') setAudit((await loadSpaceAudit(overview.space.id, options)).data)
      setError('')
    } catch (cause) { setError(getErrorMessage(cause, '목록을 불러오지 못했어요.')) }
    finally { setPanelLoading(false) }
  }, [kindFilter, overview, page, roleFilter, search, statusFilter, tab])
  useEffect(() => { const timer = window.setTimeout(() => void refreshPanel(), search ? 300 : 0); return () => window.clearTimeout(timer) }, [refreshPanel, search])
  useEffect(() => { setPage(1); setSelected([]); setSearch(''); setRoleFilter('all'); setKindFilter('all'); setStatusFilter('all') }, [tab])

  const run = async (key: string, action: () => Promise<unknown>, success: string, refreshMembers = false) => {
    if (busy) return
    setBusy(key); setError(''); setMessage('')
    try { await action(); setMessage(success); await refreshOverview(); if (refreshMembers || tab !== 'overview') await refreshPanel() }
    catch (cause) { setError(getErrorMessage(cause, '작업을 완료하지 못했어요.')) }
    finally { setBusy('') }
  }
  const pageData = tab === 'members' ? members : tab === 'rooms' ? rooms : tab === 'games' ? games : tab === 'cards' ? cards : audit
  const totalPages = Math.max(1, Math.ceil(pageData.total / pageData.pageSize))
  const canOwn = overview?.actor.canOwn ?? false
  const canManage = overview?.actor.canManage ?? false
  const selectedMembers = useMemo(() => members.items.filter(item => selected.includes(item.userId)), [members.items, selected])

  const submitMember = async (event: FormEvent) => {
    event.preventDefault(); if (!overview || busy) return
    const sourceSpaceId = overview.space.id
    let nextCredentials: CreatedCredential[] = []
    setBusy('member'); setError('')
    try {
      if (memberMode === 'existing') await addExistingSpaceMember(overview.space.id, account)
      if (memberMode === 'create') { const result = await createSpaceAccount(overview.space.id, account); nextCredentials = [result.account] }
      if (memberMode === 'csv') {
        const included = csvRows.filter(row => row.included && row.errors.length === 0)
        if (!included.length) throw new Error('등록할 정상 행을 하나 이상 선택해 주세요.')
        const result = await bulkCreateSpaceAccounts(overview.space.id, included.map(row => ({ email: row.email, nickname: row.nickname, role: row.role, externalId: row.externalId, password: row.password })))
        nextCredentials = result.accounts
      }
      if (activeSpaceIdRef.current !== sourceSpaceId) return
      if (nextCredentials.length) setCredentials(nextCredentials)
      setMessage(memberMode === 'existing' ? '기존 계정을 연결했어요.' : '관리 계정을 생성했어요. 임시 비밀번호는 지금만 확인할 수 있습니다.')
      setAccount({ email: '', nickname: '', password: '', role: 'member', externalId: '' }); setCsvRows([]); setMemberOpen(false)
      await refreshOverview(); await refreshPanel()
    } catch (cause) { setError(getErrorMessage(cause, '멤버를 추가하지 못했어요.')) }
    finally { setBusy('') }
  }
  const readCsv = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]; if (!file || !overview) return
    try { if (file.size > 1_000_000) throw new Error('CSV 파일은 1MB 이하여야 합니다.'); setCsvRows(parseSpaceAccountsCsv(await file.text(), overview.space.emailDomains)); setError('') }
    catch (cause) { setError(getErrorMessage(cause, 'CSV를 읽지 못했어요.')) }
    finally { event.target.value = '' }
  }
  const openTarget = (member: SpaceMemberView) => { setTarget(member); setEditNickname(member.nickname); setEditExternalId(member.externalId ?? ''); setError('') }
  const targetAction = async (key: string, action: () => Promise<unknown>, success: string, credentialEmail?: string) => {
    if (!overview) return
    setBusy(key); setError('')
    try {
      const result = await action()
      if (key === 'reset' && result && typeof result === 'object' && 'credential' in result) setCredentials([{ email: credentialEmail ?? '', password: (result as { credential: { password: string } }).credential.password }])
      setMessage(success); setTarget(null); await refreshOverview(); await refreshPanel()
    } catch (cause) { setError(getErrorMessage(cause, '계정 작업을 완료하지 못했어요.')) }
    finally { setBusy('') }
  }
  const doBulk = async (operation: 'remove' | 'suspend' | 'role', role?: 'member' | 'manager') => {
    if (!overview || !selected.length) return
    await run('bulk', async () => {
      const result = await bulkUpdateSpaceMembers(overview.space.id, selected.map(userId => ({ userId, operation, role })))
      const failed = result.results.filter(item => !item.ok)
      if (failed.length) throw new Error(`${result.results.length - failed.length}건 성공, ${failed.length}건 실패: ${failed.map(item => item.error).join(', ')}`)
      setSelected([])
    }, `${selected.length}명의 일괄 작업을 완료했어요.`, true)
  }
  const confirmPending = async () => {
    if (!confirmation || busy) return
    const action = confirmation.action
    await action()
    setConfirmation(null)
  }

  if (loading) return <div className="content-page space-admin-page"><div className="admin-loading"><span /><span /><span /></div></div>
  if (!overview) return <div className="content-page space-admin-page"><PageHeader eyebrow="SPACE ADMIN" title="관리 화면을 열 수 없어요." description="권한 또는 네트워크 상태를 확인해 주세요." />{error && <p className="friends-notice is-error" role="alert">{error}</p>}<div className="space-load-actions"><Link className="secondary-button" to="/spaces">스페이스 목록으로</Link><button className="primary-button" disabled={loading} onClick={() => { setLoading(true); setError(''); void refreshOverview().catch(cause => setError(getErrorMessage(cause, '관리 화면을 불러오지 못했어요.'))).finally(() => setLoading(false)) }}>스페이스 다시 불러오기</button></div></div>

  return <div className="content-page space-admin-page">
    <PageHeader eyebrow="SPACE OPERATIONS" title={overview.space.name} description={`${overview.space.slug} · ${overview.actor.spaceRole === 'owner' ? '소유자' : overview.actor.spaceRole === 'manager' ? '관리자' : overview.actor.platformRole}`} />
    {overview.actor.piiMasked && <p className="space-readonly-notice"><ShieldCheck /> 지원 계정은 개인정보가 마스킹된 읽기 전용 화면입니다.</p>}
    {(error || message) && <p className={`friends-notice ${error ? 'is-error' : ''}`} role={error ? 'alert' : 'status'}>{error || message}</p>}
    {credentials.length > 0 && <section className="space-credentials" role="status"><strong>임시 로그인 정보 — 닫으면 다시 표시되지 않습니다</strong>{credentials.map(item => <code key={item.email}>{item.email} · {item.password ?? '(비밀번호 없음)'}</code>)}<div><button onClick={() => void copyText(credentials.map(item => `${item.email},${item.password ?? ''}`).join('\n'))}><Copy /> 복사</button><button onClick={() => downloadTextFile(`${overview.space.slug}-credentials.csv`, credentialsCsv(credentials))}><Download /> CSV 저장</button><button onClick={() => setCredentials([])}><X /> 닫기</button></div></section>}
    <nav className="space-tabs space-tabs--seven" aria-label="스페이스 관리 메뉴">{(Object.keys(labels) as SpaceTab[]).map(item => <button key={item} className={tab === item ? 'is-active' : ''} onClick={() => setTab(item)}>{labels[item]}</button>)}</nav>

    {tab === 'overview' && <><section className="space-metrics">{[
      ['전체 멤버', overview.metrics.members, '가입 계정'], ['활성 방', overview.metrics.activeRooms, `전체 ${overview.metrics.rooms}개`],
      ['완료 게임', overview.metrics.finishedGames, `전체 ${overview.metrics.games}개`], ['감사 기록', overview.metrics.audit, '변경 이력'],
    ].map(item => <article key={item[0]}><span>{item[0]}</span><strong>{item[1]}</strong><small>{item[2]}</small></article>)}</section>
{!overview.actor.piiMasked && <section className="admin-section space-invite-card"><div><Link2 /><span><strong>가입 코드</strong><small>{overview.space.joinPolicy === 'code' && overview.space.joinEnabled ? '허용 도메인의 사용자가 참여할 수 있습니다.' : '현재 코드 가입이 중지되어 있습니다.'}</small></span></div><code>{overview.space.joinCode}</code><div><button className="secondary-button" onClick={() => void copyText(overview.space.joinCode)}><Copy /> 복사</button>{canOwn && <button className="secondary-button" disabled={Boolean(busy)} onClick={() => void run('rotate', () => rotateSpaceCode(overview.space.id, overview.space.joinCodeExpiresAt), '가입 코드를 새로 발급했어요.')}><RefreshCw /> 재발급</button>}</div></section>}
      <section className="admin-section space-ops-summary"><header><div><Building2 /><span><strong>운영 상태</strong><small>현재 설정과 관리 권한</small></span></div></header><dl><div><dt>상태</dt><dd>{overview.space.status}</dd></div><div><dt>가입 방식</dt><dd>{overview.space.joinPolicy}</dd></div><div><dt>코드 만료</dt><dd>{formatDate(overview.space.joinCodeExpiresAt)}</dd></div><div><dt>허용 도메인</dt><dd>{overview.space.emailDomains.join(', ') || '제한 없음'}</dd></div></dl></section></>}

    {tab !== 'overview' && tab !== 'settings' && <section className="admin-section space-admin-panel"><header><div><h2>{labels[tab]}</h2><p>총 {pageData.total.toLocaleString()}건 · 서버 페이지 {page}/{totalPages}</p></div>{tab === 'members' && canManage && <button className="primary-button" onClick={() => { setMemberOpen(true); setMemberMode('existing'); setError('') }}><UserPlus /> 멤버 추가</button>}</header>
<div className="space-list-toolbar"><label><Search /><input aria-label={`${labels[tab]} 검색`} value={search} onChange={event => { setPage(1); setSearch(event.target.value) }} placeholder={tab === 'members' ? '이름, 이메일, 사번/학번' : '검색'} /></label>{tab === 'members' && <><select aria-label="역할 필터" value={roleFilter} onChange={event => { setPage(1); setRoleFilter(event.target.value) }}><option value="all">모든 역할</option><option value="owner">소유자</option><option value="manager">관리자</option><option value="member">멤버</option></select><select aria-label="계정 유형 필터" value={kindFilter} onChange={event => { setPage(1); setKindFilter(event.target.value) }}><option value="all">모든 계정</option><option value="managed">스페이스 전용</option><option value="existing">기존 계정</option></select><select aria-label="계정 상태 필터" value={statusFilter} onChange={event => { setPage(1); setStatusFilter(event.target.value) }}><option value="all">모든 상태</option><option value="active">활성</option><option value="suspended">정지</option><option value="deleted">삭제됨</option></select></>}{(['rooms', 'games'].includes(tab)) && <select aria-label="상태 필터" value={statusFilter} onChange={event => { setPage(1); setStatusFilter(event.target.value) }}><option value="all">모든 상태</option>{tab === 'rooms' ? <><option value="waiting">대기</option><option value="playing">게임 중</option><option value="closed">종료</option></> : <><option value="active">진행 중</option><option value="finished">완료</option></>}</select>}</div>
      {tab === 'members' && selected.length > 0 && <div className="space-bulk-bar"><strong>{selected.length}명 선택</strong><button onClick={() => void doBulk('role', 'member')}>멤버로</button>{canOwn && <button onClick={() => void doBulk('role', 'manager')}>관리자로</button>}<button disabled={selectedMembers.some(item => item.accountKind !== 'managed')} onClick={() => void doBulk('suspend')}>관리 계정 정지</button><button className="is-danger" onClick={() => void doBulk('remove')}>스페이스에서 제외</button><button onClick={() => setSelected([])}>선택 해제</button></div>}
      {panelLoading ? <div className="admin-loading"><span /><span /><span /></div> : <>
        {tab === 'members' && <div className="space-member-list"><div className="space-member-head"><span><input type="checkbox" aria-label="현재 페이지 전체 선택" checked={members.items.length > 0 && members.items.every(item => selected.includes(item.userId))} onChange={event => setSelected(event.target.checked ? [...new Set([...selected, ...members.items.filter(item => item.role !== 'owner').map(item => item.userId)])] : selected.filter(id => !members.items.some(item => item.userId === id)))} /></span><span>사용자</span><span>계정</span><span>역할</span><span>상태/최근 로그인</span><span /></div>{members.items.map(member => <article className="space-member-row" key={member.userId}><span><input type="checkbox" disabled={member.role === 'owner'} checked={selected.includes(member.userId)} onChange={event => setSelected(current => event.target.checked ? [...current, member.userId] : current.filter(id => id !== member.userId))} /></span><span className="space-member-identity"><i className="avatar">{member.nickname.slice(0, 1)}</i><span><strong>{member.nickname}</strong><small>{member.email ?? (overview.actor.piiMasked ? '개인정보 마스킹됨' : member.phone ?? '-')} · {member.externalId || member.friendTag}</small></span></span><span><i className={`space-account-badge is-${member.accountKind}`}>{member.accountKind === 'managed' ? '스페이스 전용' : '기존 계정'}</i>{member.mustChangePassword && <small>비밀번호 변경 필요</small>}</span><span>{member.role === 'owner' ? '소유자' : member.role === 'manager' ? '관리자' : '멤버'}</span><span><i className={`space-status-badge is-${member.accountStatus}`}>{member.suspended ? '정지' : member.deleted ? '삭제됨' : '활성'}</i><small>{formatDate(member.lastSignInAt)}</small></span><span>{canManage && member.role !== 'owner' && member.userId !== overview.actor.id && <button aria-label={`${member.nickname} 관리`} onClick={() => openTarget(member)}><UserCog /></button>}</span></article>)}</div>}
{tab === 'rooms' && <div className="space-room-grid">{rooms.items.map(room => <article key={room.id}><DoorOpen /><div><strong>{room.code} · {room.host_nickname}</strong><small>{room.kind} · {room.participant_count}/{room.max_players}명 · {formatDate(room.updated_at)}</small></div><span>{room.status}</span>{canManage && ['waiting', 'playing'].includes(room.status) && <button className="secondary-button" onClick={() => setConfirmation({ title: '방을 종료할까요?', description: '대기 중인 참여자에게 즉시 영향을 줍니다.', confirmLabel: '방 종료', action: () => run(`room-${room.id}`, () => closeSpaceRoom(overview.space.id, room.id), '방을 종료했어요.') })}>종료</button>}</article>)}</div>}
        {tab === 'games' && <div className="space-data-list">{games.items.map(game => <article key={game.id}><Gamepad2 /><div><strong>방 {roomOf(game)?.code ?? game.room_id}</strong><small>시작 {formatDate(game.started_at)} · {game.finished_at ? `종료 ${formatDate(game.finished_at)}` : '진행 중'} · v{game.version}</small></div><span>{game.finished_at ? '완료' : '진행 중'}</span></article>)}</div>}
        {tab === 'cards' && <div className="space-data-list">{cards.items.map(card => <article key={card.id}><FileUp /><div><strong>{card.name}</strong><small>v{card.version} · {formatDate(card.updated_at)}</small></div><span>{card.is_platform_default ? '플랫폼 기본' : card.status}</span></article>)}</div>}
        {tab === 'audit' && <div className="space-data-list space-audit-list">{audit.items.map(event => <article key={event.id}><FileClock /><div><strong>{actionLabels[event.action] ?? event.action}</strong><small>{profileName(event.profiles)} · {formatDate(event.created_at)} · {event.reason}</small></div></article>)}</div>}
        {!pageData.items.length && <div className="admin-empty"><Search /><strong>표시할 항목이 없습니다.</strong><p>검색어나 필터를 바꿔 보세요.</p></div>}
      </>}
      <footer className="space-pagination"><button disabled={page <= 1} onClick={() => setPage(current => current - 1)}><ArrowLeft /> 이전</button><span>{page} / {totalPages}</span><button disabled={page >= totalPages} onClick={() => setPage(current => current + 1)}>다음 <ArrowRight /></button></footer>
    </section>}

    {tab === 'settings' && <section className="admin-section space-settings"><h2><ShieldCheck /> 스페이스 설정</h2><label>이름<input value={name} onChange={event => setName(event.target.value)} disabled={!canManage} /></label><label>Slug<input value={spaceSlug} onChange={event => setSpaceSlug(event.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '').slice(0, 49))} disabled={!canOwn} /></label><label>설명<textarea rows={3} value={description} onChange={event => setDescription(event.target.value)} disabled={!canManage} /></label><label>가입 정책<select value={joinPolicy} onChange={event => setJoinPolicy(event.target.value as JoinPolicy)} disabled={!canOwn}><option value="code">가입 코드</option><option value="invite_only">초대 전용</option><option value="closed">가입 중지</option></select></label><label className="space-toggle"><input type="checkbox" checked={joinEnabled} onChange={event => setJoinEnabled(event.target.checked)} disabled={!canOwn} /> 가입 기능 활성화</label><label>가입 코드 만료<input type="datetime-local" value={joinExpires} onChange={event => setJoinExpires(event.target.value)} disabled={!canOwn} /></label><label>허용 도메인 (한 줄에 하나)<textarea rows={4} value={domainsText} onChange={event => setDomainsText(event.target.value)} disabled={!canOwn} /></label>{canManage && <button className="primary-button" disabled={Boolean(busy)} onClick={() => void run('settings', async () => {
      const domains = domainsText.split(/\s+/).map(value => value.trim().toLowerCase()).filter(Boolean)
      await updateSpace(overview.space.id, { name, slug: canOwn ? spaceSlug : undefined, description, joinEnabled: canOwn ? joinEnabled : undefined, joinPolicy: canOwn ? joinPolicy : undefined, joinCodeExpiresAt: canOwn ? (joinExpires ? new Date(joinExpires).toISOString() : null) : undefined, emailDomains: canOwn ? domains : undefined })
      if (spaceSlug !== overview.space.slug) navigate(`/spaces/${encodeURIComponent(spaceSlug)}/admin`, { replace: true })
    }, '설정을 저장했어요.')}><Save /> 저장</button>}{canOwn && <div className="space-danger-zone"><h3><Archive /> 수명주기</h3><p>보관하면 조회와 복원만 가능해집니다. 데이터는 삭제되지 않습니다.</p>{overview.space.status === 'archived' ? <button onClick={() => void run('restore', () => updateSpace(overview.space.id, { status: 'active' }), '스페이스를 복원했어요.')}><RefreshCw /> 스페이스 복원</button> : <button className="is-danger" onClick={() => setConfirmation({ title: '스페이스를 보관할까요?', description: '가입과 관리 작업이 중지되며 소유자만 다시 복원할 수 있습니다.', confirmLabel: '보관하기', action: () => run('archive', () => updateSpace(overview.space.id, { status: 'archived' }), '스페이스를 보관했어요.') })}><Archive /> 스페이스 보관</button>}</div>}</section>}

{memberOpen && <div className="admin-modal-backdrop"><form className="admin-modal space-member-modal" role="dialog" aria-modal="true" aria-labelledby="space-member-modal-title" onSubmit={submitMember}><header><div><span><UserPlus /></span><div><small>MEMBER MANAGEMENT</small><h2 id="space-member-modal-title">멤버 추가</h2></div></div><button type="button" aria-label="닫기" onClick={() => setMemberOpen(false)}><X /></button></header><div className="space-member-modes">{([['existing', '기존 계정'], ['create', '전용 계정'], ['csv', 'CSV 일괄']] as const).map(item => <button type="button" key={item[0]} className={memberMode === item[0] ? 'is-active' : ''} onClick={() => { setMemberMode(item[0]); setError('') }}>{item[1]}</button>)}</div>{memberMode !== 'csv' ? <><p>{memberMode === 'existing' ? '이미 가입된 플랫폼 계정을 이메일로 정확히 찾아 연결합니다. 비밀번호는 관리하지 않습니다.' : '이 스페이스에서만 관리하는 계정을 만들고 임시 비밀번호를 한 번 표시합니다.'}</p><label>이메일<input type="email" value={account.email} onChange={event => setAccount(current => ({ ...current, email: event.target.value }))} required /></label>{memberMode === 'create' && <><label>표시 이름<input value={account.nickname} onChange={event => setAccount(current => ({ ...current, nickname: event.target.value }))} minLength={2} maxLength={12} required /></label><label>임시 비밀번호<input type="password" value={account.password} onChange={event => setAccount(current => ({ ...current, password: event.target.value }))} placeholder="비워두면 자동 생성" /></label></>}<label>사번/학번<input value={account.externalId} onChange={event => setAccount(current => ({ ...current, externalId: event.target.value }))} /></label><label>역할<select value={account.role} onChange={event => setAccount(current => ({ ...current, role: event.target.value as 'member' | 'manager' }))}><option value="member">멤버</option>{canOwn && <option value="manager">관리자</option>}</select></label></> : <><label className="space-csv-upload"><FileUp /><strong>RFC 4180 CSV 선택</strong><small>필수 열: email,nickname · 선택: role,external_id,password</small><input type="file" accept=".csv,text/csv" onChange={event => void readCsv(event)} /></label><button type="button" className="secondary-button space-csv-template" onClick={() => downloadTextFile('space-accounts-template.csv', SPACE_CSV_TEMPLATE)}><Download /> CSV 템플릿 받기</button>{csvRows.length > 0 && <div className="space-csv-preview"><header><strong>{csvRows.length}행 · 정상 {csvRows.filter(row => !row.errors.length).length}행</strong><small>오류 행은 제외되며 정상 행은 원자적으로 생성됩니다.</small></header>{csvRows.map((row, index) => <article key={row.row} className={row.errors.length ? 'has-error' : ''}><input type="checkbox" checked={row.included} disabled={row.errors.length > 0} onChange={event => setCsvRows(current => current.map((item, itemIndex) => itemIndex === index ? { ...item, included: event.target.checked } : item))} /><span>{row.row}</span><input value={row.email} onChange={event => setCsvRows(current => validateSpaceAccountRows(current.map((item, itemIndex) => itemIndex === index ? { ...item, email: event.target.value, included: true } : item), overview.space.emailDomains))} /><input value={row.nickname} onChange={event => setCsvRows(current => validateSpaceAccountRows(current.map((item, itemIndex) => itemIndex === index ? { ...item, nickname: event.target.value, included: true } : item), overview.space.emailDomains))} /><small>{row.errors.join(', ') || '정상'}</small></article>)}</div>}</>}<footer><button type="button" className="secondary-button" onClick={() => setMemberOpen(false)}>취소</button><button className="primary-button" disabled={Boolean(busy)}>{busy ? '처리 중...' : memberMode === 'existing' ? '계정 연결' : '계정 생성'}</button></footer></form></div>}

    {target && <div className="admin-modal-backdrop"><section className="admin-modal space-account-modal" role="dialog" aria-modal="true" aria-labelledby="space-account-modal-title"><header><div><span><UserCog /></span><div><small>{target.accountKind === 'managed' ? 'SPACE-MANAGED ACCOUNT' : 'EXISTING PLATFORM ACCOUNT'}</small><h2 id="space-account-modal-title">{target.nickname}</h2></div></div><button aria-label="닫기" onClick={() => setTarget(null)}><X /></button></header><div className="space-account-summary"><span className={`space-account-badge is-${target.accountKind}`}>{target.accountKind === 'managed' ? '스페이스 전용 계정' : '기존 개인 계정'}</span><p>{target.email ?? '이메일 비공개'} · {target.role}</p>{target.accountKind === 'existing' && <small>기존 계정은 역할 변경과 스페이스 제외만 가능합니다. 비밀번호·정지·삭제는 플랫폼 계정 소유자 영역입니다.</small>}</div>{target.accountKind === 'managed' && <><label>표시 이름<input value={editNickname} onChange={event => setEditNickname(event.target.value)} /></label><label>사번/학번<input value={editExternalId} onChange={event => setEditExternalId(event.target.value)} /></label><button className="secondary-button" onClick={() => void targetAction('edit', () => updateManagedSpaceAccount(overview.space.id, target.userId, { nickname: editNickname, externalId: editExternalId }), '계정 정보를 저장했어요.')}><Save /> 정보 저장</button><div className="space-account-actions"><button onClick={() => void targetAction('reset', () => resetManagedSpacePassword(overview.space.id, target.userId), '임시 비밀번호를 재발급하고 기존 세션을 무효화했어요.', target.email ?? '')}><KeyRound /> 비밀번호 재발급</button>{target.suspended ? <button onClick={() => void targetAction('reactivate', () => reactivateManagedSpaceAccount(overview.space.id, target.userId), '계정을 재활성화했어요.')}><Check /> 재활성화</button> : <button onClick={() => void targetAction('suspend', () => suspendManagedSpaceAccount(overview.space.id, target.userId), '계정을 정지하고 기존 세션을 무효화했어요.')}><Archive /> 계정 정지</button>}<button className="is-danger" onClick={() => setConfirmation({ title: '관리 계정을 완전히 삭제할까요?', description: '활성 세션과 다른 스페이스·친구 관계가 없는 경우에만 삭제됩니다. 되돌릴 수 없습니다.', confirmLabel: '계정 삭제', action: () => targetAction('delete', () => deleteManagedSpaceAccount(overview.space.id, target.userId), '안전 검사를 통과한 관리 계정을 삭제했어요.') })}><Trash2 /> 계정 완전 삭제</button></div></>}<div className="space-account-actions">{target.role === 'member' && canOwn && <button onClick={() => void targetAction('role', () => updateSpaceMember(overview.space.id, target.userId, 'manager'), '관리자로 변경했어요.')}><ShieldCheck /> 관리자로 변경</button>}{target.role === 'manager' && canOwn && <button onClick={() => void targetAction('role', () => updateSpaceMember(overview.space.id, target.userId, 'member'), '멤버로 변경했어요.')}><UsersRound /> 멤버로 변경</button>}{canOwn && <button onClick={() => setConfirmation({ title: '스페이스 소유권을 이전할까요?', description: '현재 소유자는 관리자로 변경되고 선택한 멤버가 새 소유자가 됩니다.', confirmLabel: '소유권 이전', action: () => targetAction('owner', () => transferSpaceOwner(overview.space.id, target.userId), '소유권을 이전했어요.') })}><Building2 /> 소유권 이전</button>}<button className="is-danger" onClick={() => setConfirmation({ title: '스페이스에서 제외할까요?', description: '진행 중인 게임이 있으면 차단되며, 기존 개인 계정 자체는 삭제되지 않습니다.', confirmLabel: '멤버 제외', action: () => targetAction('remove', () => removeSpaceMember(overview.space.id, target.userId), '스페이스에서 제외했어요.') })}><Trash2 /> 스페이스에서 제외</button></div><footer><button className="secondary-button" onClick={() => setTarget(null)}>닫기</button></footer></section></div>}

{confirmation && <div className="admin-modal-backdrop"><section className="admin-modal" role="dialog" aria-modal="true" aria-labelledby="space-confirm-title"><span className="is-danger"><ShieldCheck /></span><h2 id="space-confirm-title">{confirmation.title}</h2><p>{confirmation.description}</p><div><button className="secondary-button" onClick={() => setConfirmation(null)}>취소</button><button className="danger-button" disabled={Boolean(busy)} onClick={() => void confirmPending()}>{busy ? '처리 중...' : confirmation.confirmLabel}</button></div></section></div>}
  </div>
}
