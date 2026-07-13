import { Ban, Boxes, Brush, CircleUserRound, DoorOpen, LayoutDashboard, MoreHorizontal, Search, ShieldCheck, UsersRound } from 'lucide-react'
import { useState } from 'react'
import { isDevelopment } from '../lib/environment'

type AdminSection = 'dashboard' | 'users' | 'rooms' | 'cards' | 'spaces'

const sections = [
  { id: 'dashboard', label: '대시보드', icon: LayoutDashboard },
  { id: 'users', label: '사용자 관리', icon: UsersRound },
  { id: 'rooms', label: '방 관리', icon: DoorOpen },
  { id: 'cards', label: '카드 디자인', icon: Brush },
  { id: 'spaces', label: '스페이스', icon: Boxes },
] as const

export default function AdminDashboard() {
  const [section, setSection] = useState<AdminSection>('dashboard')
  return (
    <div className="admin-shell">
      <aside className="admin-sidebar">
        <div className="admin-brand"><span><ShieldCheck /></span><div><strong>Halli Admin</strong><small>{isDevelopment ? 'DEVELOPMENT' : 'PRODUCTION'}</small></div></div>
        <nav>{sections.map(({ id, label, icon: Icon }) => <button className={section === id ? 'is-active' : ''} onClick={() => setSection(id)} key={id}><Icon />{label}</button>)}</nav>
        <div className="admin-profile"><span className="avatar avatar--1">A</span><span><strong>관리자</strong><small>Super Admin</small></span><MoreHorizontal /></div>
      </aside>
      <main className="admin-main">
        <header className="admin-header"><div><p>PLATFORM CONTROL</p><h1>{sections.find(item => item.id === section)?.label}</h1></div><label><Search /><input placeholder="사용자, 방, 스페이스 검색" /></label></header>
        {section === 'dashboard' && <DashboardOverview />}
        {section === 'users' && <UserManagement />}
        {section === 'rooms' && <RoomManagement />}
        {section === 'cards' && <CardManagement />}
        {section === 'spaces' && <SpaceManagement />}
      </main>
    </div>
  )
}

function DashboardOverview() {
  return <><section className="metric-grid"><article><span>전체 사용자</span><strong>12,482</strong><small>이번 주 +8.2%</small></article><article><span>진행 중인 방</span><strong>284</strong><small>1,104명 플레이 중</small></article><article><span>활성 스페이스</span><strong>38</strong><small>이번 달 +6</small></article><article><span>신고 검토</span><strong>7</strong><small className="is-warning">확인 필요</small></article></section><section className="admin-panel"><header><div><h2>실시간 운영 현황</h2><p>최근 생성된 게임 방입니다.</p></div><button>전체 보기</button></header><AdminTable type="rooms" /></section></>
}

function UserManagement() { return <section className="admin-panel"><header><div><h2>사용자 관리</h2><p>계정 정지, 복구, 탈퇴를 관리합니다.</p></div><button className="admin-primary"><CircleUserRound /> 계정 생성</button></header><AdminTable type="users" /></section> }
function RoomManagement() { return <section className="admin-panel"><header><div><h2>방 관리</h2><p>공개 및 스페이스 게임을 모니터링합니다.</p></div></header><AdminTable type="rooms" /></section> }
function CardManagement() { return <section className="admin-panel"><header><div><h2>카드 디자인</h2><p>기본 카드와 스페이스 전용 카드 세트를 관리합니다.</p></div><button className="admin-primary"><Brush /> 디자인 추가</button></header><div className="card-set-grid"><article><div className="card-preview preview-default">5</div><strong>기본 과일 카드</strong><small>전체 공개 · 56장</small></article><article><div className="card-preview preview-school">S</div><strong>서울고 축제 2026</strong><small>서울고 스페이스 · 56장</small></article><article className="add-card-set"><Brush /><strong>새 카드 세트</strong></article></div></section> }
function SpaceManagement() { return <section className="admin-panel"><header><div><h2>스페이스</h2><p>학교, 행사, 조직별 독립 게임 환경을 관리합니다.</p></div><button className="admin-primary"><Boxes /> 스페이스 생성</button></header><div className="space-list"><article><span>S</span><div><strong>서울고 축제 2026</strong><small>사용자 842명 · 관리자 4명 · 전용 카드 1개</small></div><i>운영 중</i></article><article><span>D</span><div><strong>디자인팀 게임 나이트</strong><small>사용자 38명 · 관리자 2명 · 기본 카드</small></div><i>운영 중</i></article></div></section> }

function AdminTable({ type }: { type: 'users' | 'rooms' }) {
  return type === 'users' ? <div className="admin-table"><div className="table-head"><span>사용자</span><span>상태</span><span>가입 방식</span><span>최근 접속</span><span /></div>{[['김민서','정상','이메일','방금 전'],['박도윤','정지','전화번호','2일 전'],['이수현','정상','이메일','12분 전']].map(row => <div className="table-row" key={row[0]}><span><i className="avatar avatar--2">{row[0][0]}</i><strong>{row[0]}</strong></span><span className={row[1] === '정지' ? 'status-badge is-banned' : 'status-badge'}>{row[1]}</span><span>{row[2]}</span><span>{row[3]}</span><button aria-label={`${row[0]} 관리`}><Ban /></button></div>)}</div> : <div className="admin-table"><div className="table-head"><span>방 코드</span><span>유형</span><span>인원</span><span>상태</span><span /></div>{[['KOR728','서울고 축제','4 / 4','게임 중'],['QWE104','비공개','3 / 4','대기 중'],['BOT002','봇 연습','1 / 2','게임 중']].map(row => <div className="table-row" key={row[0]}><span><strong>{row[0]}</strong></span><span>{row[1]}</span><span>{row[2]}</span><span className="status-badge">{row[3]}</span><button aria-label={`${row[0]} 관리`}><MoreHorizontal /></button></div>)}</div>
}
