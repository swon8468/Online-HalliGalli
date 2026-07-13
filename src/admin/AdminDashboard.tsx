import {
  AlertTriangle, Ban, Boxes, Brush, CheckCircle2, ChevronLeft, ChevronRight, CircleUserRound,
  DoorOpen, Eye, History, LayoutDashboard, LogOut, MoreHorizontal, RotateCcw, Search,
  ShieldCheck, UserCog, UserX, UsersRound, X,
} from 'lucide-react'
import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../auth/AuthContext'
import { isDevelopment } from '../lib/environment'
import { getErrorMessage } from '../lib/errorMessage'
import {
  emptyAdminData, executeAdminAction, fetchAdminData, type AdminAction, type AdminActionPayload,
  type AdminAuditRow, type AdminCardSetRow, type AdminData, type AdminRoomRow, type AdminSpaceRow,
  type AdminUserRow, type PlatformRole,
} from './data'

type AdminSection = 'dashboard' | 'users' | 'rooms' | 'audit' | 'cards' | 'spaces'
type ActionDraft = {
  action: AdminAction
  targetId?: string
  targetLabel: string
  reason: string
  duration: '7' | '30' | '90' | 'permanent'
  role: PlatformRole
  email: string
  password: string
  nickname: string
}

const pageSize = 10
const sections = [
  { id: 'dashboard', label: '대시보드', icon: LayoutDashboard },
  { id: 'users', label: '사용자 관리', icon: UsersRound },
  { id: 'rooms', label: '방 관리', icon: DoorOpen },
  { id: 'audit', label: '감사 로그', icon: History },
  { id: 'cards', label: '카드 디자인', icon: Brush },
  { id: 'spaces', label: '스페이스', icon: Boxes },
] as const

const roleLabels: Record<PlatformRole, string> = {
  player: '플레이어', support: '지원 담당자', admin: '플랫폼 관리자', super_admin: '슈퍼 관리자',
}

const blankDraft: ActionDraft = {
  action: 'suspend_user', targetLabel: '', reason: '', duration: '30', role: 'support', email: '', password: '', nickname: '',
}

