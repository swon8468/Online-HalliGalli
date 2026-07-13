import { Archive, Building2, Copy, DoorOpen, FileUp, Link2, Plus, RefreshCw, Save, ShieldCheck, Trash2, UserPlus, UsersRound } from 'lucide-react'
import { ChangeEvent, FormEvent, useCallback, useEffect, useRef, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import PageHeader from '../components/PageHeader'
import { copyText } from '../lib/clipboard'
import { getErrorMessage } from '../lib/errorMessage'
import {
  addExistingSpaceMember, bulkCreateSpaceAccounts, createSpaceAccount, loadSpaceAdmin, removeSpaceMember,
  rotateSpaceCode, updateSpace, updateSpaceMember, type SpaceAccountInput, type SpaceAdminSnapshot,
  type SpaceMemberView,
} from '../lib/spaces'

type SpaceTab = 'overview' | 'members' | 'rooms' | 'cards' | 'settings'
type MemberFormMode = 'existing' | 'create' | 'csv'

export default function SpaceAdmin() {
  const { slug = '' } = useParams()
  const navigate = useNavigate()
  const [snapshot, setSnapshot] = useState<SpaceAdminSnapshot | null>(null)
  const [tab, setTab] = useState<SpaceTab>('overview')
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState('')
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const [memberOpen, setMemberOpen] = useState(false)
  const [memberMode, setMemberMode] = useState<MemberFormMode>('existing')
  const [account, setAccount] = useState<SpaceAccountInput>({ email: '', nickname: '', password: '', role: 'member', externalId: '' })
  const [csvRows, setCsvRows] = useState<SpaceAccountInput[]>([])
  const [createdCredentials, setCreatedCredentials] = useState<Array<{ email: string; password: string | null }>>([])
  const [name, setName] = useState('')
  const [spaceSlug, setSpaceSlug] = useState('')
  const [description, setDescription] = useState('')
  const [joinEnabled, setJoinEnabled] = useState(true)
  const [confirmAction, setConfirmAction] = useState<{ type: 'remove-member'; member: SpaceMemberView } | { type: 'archive-space' } | null>(null)
  const refreshPromiseRef = useRef<ReturnType<typeof loadSpaceAdmin> | null>(null)

  const refresh = useCallback(async (quiet = false, ensureFresh = false) => {
    if (ensureFresh && refreshPromiseRef.current) await refreshPromiseRef.current.catch(() => undefined)
    if (!quiet) setLoading(true)
    if (!refreshPromiseRef.current) refreshPromiseRef.current = loadSpaceAdmin(slug).finally(() => { refreshPromiseRef.current = null })
    try {
      const value = await refreshPromiseRef.current; setSnapshot(value); setName(value.space.name); setSpaceSlug(value.space.slug); setDescription(value.space.description ?? ''); setJoinEnabled(value.space.joinEnabled); setError('')
    } catch { setError('스페이스를 불러오지 못했어요. 잠시 후 다시 시도해 주세요.') }
    finally { if (!quiet) setLoading(false) }
  }, [slug])
  useEffect(() => { void refresh() }, [refresh])
  const run = async (key: string, action: () => Promise<unknown>, success: string) => {
    setBusy(key); setError(''); setMessage('')
    try { await action(); await refresh(true, true); setMessage(success) }
    catch (cause) { setError(getErrorMessage(cause, '작업을 완료하지 못했어요.')) }
    finally { setBusy('') }
  }
  const inviteUrl = snapshot ? `${window.location.origin}/spaces?code=${snapshot.space.joinCode}` : ''
  const activeRooms = snapshot?.rooms.filter(room => ['waiting', 'playing'].includes(room.status)).length ?? 0
  const completedGames = snapshot?.games.filter(game => game.finishedAt).length ?? 0
  const copyWithFeedback = async (value: string, success: string, failure: string) => {
    setError(''); setMessage('')
    if (await copyText(value)) setMessage(success)
    else setError(failure)
  }

  const submitMember = (event: FormEvent) => {
    event.preventDefault(); if (!snapshot) return
    if (memberMode === 'csv') {
      if (!csvRows.length) return setError('가져올 CSV 행이 없습니다.')
      void run('member', async () => { const result = await bulkCreateSpaceAccounts(snapshot.space.id, csvRows, 'CSV 멤버 일괄 등록'); setCreatedCredentials(result.accounts.map(item => ({ email: item.email, password: item.password }))); setMemberOpen(false); setCsvRows([]) }, `${csvRows.length}명 CSV 등록 요청을 처리했어요.`); return
    }
    void run('member', async () => {
      if (memberMode === 'existing') await addExistingSpaceMember(snapshot.space.id, account, '기존 계정 스페이스 초대')
      else {
        const result = await createSpaceAccount(snapshot.space.id, account, '스페이스 사용자 계정 생성')
        if (result.account.password) setCreatedCredentials([{ email: result.account.email, password: result.account.password }])
      }
      setMemberOpen(false); setAccount({ email: '', nickname: '', password: '', role: 'member', externalId: '' })
    }, memberMode === 'existing' ? '기존 계정을 멤버로 추가했어요.' : '사용자 계정을 생성했어요.')
  }
  const parseCsv = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]; if (!file) return
    if (file.size > 1024 * 1024) return setError('CSV 파일은 1MB 이하여야 합니다.')
    const rows = (await file.text()).split(/\r?\n/).filter(Boolean).map(line => line.split(',').map(value => value.trim()))
    if (rows.length < 2) return setError('헤더와 한 개 이상의 데이터 행이 필요합니다.')
    const header = rows[0].map(value => value.toLowerCase())
    const index = (key: string) => header.indexOf(key)
    if (index('email') < 0 || index('nickname') < 0) return setError('CSV 헤더에 email,nickname이 필요합니다.')
    const parsed = rows.slice(1, 101).map(columns => ({ email: columns[index('email')] ?? '', nickname: columns[index('nickname')] ?? '', externalId: index('external_id') >= 0 ? columns[index('external_id')] : '', role: index('role') >= 0 && columns[index('role')] === 'manager' ? 'manager' as const : 'member' as const, password: index('password') >= 0 ? columns[index('password')] : '' })).filter(row => row.email && row.nickname)
    setCsvRows(parsed); setError('')
  }
  const saveSettings = (event: FormEvent) => { event.preventDefault(); if (!snapshot) return; void run('settings', async () => { await updateSpace(snapshot.space.id, { name, slug: spaceSlug, description, joinEnabled, reason: '스페이스 설정 변경' }); if (spaceSlug !== slug) navigate(`/spaces/${encodeURIComponent(spaceSlug)}/admin`, { replace: true }) }, '스페이스 설정을 저장했어요.') }
  const confirmDangerousAction = () => {
    if (!snapshot || !confirmAction) return
    const action = confirmAction
    setConfirmAction(null)
    if (action.type === 'remove-member') void run(`remove-${action.member.userId}`, () => removeSpaceMember(snapshot.space.id, action.member.userId, '스페이스 멤버 삭제'), '멤버를 삭제했어요.')
    else void run('archive', () => updateSpace(snapshot.space.id, { status: 'archived', reason: '운영 종료로 스페이스 비활성화' }), '스페이스를 비활성화했어요.')
  }

  if (loading) return <div className="route-loading">스페이스를 불러오는 중...</div>
  if (!snapshot) return <div className="content-page narrow-page"><div className="admin-empty" role={error ? 'alert' : 'status'}><Building2 /><strong>스페이스를 열 수 없어요.</strong><p>{error || '스페이스 정보를 확인하고 있어요.'}</p>{error && <button className="primary-button" onClick={() => void refresh()}>스페이스 다시 불러오기</button>}<Link to="/spaces">목록으로 돌아가기</Link></div></div>
  return <div className="content-page space-admin-page"><PageHeader eyebrow="SPACE CONTROL" title={`${snapshot.space.name} 관리`} description="멤버, 계정, 방, 전용 카드와 행사 운영 상태를 관리하세요." />
    {(error || message) && <p className={`friends-notice ${error ? 'is-error' : ''}`} role={error ? 'alert' : 'status'}>{error || message}</p>}
    <nav className="space-tabs" aria-label="스페이스 관리 메뉴">{([['overview', '개요'], ['members', '멤버'], ['rooms', '방·게임'], ['cards', '카드'], ['settings', '설정']] as Array<[SpaceTab, string]>).map(([id, label]) => <button className={tab === id ? 'is-active' : ''} onClick={() => setTab(id)} key={id}>{label}</button>)}</nav>
    {tab === 'overview' && <><section className="space-metrics"><article><span>멤버</span><strong>{snapshot.members.length}</strong><small>관리자 {snapshot.members.filter(member => ['owner', 'manager'].includes(member.role)).length}명</small></article><article><span>활성 방</span><strong>{activeRooms}</strong><small>전체 {snapshot.rooms.length}개</small></article><article><span>완료 게임</span><strong>{completedGames}</strong><small>기록 {snapshot.games.length}개</small></article><article><span>카드 세트</span><strong>{snapshot.cardSets.length}</strong><small>게시 {snapshot.cardSets.filter(set => set.status === 'published').length}개</small></article></section><section className="form-card space-invite-card"><div><Link2 /><span><strong>가입 링크</strong><small>{snapshot.space.joinEnabled ? '링크를 가진 사용자가 직접 가입할 수 있습니다.' : '현재 가입 코드 사용이 중지되었습니다.'}</small></span></div><code>{snapshot.space.joinCode}</code><div><button className="secondary-button" onClick={() => void copyWithFeedback(inviteUrl, '가입 링크를 복사했어요.', '가입 링크를 복사하지 못했어요. 화면에서 직접 선택해 주세요.')}><Copy /> 링크 복사</button><button className="secondary-button" disabled={busy === 'rotate'} onClick={() => void run('rotate', async () => { await rotateSpaceCode(snapshot.space.id, '가입 코드 재발급') }, '새 가입 코드를 발급했어요.')}><RefreshCw /> 코드 재발급</button></div></section></>}
    {tab === 'members' && <section className="admin-panel space-admin-panel"><header><div><h2>멤버와 계정</h2><p>기존 계정 초대, 개별 계정 생성, CSV 일괄 생성을 지원합니다.</p></div>{snapshot.actor.canManage && <button className="admin-primary" onClick={() => setMemberOpen(true)}><UserPlus /> 멤버 추가</button>}</header><div className="space-member-table"><div className="space-member-head"><span>사용자</span><span>식별 번호</span><span>역할</span><span>상태</span><span>관리</span></div>{snapshot.members.map(member => <div className="space-member-row" key={member.userId}><span><i className="avatar avatar--2">{member.nickname[0]}</i><span><strong>{member.nickname}</strong><small>{member.email ?? member.phone ?? member.friendTag}</small></span></span><span>{member.externalId || '-'}</span><select aria-label={`${member.nickname} 역할`} value={member.role} disabled={!snapshot.actor.canManage || member.role === 'owner'} onChange={event => void run(`role-${member.userId}`, () => updateSpaceMember(snapshot.space.id, member.userId, event.target.value as 'member' | 'manager', '스페이스 역할 변경'), `${member.nickname}님의 역할을 변경했어요.`)}><option value="member">멤버</option><option value="manager">관리자</option>{member.role === 'owner' && <option value="owner">소유자</option>}</select><span className={member.deleted || member.suspended ? 'status-badge is-banned' : 'status-badge'}>{member.deleted ? '탈퇴' : member.suspended ? '정지' : '정상'}</span><button aria-label={`${member.nickname} 삭제`} disabled={!snapshot.actor.canManage || member.role === 'owner'} onClick={() => setConfirmAction({ type: 'remove-member', member })}><Trash2 /></button></div>)}</div>{createdCredentials.length > 0 && <div className="space-credentials"><strong>이번에 생성된 임시 로그인 정보</strong><p>비밀번호는 이 화면을 닫으면 다시 확인할 수 없습니다.</p>{createdCredentials.map(item => <code key={item.email}>{item.email} · {item.password ?? '기존 계정'}</code>)}<button onClick={() => void copyWithFeedback(createdCredentials.map(item => `${item.email},${item.password ?? ''}`).join('\n'), '임시 로그인 정보를 복사했어요.', '임시 로그인 정보를 복사하지 못했어요. 화면에서 직접 선택해 주세요.')}><Copy /> 복사</button></div>}</section>}
    {tab === 'rooms' && <section className="admin-panel space-admin-panel"><header><div><h2>방과 게임</h2><p>이 스페이스 범위의 방만 표시됩니다.</p></div><Link className="admin-primary" to={`/create?space=${snapshot.space.id}`}><Plus /> 전용 방</Link></header>{snapshot.rooms.length ? <div className="space-room-grid">{snapshot.rooms.map(room => <article key={room.id}><DoorOpen /><div><strong>{room.code}</strong><small>{new Date(room.createdAt).toLocaleString('ko-KR')}</small></div><span>{room.status} · 최대 {room.maxPlayers}명</span></article>)}</div> : <div className="admin-empty"><DoorOpen /><strong>아직 방이 없어요.</strong></div>}</section>}
    {tab === 'cards' && <section className="admin-panel space-admin-panel"><header><div><h2>카드 세트</h2><p>스페이스 전용 카드의 초안과 게시 버전을 관리합니다.</p></div><Link className="admin-primary" to={`/cards?space=${encodeURIComponent(snapshot.space.id)}`}><Plus /> 카드 스튜디오</Link></header>{snapshot.cardSets.length ? <div className="card-set-grid">{snapshot.cardSets.map(set => <Link to={`/cards/${encodeURIComponent(set.id)}`} key={set.id}><article><div className="card-preview preview-default">{set.name[0]}</div><strong>{set.name}</strong><small>{set.isPlatformDefault ? '기본 카드' : '스페이스 전용'} · v{set.version} · {set.status}</small></article></Link>)}</div> : <div className="admin-empty"><ShieldCheck /><strong>사용 가능한 카드가 없어요.</strong></div>}</section>}
    {tab === 'settings' && <form className="form-card space-settings" onSubmit={saveSettings}><h2><Building2 /> 기본 설정</h2><label><span>스페이스 이름</span><input value={name} onChange={event => setName(event.target.value)} minLength={2} maxLength={80} required /></label><label><span>Slug</span><input value={spaceSlug} onChange={event => setSpaceSlug(event.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '').slice(0, 49))} minLength={3} required /></label><label><span>설명</span><textarea rows={3} value={description} onChange={event => setDescription(event.target.value)} /></label><label className="space-toggle"><input type="checkbox" checked={joinEnabled} onChange={event => setJoinEnabled(event.target.checked)} /><span>가입 코드 활성화</span></label><button className="primary-button full-button" disabled={busy === 'settings'}><Save /> {busy === 'settings' ? '저장 중...' : '설정 저장'}</button><button type="button" className="danger-text-button full-button" disabled={snapshot.space.status === 'archived'} onClick={() => setConfirmAction({ type: 'archive-space' })}><Archive /> 스페이스 비활성화</button></form>}
    {confirmAction && <div className="action-confirm" role="dialog" aria-modal="true" aria-labelledby="space-danger-title"><div><Archive aria-hidden="true" /><h2 id="space-danger-title">{confirmAction.type === 'remove-member' ? '멤버를 삭제할까요?' : '스페이스를 비활성화할까요?'}</h2><p>{confirmAction.type === 'remove-member' ? `${confirmAction.member.nickname}님은 이 스페이스의 방과 관리 화면에 접근할 수 없게 됩니다.` : '새 가입과 스페이스 방 생성이 중지됩니다. 기존 기록은 보존됩니다.'}</p><button className="danger-button" autoFocus onClick={confirmDangerousAction}>{confirmAction.type === 'remove-member' ? '멤버 삭제' : '비활성화'}</button><button className="secondary-button" onClick={() => setConfirmAction(null)}>취소</button></div></div>}
    {memberOpen && <div className="admin-modal-backdrop" onMouseDown={event => { if (event.target === event.currentTarget) setMemberOpen(false) }}><form className="admin-modal space-member-modal" role="dialog" aria-modal="true" aria-labelledby="space-member-title" onSubmit={submitMember}><span><UsersRound /></span><h2 id="space-member-title">멤버 추가</h2><div className="space-member-modes"><button type="button" className={memberMode === 'existing' ? 'is-active' : ''} onClick={() => setMemberMode('existing')}>기존 계정</button><button type="button" className={memberMode === 'create' ? 'is-active' : ''} onClick={() => setMemberMode('create')}>계정 생성</button><button type="button" className={memberMode === 'csv' ? 'is-active' : ''} onClick={() => setMemberMode('csv')}>CSV</button></div>{memberMode === 'csv' ? <><label className="space-csv-upload"><FileUp /> CSV 파일 선택<input type="file" accept=".csv,text/csv" onChange={event => void parseCsv(event)} /></label><p>헤더: email,nickname,external_id,role,password · 최대 100명</p><strong>{csvRows.length}개 행 준비됨</strong></> : <><label>이메일<input type="email" value={account.email} onChange={event => setAccount({ ...account, email: event.target.value })} required /></label>{memberMode === 'create' && <><label>닉네임<input value={account.nickname} onChange={event => setAccount({ ...account, nickname: event.target.value })} minLength={2} maxLength={12} required /></label><label>임시 비밀번호<input type="password" value={account.password} onChange={event => setAccount({ ...account, password: event.target.value })} placeholder="비워두면 자동 생성" /></label></>}<label>단체 내 식별 번호<input value={account.externalId} onChange={event => setAccount({ ...account, externalId: event.target.value })} /></label><label>역할<select value={account.role} onChange={event => setAccount({ ...account, role: event.target.value as 'member' | 'manager' })}><option value="member">멤버</option><option value="manager">관리자</option></select></label></>}<div><button type="button" className="secondary-button" onClick={() => setMemberOpen(false)}>취소</button><button className="full-button" disabled={busy === 'member'}>{busy === 'member' ? '처리 중...' : '추가'}</button></div></form></div>}
  </div>
}
