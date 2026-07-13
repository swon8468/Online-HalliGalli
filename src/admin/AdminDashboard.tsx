import { Ban, Boxes, Brush, CircleUserRound, DoorOpen, LayoutDashboard, LogOut, MoreHorizontal, RotateCcw, Search, ShieldCheck, UserX, UsersRound } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useAuth } from '../auth/AuthContext'
import { isDevelopment } from '../lib/environment'
import { emptyAdminData, executeAdminAction, fetchAdminData, type AdminCardSetRow, type AdminData, type AdminRoomRow, type AdminSpaceRow, type AdminUserRow } from './data'

type AdminSection = 'dashboard' | 'users' | 'rooms' | 'cards' | 'spaces'

const sections = [
  { id: 'dashboard', label: '대시보드', icon: LayoutDashboard },
  { id: 'users', label: '사용자 관리', icon: UsersRound },
  { id: 'rooms', label: '방 관리', icon: DoorOpen },
  { id: 'cards', label: '카드 디자인', icon: Brush },
  { id: 'spaces', label: '스페이스', icon: Boxes },
] as const

export default function AdminDashboard() {
  const { user, signOut } = useAuth()
  const [section, setSection] = useState<AdminSection>('dashboard')
  const [data, setData] = useState<AdminData>(emptyAdminData)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const refresh = async () => {
    setLoading(true); setError('')
    try { setData(await fetchAdminData()) }
    catch (caught) { setError(caught instanceof Error ? caught.message : '관리자 데이터를 불러오지 못했습니다.') }
    finally { setLoading(false) }
  }

  const act = async (action: 'suspend_user' | 'unsuspend_user' | 'deactivate_user' | 'close_room', targetId: string, promptText: string) => {
    const reason = window.prompt(promptText)
    if (!reason) return
    try { await executeAdminAction(action, targetId, reason); await refresh() }
    catch (caught) { setError(caught instanceof Error ? caught.message : '관리 작업을 완료하지 못했습니다.') }
  }

  useEffect(() => {
    void fetchAdminData().then(setData).catch(caught => setError(caught instanceof Error ? caught.message : '관리자 데이터를 불러오지 못했습니다.')).finally(() => setLoading(false))
  }, [])

  return (
    <div className="admin-shell">
      <aside className="admin-sidebar">
        <div className="admin-brand"><span><ShieldCheck /></span><div><strong>Halli Admin</strong><small>{isDevelopment ? 'DEVELOPMENT' : 'PRODUCTION'}</small></div></div>
        <nav>{sections.map(({ id, label, icon: Icon }) => <button className={section === id ? 'is-active' : ''} onClick={() => setSection(id)} key={id}><Icon />{label}</button>)}</nav>
        <button className="admin-profile" onClick={() => void signOut()} title="로그아웃"><span className="avatar avatar--1">{user?.label[0] ?? 'A'}</span><span><strong>{user?.label ?? '관리자'}</strong><small>{user?.role ?? 'Platform Admin'}</small></span><LogOut /></button>
      </aside>
      <main className="admin-main">
        <header className="admin-header"><div><p>PLATFORM CONTROL</p><h1>{sections.find(item => item.id === section)?.label}</h1></div><label><Search /><input placeholder="사용자, 방, 스페이스 검색" /></label></header>
        {error && <div className="admin-error" role="alert">{error}</div>}
        {loading ? <AdminLoading /> : <>
          {section === 'dashboard' && <DashboardOverview data={data} onRoomAction={act} />}
          {section === 'users' && <UserManagement users={data.users} onAction={act} />}
          {section === 'rooms' && <RoomManagement rooms={data.rooms} onAction={act} />}
          {section === 'cards' && <CardManagement cardSets={data.cardSets} />}
          {section === 'spaces' && <SpaceManagement spaces={data.spaces} />}
        </>}
      </main>
    </div>
  )
}

function AdminLoading() { return <div className="admin-loading"><span /><span /><span /></div> }
function EmptyAdminState({ label }: { label: string }) { return <div className="admin-empty"><Boxes /><strong>{label}</strong><p>Supabase에 데이터가 생성되면 여기에 표시됩니다.</p></div> }

function DashboardOverview({ data, onRoomAction }: { data: AdminData; onRoomAction: AdminActionHandler }) {
  const { stats } = data
  return <><section className="metric-grid"><article><span>전체 사용자</span><strong>{stats.users.toLocaleString()}</strong><small>실시간 데이터</small></article><article><span>진행 중인 방</span><strong>{stats.activeRooms.toLocaleString()}</strong><small>{stats.activePlayers.toLocaleString()}명 참여 중</small></article><article><span>활성 스페이스</span><strong>{stats.activeSpaces.toLocaleString()}</strong><small>운영 상태 기준</small></article><article><span>관리 조치 기록</span><strong>{stats.moderationQueue.toLocaleString()}</strong><small>감사 로그</small></article></section><section className="admin-panel"><header><div><h2>실시간 운영 현황</h2><p>최근 생성된 게임 방입니다.</p></div></header><RoomTable rooms={data.rooms} onAction={onRoomAction} /></section></>
}