export default function AdminDashboard() {
  const { user, signOut } = useAuth()
  const [section, setSection] = useState<AdminSection>('dashboard')
  const [data, setData] = useState<AdminData>(emptyAdminData)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [query, setQuery] = useState('')
  const [userStatus, setUserStatus] = useState('all')
  const [roomStatus, setRoomStatus] = useState('all')
  const [page, setPage] = useState(1)
  const [draft, setDraft] = useState<ActionDraft | null>(null)
  const [detail, setDetail] = useState<AdminUserRow | AdminRoomRow | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const refreshPromiseRef = useRef<ReturnType<typeof fetchAdminData> | null>(null)

  const refresh = useCallback(async (silent = false, ensureFresh = false) => {
    if (ensureFresh && refreshPromiseRef.current) await refreshPromiseRef.current.catch(() => undefined)
    if (!silent) setLoading(true)
    setError('')
    if (!refreshPromiseRef.current) refreshPromiseRef.current = fetchAdminData().finally(() => { refreshPromiseRef.current = null })
    try { setData(await refreshPromiseRef.current) }
    catch { setError('관리자 데이터를 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.') }
    finally { if (!silent) setLoading(false) }
  }, [])

  useEffect(() => { void refresh() }, [refresh])
  useEffect(() => { setPage(1) }, [query, userStatus, roomStatus, section])

  const openAction = (action: AdminAction, targetId: string | undefined, targetLabel: string, role: PlatformRole = 'support') => {
    setDetail(null)
    setDraft({ ...blankDraft, action, targetId, targetLabel, role })
    setError(''); setNotice('')
  }

  const submitAction = async (event: FormEvent) => {
    event.preventDefault()
    if (!draft) return
    setSubmitting(true); setError(''); setNotice('')
    const payload: AdminActionPayload = { action: draft.action, targetId: draft.targetId, reason: draft.reason.trim() }
    if (draft.action === 'suspend_user') payload.durationDays = draft.duration === 'permanent' ? null : Number(draft.duration)
    if (draft.action === 'change_role') payload.role = draft.role
    if (draft.action === 'create_admin') Object.assign(payload, { role: draft.role, email: draft.email, password: draft.password, nickname: draft.nickname })
    try {
      await executeAdminAction(payload)
      await refresh(true, true)
      setDraft(null)
      setDetail(null)
      setNotice('관리 조치가 완료되고 감사 로그에 기록되었습니다.')
    } catch (caught) {
      setError(getErrorMessage(caught, '관리 작업을 완료하지 못했습니다.'))
    } finally { setSubmitting(false) }
  }

  const actorRole = data.actor?.role ?? user?.role ?? 'support'
  const canMutate = ['admin', 'super_admin'].includes(actorRole)
  const isSuperAdmin = actorRole === 'super_admin'

  return (
    <div className="admin-shell">
      <aside className="admin-sidebar">
        <div className="admin-brand"><span><ShieldCheck /></span><div><strong>Halli Admin</strong><small>{isDevelopment ? 'DEVELOPMENT' : 'PRODUCTION'}</small></div></div>
        <nav>{sections.map(({ id, label, icon: Icon }) => <button className={section === id ? 'is-active' : ''} onClick={() => setSection(id)} key={id}><Icon />{label}</button>)}</nav>
        <button className="admin-profile" onClick={() => void signOut()} title="로그아웃"><span className="avatar avatar--1">{user?.label[0] ?? 'A'}</span><span><strong>{user?.label ?? '관리자'}</strong><small>{roleLabels[actorRole]}</small></span><LogOut /></button>
      </aside>
      <main className="admin-main">
        <header className="admin-header"><div><p>PLATFORM CONTROL</p><h1>{sections.find(item => item.id === section)?.label}</h1></div><label><Search /><input aria-label="관리자 통합 검색" placeholder="사용자, 방, 감사 로그 검색" value={query} onChange={event => setQuery(event.target.value)} /></label></header>
        {actorRole === 'support' && <div className="admin-readonly"><Eye /> 지원 담당자는 모든 운영 정보를 조회할 수 있지만 변경할 수는 없습니다.</div>}
        {error && <div className="admin-error" role="alert"><span>{error}</span><button onClick={() => void refresh()}>관리자 데이터 다시 불러오기</button></div>}
        {notice && <div className="admin-success" role="status"><CheckCircle2 />{notice}</div>}
        {loading ? <AdminLoading /> : <>
          {section === 'dashboard' && <DashboardOverview data={data} query={query} canMutate={canMutate} onRoomAction={room => openAction('close_room', room.id, room.code)} onDetail={setDetail} />}
          {section === 'users' && <UserManagement users={data.users} query={query} status={userStatus} setStatus={setUserStatus} page={page} setPage={setPage} canMutate={canMutate} isSuperAdmin={isSuperAdmin} onAction={openAction} onDetail={setDetail} />}
          {section === 'rooms' && <RoomManagement rooms={data.rooms} query={query} status={roomStatus} setStatus={setRoomStatus} page={page} setPage={setPage} canMutate={canMutate} onAction={room => openAction('close_room', room.id, room.code)} onDetail={setDetail} />}
          {section === 'audit' && <AuditManagement audit={data.audit} query={query} page={page} setPage={setPage} />}
          {section === 'cards' && <CardManagement cardSets={data.cardSets} />}
          {section === 'spaces' && <SpaceManagement spaces={data.spaces} />}
        </>}
      </main>
      {draft && <ActionModal draft={draft} setDraft={setDraft} submitting={submitting} onClose={() => setDraft(null)} onSubmit={submitAction} />}
      {detail && <DetailModal item={detail} canMutate={canMutate} isSuperAdmin={isSuperAdmin} onClose={() => setDetail(null)} onAction={openAction} />}
      {section === 'users' && isSuperAdmin && !draft && <button className="admin-fab" onClick={() => openAction('create_admin', undefined, '새 관리자')}><CircleUserRound /> 관리자 생성</button>}
    </div>
  )
}

function AdminLoading() { return <div className="admin-loading" aria-label="불러오는 중"><span /><span /><span /></div> }
function EmptyAdminState({ label }: { label: string }) { return <div className="admin-empty"><Boxes /><strong>{label}</strong><p>검색 조건을 바꾸거나 데이터가 생성된 뒤 다시 확인해 주세요.</p></div> }
function normalize(value: string) { return value.trim().toLocaleLowerCase('ko-KR') }
function matches(value: string, query: string) { return !query || normalize(value).includes(normalize(query)) }
function pageItems<T>(items: T[], page: number) { return items.slice((page - 1) * pageSize, page * pageSize) }

