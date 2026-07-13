import { Ban, BellRing, Check, Clock3, Gamepad2, LoaderCircle, Search, UserCheck, UserMinus, UserPlus, UsersRound, X } from 'lucide-react'
import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { useAuth } from '../auth/AuthContext'
import PageHeader from '../components/PageHeader'
import {
  blockFriendUser,
  cancelFriendRequest,
  friendErrorMessage,
  getFriendsOverview,
  removeFriend,
  respondFriendRequest,
  searchFriendUsers,
  sendFriendRequest,
  subscribeToFriendChanges,
  unblockFriendUser,
  type FriendOverview,
  type FriendProfile,
  type FriendSearchResult,
} from '../lib/friends'
import { subscribeToOnlineUsers } from '../lib/matchmaking'
import { getGameInviteContext, inviteErrorMessage, sendGameInvite, type GameInviteContext } from '../lib/invites'
import { disablePushNotifications, enablePushNotifications, getPushNotificationStatus } from '../lib/push'
import { getErrorMessage } from '../lib/errorMessage'

const EMPTY_OVERVIEW: FriendOverview = { friends: [], received: [], sent: [], blocked: [] }
type PushState = 'loading' | 'unsupported' | 'disabled' | 'enabled'

function avatarClass(seed: string) {
  const value = [...seed].reduce((sum, character) => sum + character.charCodeAt(0), 0)
  return `avatar--${value % 4 + 1}`
}

function relativeTime(value?: string) {
  if (!value) return ''
  const elapsed = Date.now() - new Date(value).getTime()
  if (elapsed < 60_000) return '방금 전'
  if (elapsed < 3_600_000) return `${Math.max(1, Math.floor(elapsed / 60_000))}분 전`
  if (elapsed < 86_400_000) return `${Math.floor(elapsed / 3_600_000)}시간 전`
  return `${Math.floor(elapsed / 86_400_000)}일 전`
}

function Avatar({ profile, online }: { profile: FriendProfile, online?: boolean }) {
  return (
    <span className={`avatar ${avatarClass(profile.avatarSeed)}`} aria-hidden="true">
      {profile.nickname.slice(0, 1)}
      <i className={online ? 'is-online' : ''} />
    </span>
  )
}

