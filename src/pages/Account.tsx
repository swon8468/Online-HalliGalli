import { AtSign, Check, Copy, KeyRound, LogOut, Phone, RefreshCw, ShieldCheck, Trash2, UserRound } from 'lucide-react'
import { useEffect, useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../auth/AuthContext'
import PageHeader from '../components/PageHeader'
import { changeAccountPassword, deleteAccount, getAccountProfile, updateAccountProfile, type AccountProfile } from '../lib/account'
import { translateAuthError } from '../lib/authErrors'
import { copyText } from '../lib/clipboard'
import { createShortId } from '../lib/id'
import { findMyActiveSession, type ActiveSession } from '../lib/rooms'

export default function Account() {
  const { user, signOut, signOutAll, refreshUser } = useAuth()
  const navigate = useNavigate()
  const [profile, setProfile] = useState<AccountProfile | null>(null)
  const [nickname, setNickname] = useState('')
  const [avatarSeed, setAvatarSeed] = useState('')
  const [password, setPassword] = useState('')
  const [passwordConfirm, setPasswordConfirm] = useState('')
  const [deleteConfirmation, setDeleteConfirmation] = useState('')
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [busy, setBusy] = useState('')
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const [activeSession, setActiveSession] = useState<ActiveSession | null>(null)

  useEffect(() => {
    void getAccountProfile().then(value => { setProfile(value); setNickname(value.nickname); setAvatarSeed(value.avatarSeed) }).catch(cause => setError(translateAuthError(cause, '프로필을 불러오지 못했어요.')))
    void findMyActiveSession().then(setActiveSession).catch(() => undefined)
  }, [])
  const run = async (key: string, action: () => Promise<void>, success: string) => {
    setBusy(key); setError(''); setMessage('')
    try { await action(); setMessage(success) } catch (cause) { setError(translateAuthError(cause)) } finally { setBusy('') }
  }
  const saveProfile = (event: FormEvent) => {
    event.preventDefault()
    if (nickname.trim().length < 2) return setError('닉네임은 2자 이상 입력해 주세요.')
    void run('profile', async () => { await updateAccountProfile(nickname, avatarSeed); await refreshUser(); setProfile(await getAccountProfile()) }, '프로필을 저장했어요.')
  }
  const savePassword = (event: FormEvent) => {
    event.preventDefault()
    if (password.length < 8) return setError('비밀번호는 8자 이상 입력해 주세요.')
    if (password !== passwordConfirm) return setError('비밀번호가 서로 일치하지 않아요.')
    void run('password', async () => { await changeAccountPassword(password); setPassword(''); setPasswordConfirm('') }, '비밀번호를 변경했어요.')
  }
  const confirmDelete = () => void run('delete', async () => { await deleteAccount(deleteConfirmation); await signOutAll(); navigate('/', { replace: true }) }, '')
  const copyFriendTag = async () => {
    if (!profile) return
    setError(''); setMessage('')
    if (await copyText(profile.friendTag)) setMessage('친구 태그를 복사했어요.')
    else setError('친구 태그를 복사하지 못했어요. 화면의 태그를 직접 입력해 주세요.')
  }

  return <div className="content-page account-page"><PageHeader eyebrow="MY ACCOUNT" title="내 계정을 관리해요." description="프로필, 보안, 로그인 상태를 한곳에서 확인하세요." />
    {(message || error) && <p className={`friends-notice ${error ? 'is-error' : ''}`} role={error ? 'alert' : 'status'}>{error || message}</p>}
    <div className="account-grid">
      <form className="form-card account-card" onSubmit={saveProfile}><h2><UserRound /> 프로필</h2>{profile ? <><div className="account-avatar" aria-hidden="true">{nickname.slice(0, 1) || '?'}</div><label><span>닉네임</span><input value={nickname} onChange={event => setNickname(event.target.value.slice(0, 12))} minLength={2} maxLength={12} required /></label><label><span>아바타 스타일</span><div className="account-inline"><input value={avatarSeed} onChange={event => setAvatarSeed(event.target.value.slice(0, 32))} /><button type="button" aria-label="아바타 무작위 변경" onClick={() => setAvatarSeed(createShortId())}><RefreshCw /></button></div></label><div className="account-readonly"><span>친구 태그</span><strong>{profile.friendTag}</strong><button type="button" aria-label="친구 태그 복사" onClick={() => void copyFriendTag()}><Copy /></button></div><button className="primary-button full-button" disabled={busy === 'profile'}>{busy === 'profile' ? '저장 중...' : <><Check /> 프로필 저장</>}</button></> : <p role="status">프로필을 불러오는 중...</p>}</form>
      <section className="form-card account-card"><h2><ShieldCheck /> 로그인 정보</h2><div className="account-identity">{user?.email ? <AtSign /> : <Phone />}<span><strong>{user?.email ?? user?.phone ?? '연결된 계정'}</strong><small>{user?.email ? user.emailConfirmed ? '이메일 인증 완료' : '이메일 인증 대기' : user?.phoneConfirmed ? '전화번호 인증 완료' : '전화번호 인증 대기'}</small></span></div>{activeSession && <button className="secondary-button full-button" onClick={() => navigate(activeSession.type === 'game' ? `/game?game=${encodeURIComponent(activeSession.gameId)}` : `/room/${encodeURIComponent(activeSession.roomId)}`)}>진행 중인 {activeSession.type === 'game' ? '게임' : '대기방'}으로 이동</button>}<button className="secondary-button full-button" onClick={() => void signOut()}><LogOut /> 이 기기에서 로그아웃</button><button className="text-button full-button" onClick={() => void signOutAll()}><LogOut /> 모든 기기에서 로그아웃</button></section>
      <form className="form-card account-card" onSubmit={savePassword}><h2><KeyRound /> 비밀번호 변경</h2><label><span>새 비밀번호</span><input type="password" value={password} onChange={event => setPassword(event.target.value)} minLength={8} placeholder="8자 이상" required /></label><label><span>새 비밀번호 확인</span><input type="password" value={passwordConfirm} onChange={event => setPasswordConfirm(event.target.value)} minLength={8} placeholder="한 번 더 입력" required /></label><button className="primary-button full-button" disabled={busy === 'password'}>{busy === 'password' ? '변경 중...' : '비밀번호 변경'}</button></form>
      <section className="form-card account-card account-danger"><h2><Trash2 /> 회원 탈퇴</h2><p>친구, 방, 게임 기록에 더 이상 접근할 수 없으며 되돌릴 수 없습니다.</p>{deleteOpen ? <><label><span>확인을 위해 “회원 탈퇴” 입력</span><input value={deleteConfirmation} onChange={event => setDeleteConfirmation(event.target.value)} placeholder="회원 탈퇴" /></label><button className="danger-button full-button" disabled={deleteConfirmation !== '회원 탈퇴' || busy === 'delete'} onClick={confirmDelete}>{busy === 'delete' ? '처리 중...' : '영구 탈퇴'}</button><button className="text-button full-button" onClick={() => { setDeleteOpen(false); setDeleteConfirmation('') }}>취소</button></> : <button className="danger-text-button full-button" onClick={() => setDeleteOpen(true)}><Trash2 /> 탈퇴 절차 시작</button>}</section>
    </div>
  </div>
}