function DashboardOverview({ data, query, canMutate, onRoomAction, onDetail }: { data: AdminData; query: string; canMutate: boolean; onRoomAction: (room: AdminRoomRow) => void; onDetail: (room: AdminRoomRow) => void }) {
  const { stats } = data
  const rooms = data.rooms.filter(room => ['waiting', 'playing'].includes(room.statusKey) && matches(`${room.code} ${room.hostNickname}`, query)).slice(0, 8)
  return <><section className="metric-grid"><article><span>전체 사용자</span><strong>{stats.users.toLocaleString()}</strong><small>실시간 데이터</small></article><article><span>진행 중인 방</span><strong>{stats.activeRooms.toLocaleString()}</strong><small>{stats.activePlayers.toLocaleString()}명 참여 중</small></article><article><span>활성 스페이스</span><strong>{stats.activeSpaces.toLocaleString()}</strong><small>운영 상태 기준</small></article><article><span>관리 조치 기록</span><strong>{stats.moderationQueue.toLocaleString()}</strong><small>감사 로그</small></article></section><section className="admin-panel"><header><div><h2>실시간 운영 현황</h2><p>현재 대기 또는 진행 중인 게임 방입니다.</p></div></header><RoomTable rooms={rooms} canMutate={canMutate} onAction={onRoomAction} onDetail={onDetail} /></section></>
}

function UserManagement({ users, query, status, setStatus, page, setPage, canMutate, isSuperAdmin, onAction, onDetail }: { users: AdminUserRow[]; query: string; status: string; setStatus: (value: string) => void; page: number; setPage: (value: number) => void; canMutate: boolean; isSuperAdmin: boolean; onAction: (action: AdminAction, targetId: string | undefined, label: string, role?: PlatformRole) => void; onDetail: (user: AdminUserRow) => void }) {
  const filtered = useMemo(() => users.filter(user => (status === 'all' || user.status === status) && matches(`${user.nickname} ${user.friendTag} ${user.email ?? ''} ${user.phone ?? ''} ${user.roleLabel}`, query)), [users, query, status])
  return <section className="admin-panel"><header><div><h2>사용자 관리</h2><p>계정 상태와 플랫폼 권한을 관리합니다.</p></div><FilterSelect label="사용자 상태" value={status} onChange={setStatus} options={[['all', '전체 상태'], ['정상', '정상'], ['정지', '정지'], ['탈퇴', '탈퇴']]} /></header><UserTable users={pageItems(filtered, page)} canMutate={canMutate} isSuperAdmin={isSuperAdmin} onAction={onAction} onDetail={onDetail} /><Pagination total={filtered.length} page={page} setPage={setPage} /></section>
}

function RoomManagement({ rooms, query, status, setStatus, page, setPage, canMutate, onAction, onDetail }: { rooms: AdminRoomRow[]; query: string; status: string; setStatus: (value: string) => void; page: number; setPage: (value: number) => void; canMutate: boolean; onAction: (room: AdminRoomRow) => void; onDetail: (room: AdminRoomRow) => void }) {
  const filtered = useMemo(() => rooms.filter(room => (status === 'all' || room.statusKey === status) && matches(`${room.code} ${room.hostNickname} ${room.type}`, query)), [rooms, query, status])
  return <section className="admin-panel"><header><div><h2>방 관리</h2><p>대기·진행·종료된 방과 연결된 게임을 확인합니다.</p></div><FilterSelect label="방 상태" value={status} onChange={setStatus} options={[['all', '전체 상태'], ['waiting', '대기 중'], ['playing', '게임 중'], ['finished', '종료됨'], ['closed', '닫힘']]} /></header><RoomTable rooms={pageItems(filtered, page)} canMutate={canMutate} onAction={onAction} onDetail={onDetail} /><Pagination total={filtered.length} page={page} setPage={setPage} /></section>
}