export default function Friends() {
  const { user } = useAuth()
  const [tab, setTab] = useState<'friends' | 'requests'>('friends')
  const [overview, setOverview] = useState<FriendOverview>(EMPTY_OVERVIEW)
  const [onlineUsers, setOnlineUsers] = useState<Set<string>>(new Set())
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<FriendSearchResult[]>([])
  const [loading, setLoading] = useState(true)
  const [searching, setSearching] = useState(false)
  const [actionKey, setActionKey] = useState('')
  const [confirmKey, setConfirmKey] = useState('')
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const [inviteContext, setInviteContext] = useState<GameInviteContext>({ available: false })
  const [pushState, setPushState] = useState<PushState>('loading')
  const [pushBusy, setPushBusy] = useState(false)

  const loadOverview = useCallback(async () => {
    try {
      setOverview(await getFriendsOverview())
      setError('')
    } catch (cause) {
      setError(friendErrorMessage(cause))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (!user) return
    void loadOverview()
    void getGameInviteContext().then(setInviteContext).catch(() => setInviteContext({ available: false }))
    void getPushNotificationStatus().then(setPushState).catch(() => setPushState('disabled'))
    const unsubscribeChanges = subscribeToFriendChanges(user.id, () => void loadOverview())
    const unsubscribePresence = subscribeToOnlineUsers(user.id, setOnlineUsers)
    return () => {
      unsubscribeChanges()
      unsubscribePresence()
    }
  }, [loadOverview, user])

  const refreshSearch = useCallback(async () => {
    if (query.trim().length < 2) return
    setResults(await searchFriendUsers(query))
  }, [query])

  const runAction = async (key: string, action: () => Promise<unknown>, success: string) => {
    setActionKey(key)
    setMessage('')
    setError('')
    try {
      await action()
      setMessage(success)
      setConfirmKey('')
      await loadOverview()
      await refreshSearch()
    } catch (cause) {
      setError(friendErrorMessage(cause))
    } finally {
      setActionKey('')
    }
  }

  const handleSearch = async (event: FormEvent) => {
    event.preventDefault()
    setMessage('')
    setError('')
    if (query.trim().length < 2) {
      setResults([])
      setError('닉네임 또는 친구 태그를 2자 이상 입력해 주세요.')
      return
    }
    setSearching(true)
    try {
      setResults(await searchFriendUsers(query))
    } catch (cause) {
      setResults([])
      setError(friendErrorMessage(cause))
    } finally {
      setSearching(false)
    }
  }

  const requestCount = overview.received.length + overview.sent.length
  const onlineFriendCount = overview.friends.filter(friend => onlineUsers.has(friend.userId)).length
  const togglePush = async () => {
    if (!user || pushBusy || pushState === 'loading' || pushState === 'unsupported') return
    setPushBusy(true)
    setError(''); setMessage('')
    try {
      if (pushState === 'enabled') { await disablePushNotifications(); setPushState('disabled'); setMessage('초대 알림을 껐어요.') }
      else { await enablePushNotifications(); setPushState('enabled'); setMessage('초대 알림을 켰어요.') }
    } catch (cause) { setError(getErrorMessage(cause, '알림 설정을 변경하지 못했어요.')) }
    finally { setPushBusy(false) }
  }

  const inviteFriend = async (friend: FriendProfile) => {
    if (!inviteContext.roomId) return
    setActionKey(`invite:${friend.userId}`); setError(''); setMessage('')
    try { await sendGameInvite(friend.userId, inviteContext.roomId); setMessage(`${friend.nickname}님에게 게임 초대를 보냈어요.`) }
    catch (cause) { setError(inviteErrorMessage(cause)) }
    finally { setActionKey('') }
  }

  return (
    <div className="content-page friends-page">
      <PageHeader eyebrow="FRIENDS" title="함께하면 더 즐거워요." description="친구의 상태를 확인하고 게임에 초대하세요." />
      <div className="friends-toolbar">
        <div className="segmented-control" aria-label="친구 메뉴">
          <button className={tab === 'friends' ? 'is-active' : ''} onClick={() => setTab('friends')}>친구 <span>{overview.friends.length}</span></button>
          <button className={tab === 'requests' ? 'is-active' : ''} onClick={() => setTab('requests')}>요청 <span>{requestCount}</span></button>
        </div>
        <form className="search-field" onSubmit={handleSearch} role="search">
          <Search aria-hidden="true" />
          <label className="sr-only" htmlFor="friend-search">친구 닉네임 또는 태그</label>
          <input id="friend-search" value={query} onChange={event => setQuery(event.target.value)} placeholder="닉네임 또는 태그 검색" autoComplete="off" />
          <button type="submit" aria-label="친구 검색" disabled={searching}>{searching ? <LoaderCircle className="is-spinning" /> : <UserPlus />}</button>
        </form>
        <button className={`push-enable ${pushState === 'enabled' ? 'is-enabled' : ''}`} onClick={() => void togglePush()} disabled={pushBusy || pushState === 'loading' || pushState === 'unsupported'}>
          <BellRing /> {pushBusy ? '알림 변경 중' : pushState === 'loading' ? '알림 확인 중' : pushState === 'unsupported' ? '이 브라우저는 알림 미지원' : pushState === 'enabled' ? '초대 알림 끄기' : '초대 알림 켜기'}
        </button>
      </div>

      {(message || error) && <p className={`friends-notice ${error ? 'is-error' : ''}`} role={error ? 'alert' : 'status'}>{error || message}</p>}

      {query.trim().length > 0 && (
        <section className="friends-list search-results" aria-labelledby="search-results-title">
          <div className="section-title"><div><h2 id="search-results-title">검색 결과</h2><p>닉네임과 고유 친구 태그로 찾았어요.</p></div></div>
          {searching ? <LoadingState label="친구를 찾고 있어요." /> : results.length > 0 ? results.map(result => (
            <article className="friend-row" key={result.userId}>
              <Avatar profile={result} online={onlineUsers.has(result.userId)} />
              <span><strong>{result.nickname}</strong><small>{result.friendTag}</small></span>
              <SearchAction result={result} busy={actionKey === `send:${result.userId}`} onSend={() => void runAction(`send:${result.userId}`, () => sendFriendRequest(result.userId), '친구 요청을 보냈어요.')} onShowRequests={() => setTab('requests')} />
            </article>
          )) : <EmptyState title="검색 결과가 없어요." description="닉네임 또는 #이 포함된 친구 태그를 확인해 주세요." />}
        </section>
      )}

      {tab === 'friends' ? (
        <section className="friends-list" aria-labelledby="friends-list-title">
          <div className="section-title"><div><h2 id="friends-list-title">내 친구</h2><p>{onlineFriendCount}명 온라인 · 총 {overview.friends.length}명</p></div></div>
          {loading ? <LoadingState label="친구 목록을 불러오고 있어요." /> : overview.friends.length > 0 ? overview.friends.map(friend => {
            const online = onlineUsers.has(friend.userId)
            const confirmingRemove = confirmKey === `remove:${friend.userId}`
            const confirmingBlock = confirmKey === `block:${friend.userId}`
            return (
              <article className="friend-row" key={friend.userId}>
                <Avatar profile={friend} online={online} />
                <span>
                  <strong>{friend.nickname}</strong>
                  <small>{friend.activity === 'in_game' ? '게임 중' : online ? '온라인' : '오프라인'} · {friend.friendTag}</small>
                </span>
                {inviteContext.available && <button className="invite-button" onClick={() => void inviteFriend(friend)} disabled={Boolean(actionKey)}>{actionKey === `invite:${friend.userId}` ? <LoaderCircle className="is-spinning" /> : <BellRing />} 게임 초대</button>}
                {friend.activity === 'in_game' && <span className="friend-activity"><Gamepad2 /> 게임 중</span>}
                <div className="friend-manage-actions">
                  {confirmingRemove ? <><button className="confirm-action" onClick={() => void runAction(`remove:${friend.userId}`, () => removeFriend(friend.userId), '친구를 삭제했어요.')} disabled={Boolean(actionKey)}>삭제 확인</button><button onClick={() => setConfirmKey('')}>취소</button></> :
                    <button aria-label={`${friend.nickname} 친구 삭제`} title="친구 삭제" onClick={() => setConfirmKey(`remove:${friend.userId}`)}><UserMinus /></button>}
                  {confirmingBlock ? <><button className="confirm-action is-danger" onClick={() => void runAction(`block:${friend.userId}`, () => blockFriendUser(friend.userId), '사용자를 차단했어요.')} disabled={Boolean(actionKey)}>차단 확인</button><button onClick={() => setConfirmKey('')}>취소</button></> :
                    <button aria-label={`${friend.nickname} 차단`} title="차단" onClick={() => setConfirmKey(`block:${friend.userId}`)}><Ban /></button>}
                </div>
              </article>
            )
          }) : <EmptyState title="아직 친구가 없어요." description="위 검색창에서 닉네임이나 친구 태그를 검색해 보세요." />}
        </section>
      ) : (
        <section className="friends-list request-list" aria-labelledby="received-requests-title">
          <div className="section-title"><div><h2 id="received-requests-title">받은 요청</h2><p>친구 요청을 확인하세요.</p></div></div>
          {loading ? <LoadingState label="친구 요청을 불러오고 있어요." /> : overview.received.length > 0 ? overview.received.map(request => (
            <article className="friend-row" key={request.id}>
              <Avatar profile={request} online={onlineUsers.has(request.userId)} />
              <span><strong>{request.nickname}</strong><small>{request.friendTag} · {relativeTime(request.createdAt)}</small></span>
              <div className="request-actions">
                <button aria-label={`${request.nickname} 요청 수락`} onClick={() => void runAction(`accept:${request.id}`, () => respondFriendRequest(request.id, true), '친구 요청을 수락했어요.')} disabled={Boolean(actionKey)}>{actionKey === `accept:${request.id}` ? <LoaderCircle className="is-spinning" /> : <Check />}</button>
                <button aria-label={`${request.nickname} 요청 거절`} onClick={() => void runAction(`decline:${request.id}`, () => respondFriendRequest(request.id, false), '친구 요청을 거절했어요.')} disabled={Boolean(actionKey)}><X /></button>
              </div>
            </article>
          )) : <EmptyState title="새로운 요청이 없어요." description="친구를 검색해 먼저 요청을 보내 보세요." />}

          <h3 className="subsection-title"><Clock3 /> 보낸 요청</h3>
          {overview.sent.length > 0 ? overview.sent.map(request => (
            <article className="friend-row" key={request.id}>
              <Avatar profile={request} online={onlineUsers.has(request.userId)} />
              <span><strong>{request.nickname}</strong><small>{request.friendTag} · 수락 대기 중</small></span>
              <button className="text-button" onClick={() => void runAction(`cancel:${request.id}`, () => cancelFriendRequest(request.id), '보낸 요청을 취소했어요.')} disabled={Boolean(actionKey)}>취소</button>
            </article>
          )) : <p className="friends-inline-empty">보낸 요청이 없어요.</p>}

          {overview.blocked.length > 0 && <>
            <h3 className="subsection-title"><Ban /> 차단한 사용자</h3>
            {overview.blocked.map(blocked => (
              <article className="friend-row" key={blocked.userId}>
                <Avatar profile={blocked} />
                <span><strong>{blocked.nickname}</strong><small>{blocked.friendTag}</small></span>
                <button className="text-button" onClick={() => void runAction(`unblock:${blocked.userId}`, () => unblockFriendUser(blocked.userId), '차단을 해제했어요.')} disabled={Boolean(actionKey)}>차단 해제</button>
              </article>
            ))}
          </>}
        </section>
      )}
    </div>
  )
}

function SearchAction({ result, busy, onSend, onShowRequests }: { result: FriendSearchResult, busy: boolean, onSend: () => void, onShowRequests: () => void }) {
  if (result.relationship === 'self') return <span className="relationship-label">내 계정</span>
  if (result.relationship === 'friend') return <span className="relationship-label"><UserCheck /> 친구</span>
  if (result.relationship === 'sent') return <span className="relationship-label"><Clock3 /> 요청 보냄</span>
  if (result.relationship === 'received') return <button className="text-button" onClick={onShowRequests}>요청 확인</button>
  return <button className="invite-button" onClick={onSend} disabled={busy}>{busy ? <LoaderCircle className="is-spinning" /> : <UserPlus />} 친구 요청</button>
}

function LoadingState({ label }: { label: string }) {
  return <div className="empty-state friends-loading" role="status"><LoaderCircle className="is-spinning" /><strong>{label}</strong></div>
}

function EmptyState({ title, description }: { title: string, description: string }) {
  return <div className="empty-state"><UsersRound /><strong>{title}</strong><p>{description}</p></div>
}