type AdminActionHandler = (action: 'suspend_user' | 'unsuspend_user' | 'deactivate_user' | 'close_room', targetId: string, promptText: string) => Promise<void>
function UserManagement({ users, onAction }: { users: AdminUserRow[]; onAction: AdminActionHandler }) { return <section className="admin-panel"><header><div><h2>사용자 관리</h2><p>계정 정지, 복구, 탈퇴를 관리합니다.</p></div><button className="admin-primary"><CircleUserRound /> 계정 생성</button></header><UserTable users={users} onAction={onAction} /></section> }
function RoomManagement({ rooms, onAction }: { rooms: AdminRoomRow[]; onAction: AdminActionHandler }) { return <section className="admin-panel"><header><div><h2>방 관리</h2><p>공개 및 스페이스 게임을 모니터링합니다.</p></div></header><RoomTable rooms={rooms} onAction={onAction} /></section> }
function CardManagement({ cardSets }: { cardSets: AdminCardSetRow[] }) { return <section className="admin-panel"><header><div><h2>카드 디자인</h2><p>기본 카드와 스페이스 전용 카드 세트를 관리합니다.</p></div><button className="admin-primary"><Brush /> 디자인 추가</button></header>{cardSets.length ? <div className="card-set-grid">{cardSets.map(card => <article key={card.id}><div className="card-preview preview-default">{card.name[0]}</div><strong>{card.name}</strong><small>{card.scope} · v{card.version} · {card.status}</small></article>)}</div> : <EmptyAdminState label="등록된 카드 세트가 없어요." />}</section> }
function SpaceManagement({ spaces }: { spaces: AdminSpaceRow[] }) { return <section className="admin-panel"><header><div><h2>스페이스</h2><p>학교, 행사, 조직별 독립 게임 환경을 관리합니다.</p></div><button className="admin-primary"><Boxes /> 스페이스 생성</button></header>{spaces.length ? <div className="space-list">{spaces.map(space => <article key={space.id}><span>{space.name[0]}</span><div><strong>{space.name}</strong><small>{space.slug}</small></div><i>{space.status}</i></article>)}</div> : <EmptyAdminState label="활성 스페이스가 없어요." />}</section> }

function UserTable({ users, onAction }: { users: AdminUserRow[]; onAction: AdminActionHandler }) {
  if (!users.length) return <EmptyAdminState label="등록된 사용자가 없어요." />
  return <div className="admin-table"><div className="table-head"><span>사용자</span><span>상태</span><span>권한</span><span>가입일</span><span>관리</span></div>{users.map(user => <div className="table-row" key={user.id}><span><i className="avatar avatar--2">{user.nickname[0]}</i><span><strong>{user.nickname}</strong><small>{user.friendTag}</small></span></span><span className={user.status === '정상' ? 'status-badge' : 'status-badge is-banned'}>{user.status}</span><span>{user.method}</span><span>{user.joinedAt}</span><div className="table-actions"><button onClick={() => void onAction(user.status === '정지' ? 'unsuspend_user' : 'suspend_user', user.id, user.status === '정지' ? '복구 사유를 입력하세요.' : '30일 정지 사유를 입력하세요.')} aria-label={`${user.nickname} ${user.status === '정지' ? '복구' : '정지'}`}>{user.status === '정지' ? <RotateCcw /> : <Ban />}</button><button onClick={() => void onAction('deactivate_user', user.id, '계정 탈퇴 처리 사유를 입력하세요.')} aria-label={`${user.nickname} 탈퇴 처리`}><UserX /></button></div></div>)}</div>
}

function RoomTable({ rooms, onAction }: { rooms: AdminRoomRow[]; onAction: AdminActionHandler }) {
  if (!rooms.length) return <EmptyAdminState label="현재 활성화된 방이 없어요." />
  return <div className="admin-table"><div className="table-head"><span>방 코드</span><span>유형</span><span>인원</span><span>상태</span><span>관리</span></div>{rooms.map(room => <div className="table-row" key={room.id}><span><strong>{room.code}</strong></span><span>{room.type}</span><span>{room.players} / {room.capacity}</span><span className="status-badge">{room.status}</span><button onClick={() => void onAction('close_room', room.id, '방 강제 종료 사유를 입력하세요.')} aria-label={`${room.code} 강제 종료`}><MoreHorizontal /></button></div>)}</div>
}