function AuditManagement({ audit, query, page, setPage }: { audit: AdminAuditRow[]; query: string; page: number; setPage: (value: number) => void }) {
  const filtered = useMemo(() => audit.filter(row => matches(`${row.actorNickname} ${row.target} ${row.actionLabel} ${row.reason}`, query)), [audit, query])
  return <section className="admin-panel"><header><div><h2>관리 조치 이력</h2><p>누가, 누구에게, 어떤 이유로 조치했는지 확인합니다.</p></div></header>{filtered.length ? <div className="admin-table admin-table--audit"><div className="table-head"><span>작업자</span><span>대상</span><span>조치</span><span>사유</span><span>일시</span></div>{pageItems(filtered, page).map(row => <div className="table-row" key={row.id}><span><strong>{row.actorNickname}</strong></span><span>{row.target}</span><span className="status-badge">{row.actionLabel}</span><span title={row.reason}>{row.reason}</span><span>{row.createdAt}</span></div>)}</div> : <EmptyAdminState label="표시할 감사 로그가 없어요." />}<Pagination total={filtered.length} page={page} setPage={setPage} /></section>
}

function CardManagement({ cardSets }: { cardSets: AdminCardSetRow[] }) { return <section className="admin-panel"><header><div><h2>카드 디자인</h2><p>기본 카드와 스페이스 전용 카드 세트의 초안·게시 버전을 관리합니다.</p></div><Link className="admin-primary" to="/cards"><Brush /> 카드 스튜디오</Link></header>{cardSets.length ? <div className="card-set-grid">{cardSets.map(card => <Link to={`/cards/${encodeURIComponent(card.id)}`} key={card.id}><article><div className="card-preview preview-default">{card.name[0]}</div><strong>{card.name}</strong><small>{card.scope} · v{card.version} · {card.status}</small></article></Link>)}</div> : <EmptyAdminState label="등록된 카드 세트가 없어요." />}</section> }
function SpaceManagement({ spaces }: { spaces: AdminSpaceRow[] }) { return <section className="admin-panel"><header><div><h2>스페이스</h2><p>회사, 행사, 커뮤니티 등 단체별 멤버와 전용 게임을 관리합니다.</p></div><Link className="admin-primary" to="/spaces"><Boxes /> 스페이스 생성</Link></header>{spaces.length ? <div className="space-list">{spaces.map(space => <Link to={`/spaces/${encodeURIComponent(space.slug)}/admin`} key={space.id}><article><span>{space.name[0]}</span><div><strong>{space.name}</strong><small>{space.slug}</small></div><i>{space.status}</i></article></Link>)}</div> : <EmptyAdminState label="스페이스가 없어요." />}</section> }

function UserTable({ users, canMutate, isSuperAdmin, onAction, onDetail }: { users: AdminUserRow[]; canMutate: boolean; isSuperAdmin: boolean; onAction: (action: AdminAction, targetId: string | undefined, label: string, role?: PlatformRole) => void; onDetail: (user: AdminUserRow) => void }) {
  if (!users.length) return <EmptyAdminState label="조건에 맞는 사용자가 없어요." />
  return <div className="admin-table"><div className="table-head"><span>사용자</span><span>상태</span><span>권한</span><span>가입일</span><span>관리</span></div>{users.map(item => <div className="table-row" key={item.id}><button className="admin-table-person" onClick={() => onDetail(item)}><i className="avatar avatar--2">{item.nickname[0]}</i><span><strong>{item.nickname}</strong><small>{item.email ?? item.phone ?? item.friendTag}</small></span></button><span className={item.status === '정상' ? 'status-badge' : 'status-badge is-banned'}>{item.status}</span><span>{item.roleLabel}</span><span>{item.joinedAt}</span><div className="table-actions"><button onClick={() => onDetail(item)} aria-label={`${item.nickname} 상세 보기`}><Eye /></button>{canMutate && item.role !== 'super_admin' && <button onClick={() => onAction(item.status === '정지' ? 'unsuspend_user' : 'suspend_user', item.id, item.nickname)} aria-label={`${item.nickname} ${item.status === '정지' ? '복구' : '정지'}`}>{item.status === '정지' ? <RotateCcw /> : <Ban />}</button>}{canMutate && item.role !== 'super_admin' && <button onClick={() => onAction('deactivate_user', item.id, item.nickname)} aria-label={`${item.nickname} 비활성화`}><UserX /></button>}{isSuperAdmin && item.role !== 'super_admin' && <button onClick={() => onAction('change_role', item.id, item.nickname, item.role)} aria-label={`${item.nickname} 권한 변경`}><UserCog /></button>}</div></div>)}</div>
}

