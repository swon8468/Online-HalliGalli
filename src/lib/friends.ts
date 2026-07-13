import { supabase } from './supabase'
import { getErrorMessage } from './errorMessage'

export interface FriendProfile {
  userId: string
  nickname: string
  friendTag: string
  avatarSeed: string
  activity?: 'idle' | 'in_game'
  createdAt?: string
  friendsSince?: string
}

export interface FriendRequest extends FriendProfile {
  id: string
  createdAt: string
}

export interface FriendOverview {
  friends: FriendProfile[]
  received: FriendRequest[]
  sent: FriendRequest[]
  blocked: FriendProfile[]
}

export interface FriendSearchResult extends FriendProfile {
  relationship: 'self' | 'friend' | 'sent' | 'received' | 'none'
}

const EMPTY_OVERVIEW: FriendOverview = { friends: [], received: [], sent: [], blocked: [] }

function client() {
  if (!supabase) throw new Error('Supabase가 설정되지 않았습니다.')
  return supabase
}

function asArray<T>(value: unknown) {
  return Array.isArray(value) ? value as T[] : []
}

export async function getFriendsOverview(): Promise<FriendOverview> {
  const { data, error } = await client().rpc('get_friends_overview')
  if (error) throw error
  const value = (data && typeof data === 'object' ? data : EMPTY_OVERVIEW) as Record<string, unknown>
  return {
    friends: asArray<FriendProfile>(value.friends),
    received: asArray<FriendRequest>(value.received),
    sent: asArray<FriendRequest>(value.sent),
    blocked: asArray<FriendProfile>(value.blocked),
  }
}

export async function searchFriendUsers(query: string): Promise<FriendSearchResult[]> {
  const { data, error } = await client().rpc('search_friend_users', { p_query: query.trim() })
  if (error) throw error
  return (data ?? []).map((row: {
    user_id: string
    nickname: string
    friend_tag: string
    avatar_seed: string
    relationship: FriendSearchResult['relationship']
    activity: FriendSearchResult['activity']
  }) => ({
    userId: row.user_id,
    nickname: row.nickname,
    friendTag: row.friend_tag,
    avatarSeed: row.avatar_seed,
    relationship: row.relationship,
    activity: row.activity,
  })) as FriendSearchResult[]
}

async function rpc(name: string, parameters: Record<string, unknown>) {
  const { data, error } = await client().rpc(name, parameters)
  if (error) throw error
  return data
}

export const sendFriendRequest = (receiverId: string) => rpc('send_friend_request', { p_receiver_id: receiverId })
export const respondFriendRequest = (requestId: string, accept: boolean) => rpc('respond_friend_request', { p_request_id: requestId, p_accept: accept })
export const cancelFriendRequest = (requestId: string) => rpc('cancel_friend_request', { p_request_id: requestId })
export const removeFriend = (friendId: string) => rpc('remove_friend', { p_friend_id: friendId })
export const blockFriendUser = (userId: string) => rpc('block_friend_user', { p_user_id: userId })
export const unblockFriendUser = (userId: string) => rpc('unblock_friend_user', { p_user_id: userId })

export function subscribeToFriendChanges(userId: string, onChange: () => void) {
  if (!supabase) return () => undefined
  const channel = supabase.channel(`friends:${userId}`)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'friend_requests' }, onChange)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'friendships' }, onChange)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'friend_blocks' }, onChange)
    .subscribe(status => {
      // Reconcile once the server-side subscription is live so a change between
      // the page's initial fetch and SUBSCRIBED cannot remain invisible.
      if (status === 'SUBSCRIBED') onChange()
    })
  return () => { void supabase?.removeChannel(channel) }
}

const ERROR_MESSAGES: Record<string, string> = {
  authentication_required: '로그인이 필요합니다.',
  invalid_search_query: '검색어를 2자 이상 입력해 주세요.',
  cannot_friend_self: '자기 자신에게 친구 요청을 보낼 수 없습니다.',
  cannot_block_self: '자기 자신을 차단할 수 없습니다.',
  account_unavailable: '정지되었거나 사용할 수 없는 계정입니다.',
  friend_unavailable: '요청을 보낼 수 없는 사용자입니다.',
  already_friends: '이미 친구인 사용자입니다.',
  already_requested: '이미 친구 요청을 보냈습니다.',
  request_not_available: '이미 처리되었거나 만료된 요청입니다.',
  friendship_not_found: '친구 관계를 찾을 수 없습니다.',
  block_not_found: '차단 정보를 찾을 수 없습니다.',
}

export function friendErrorMessage(error: unknown) {
  const raw = getErrorMessage(error)
  const key = Object.keys(ERROR_MESSAGES).find(candidate => raw.includes(candidate))
  return key ? ERROR_MESSAGES[key] : '친구 정보를 처리하지 못했어요. 잠시 후 다시 시도해 주세요.'
}