function RoomTable({ rooms, canMutate, onAction, onDetail }: { rooms: AdminRoomRow[]; canMutate: boolean; onAction: (room: AdminRoomRow) => void; onDetail: (room: AdminRoomRow) => void }) {
  if (!rooms.length) return <EmptyAdminState label="조건에 맞는 방이 없어요." />
  return <div className="admin-table"><div className="table-head"><span>방 코드</span><span>유형</span><span>인원</span><span>상태</span><span>관리</span></div>{rooms.map(room => <div className="table-row" key={room.id}><button className="admin-table-person" onClick={() => onDetail(room)}><span><strong>{room.code}</strong><small>방장 {room.hostNickname}</small></span></button><span>{room.type}</span><span>{room.players} / {room.capacity}</span><span className={`status-badge ${room.statusKey === 'closed' ? 'is-banned' : ''}`}>{room.status}</span><div className="table-actions"><button onClick={() => onDetail(room)} aria-label={`${room.code} 상세 보기`}><Eye /></button>{canMutate && !['closed', 'finished'].includes(room.statusKey) && <button onClick={() => onAction(room)} aria-label={`${room.code} 강제 종료`}><MoreHorizontal /></button>}</div></div>)}</div>
}

function FilterSelect({ label, value, onChange, options }: { label: string; value: string; onChange: (value: string) => void; options: Array<[string, string]> }) { return <label className="admin-filter"><span>{label}</span><select value={value} onChange={event => onChange(event.target.value)}>{options.map(([key, text]) => <option value={key} key={key}>{text}</option>)}</select></label> }
function Pagination({ total, page, setPage }: { total: number; page: number; setPage: (value: number) => void }) { const pages = Math.max(1, Math.ceil(total / pageSize)); if (total <= pageSize) return null; return <nav className="admin-pagination" aria-label="페이지 이동"><button disabled={page <= 1} onClick={() => setPage(page - 1)}><ChevronLeft /> 이전</button><span>{page} / {pages} · 총 {total}개</span><button disabled={page >= pages} onClick={() => setPage(page + 1)}>다음 <ChevronRight /></button></nav> }

function ActionModal({ draft, setDraft, submitting, onClose, onSubmit }: { draft: ActionDraft; setDraft: (draft: ActionDraft) => void; submitting: boolean; onClose: () => void; onSubmit: (event: FormEvent) => void }) {
  const title = draft.action === 'create_admin' ? '관리자 계정 생성' : draft.action === 'change_role' ? '권한 변경' : draft.action === 'suspend_user' ? '계정 정지' : draft.action === 'unsuspend_user' ? '정지 해제' : draft.action === 'deactivate_user' ? '계정 비활성화' : '방 강제 종료'
  const dangerous = ['suspend_user', 'deactivate_user', 'close_room'].includes(draft.action)
  return <div className="admin-modal-backdrop" role="presentation" onMouseDown={event => { if (event.target === event.currentTarget) onClose() }}><form className="admin-modal" role="dialog" aria-modal="true" aria-labelledby="admin-action-title" onSubmit={onSubmit}><button type="button" className="admin-modal-close" onClick={onClose} aria-label="닫기"><X /></button><span className={dangerous ? 'is-danger' : ''}>{dangerous ? <AlertTriangle /> : <ShieldCheck />}</span><h2 id="admin-action-title">{title}</h2><p><strong>{draft.targetLabel}</strong> 대상 작업입니다. 완료되면 감사 로그에 남습니다.</p>{draft.action === 'create_admin' && <><label>관리자 이메일<input type="email" required value={draft.email} onChange={event => setDraft({ ...draft, email: event.target.value })} /></label><label>표시 이름<input minLength={2} maxLength={12} required value={draft.nickname} onChange={event => setDraft({ ...draft, nickname: event.target.value })} /></label><label>임시 비밀번호<input type="password" minLength={12} required value={draft.password} onChange={event => setDraft({ ...draft, password: event.target.value })} /></label></>}{draft.action === 'suspend_user' && <label>정지 기간<select value={draft.duration} onChange={event => setDraft({ ...draft, duration: event.target.value as ActionDraft['duration'] })}><option value="7">7일</option><option value="30">30일</option><option value="90">90일</option><option value="permanent">무기한</option></select></label>}{['change_role', 'create_admin'].includes(draft.action) && <label>권한<select value={draft.role} onChange={event => setDraft({ ...draft, role: event.target.value as PlatformRole })}>{draft.action === 'change_role' && <option value="player">플레이어</option>}<option value="support">지원 담당자</option><option value="admin">플랫폼 관리자</option></select></label>}<label>조치 사유<textarea rows={3} minLength={2} maxLength={500} required value={draft.reason} onChange={event => setDraft({ ...draft, reason: event.target.value })} placeholder="구체적인 사유를 입력하세요." /></label><div><button type="button" className="secondary-button" onClick={onClose}>취소</button><button type="submit" className={dangerous ? 'danger-button' : 'full-button'} disabled={submitting}>{submitting ? '처리 중...' : title}</button></div></form></div>
}

function DetailModal({ item, canMutate, isSuperAdmin, onClose, onAction }: { item: AdminUserRow | AdminRoomRow; canMutate: boolean; isSuperAdmin: boolean; onClose: () => void; onAction: (action: AdminAction, targetId: string | undefined, label: string, role?: PlatformRole) => void }) {
  const isUser = 'friendTag' in item
  return <div className="admin-modal-backdrop" role="presentation" onMouseDown={event => { if (event.target === event.currentTarget) onClose() }}><section className="admin-modal admin-detail" role="dialog" aria-modal="true" aria-labelledby="admin-detail-title"><button className="admin-modal-close" onClick={onClose} aria-label="닫기"><X /></button><span><Eye /></span><h2 id="admin-detail-title">{isUser ? item.nickname : `방 ${item.code}`}</h2>{isUser ? <dl><div><dt>친구 태그</dt><dd>{item.friendTag}</dd></div><div><dt>로그인 ID</dt><dd>{item.email ?? item.phone ?? '-'}</dd></div><div><dt>계정 상태</dt><dd>{item.status}</dd></div><div><dt>플랫폼 권한</dt><dd>{item.roleLabel}</dd></div><div><dt>가입일</dt><dd>{item.joinedAt}</dd></div><div><dt>최근 로그인</dt><dd>{item.lastSignInAt ? new Date(item.lastSignInAt).toLocaleString('ko-KR') : '-'}</dd></div><div><dt>정지 만료</dt><dd>{item.suspendedUntil ? new Date(item.suspendedUntil).getFullYear() >= 9999 ? '무기한' : new Date(item.suspendedUntil).toLocaleString('ko-KR') : '-'}</dd></div><div><dt>정지 사유</dt><dd>{item.suspensionReason ?? '-'}</dd></div></dl> : <><dl><div><dt>상태</dt><dd>{item.status}</dd></div><div><dt>유형</dt><dd>{item.type}</dd></div><div><dt>방장</dt><dd>{item.hostNickname}</dd></div><div><dt>인원</dt><dd>{item.players} / {item.capacity}</dd></div><div><dt>생성</dt><dd>{item.createdAt}</dd></div><div><dt>게임 ID</dt><dd>{item.gameId ?? '-'}</dd></div><div><dt>게임 버전</dt><dd>{item.gameVersion ?? '-'}</dd></div></dl><h3>참가자</h3><ul className="admin-member-list">{item.members.map(member => <li key={`${member.userId}-${member.joinedAt}`}><strong>{member.nickname}</strong><span>{member.role === 'host' ? '방장' : '참가자'} · {member.kickedAt ? `강퇴 (${member.kickReason ?? '사유 없음'})` : member.leftAt ? '나감' : '참여 중'}</span></li>)}</ul></>}{isUser && canMutate && item.role !== 'super_admin' && <div className="admin-detail-actions"><button onClick={() => onAction(item.status === '정지' ? 'unsuspend_user' : 'suspend_user', item.id, item.nickname)}>{item.status === '정지' ? <RotateCcw /> : <Ban />}{item.status === '정지' ? '정지 해제' : '계정 정지'}</button>{isSuperAdmin && <button onClick={() => onAction('change_role', item.id, item.nickname, item.role)}><UserCog />권한 변경</button>}<button className="is-danger" onClick={() => onAction('deactivate_user', item.id, item.nickname)}><UserX />비활성화</button></div>}{!isUser && canMutate && !['closed', 'finished'].includes(item.statusKey) && <div className="admin-detail-actions"><button className="is-danger" onClick={() => onAction('close_room', item.id, item.code)}><DoorOpen />방 강제 종료</button></div>}</section></div>
}
