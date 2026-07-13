import { supabase } from './supabase'

export interface GameInvite {
  id: string
  roomId: string
  roomCode: string
  roomStatus: 'waiting' | 'playing' | 'finished' | 'closed'
  userId: string
  nickname: string
  friendTag: string
  expiresAt: string
  createdAt: string
}

export interface GameInvitesOverview {
  received: GameInvite[]
  sent: GameInvite[]
}

export interface GameInviteContext {
  available: boolean
  roomId?: string
  roomCode?: string
  maxPlayers?: number
}

function client() {
  if (!supabase) throw new Error('Supabase가 설정되지 않았습니다.')
  return supabase
}

export async function getGameInviteContext(): Promise<GameInviteContext> {
  const { data, error } = await client().rpc('get_game_invite_context')
  if (error) throw error
  return (data ?? { available: false }) as GameInviteContext
}

export async function getGameInvites(): Promise<GameInvitesOverview> {
  const { data, error } = await client().rpc('get_game_invites')
  if (error) throw error
  const value = (data && typeof data === 'object' ? data : {}) as Record<string, unknown>
  return {
    received: Array.isArray(value.received) ? value.received as GameInvite[] : [],
    sent: Array.isArray(value.sent) ? value.sent as GameInvite[] : [],
  }
}

export async function sendGameInvite(receiverId: string, roomId: string) {
  const { data, error } = await client().rpc('send_game_invite', { p_receiver_id: receiverId, p_room_id: roomId })
  if (error) throw error
  const invite = data as { id: string }
  const push = await client().functions.invoke('send-push', { body: { inviteId: invite.id } })
  return { ...invite, pushDelivered: !push.error, pushError: push.error?.message }
}

export async function respondGameInvite(inviteId: string, accept: boolean) {
  const { data, error } = await client().rpc('respond_game_invite', { p_invite_id: inviteId, p_accept: accept })
  if (error) throw error
  return data as { status: 'accepted' | 'declined', roomId?: string, roomCode?: string }
}

export async function cancelGameInvite(inviteId: string) {
  const { error } = await client().rpc('cancel_game_invite', { p_invite_id: inviteId })
  if (error) throw error
}

export function subscribeToGameInvites(userId: string, onChange: () => void) {
  if (!supabase) return () => undefined
  const channel = supabase.channel(`game-invites:${userId}`)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'game_invites' }, onChange)
    .subscribe(status => {
      // Close the initial-fetch/subscription race with an authoritative refresh.
      if (status === 'SUBSCRIBED') onChange()
    })
  return () => { void supabase?.removeChannel(channel) }
}

const MESSAGES: Record<string, string> = {
  authentication_required: '로그인이 필요합니다.',
  cannot_invite_self: '자기 자신은 초대할 수 없습니다.',
  account_unavailable: '정지되었거나 사용할 수 없는 계정입니다.',
  room_not_invitable: '이미 시작되었거나 닫힌 방이라 초대할 수 없어요.',
  not_room_member: '현재 대기방 참가자만 친구를 초대할 수 있어요.',
  friends_only: '친구만 게임에 초대할 수 있어요.',
  invite_unavailable: '이 친구에게 초대를 보낼 수 없어요.',
  invitee_was_kicked: '이 방에서 강퇴된 사용자는 다시 초대할 수 없어요.',
  room_full: '방이 가득 찼어요.',
  invitee_busy: '친구가 다른 방이나 게임에 참여 중이에요.',
  invite_rate_limited: '초대를 너무 자주 보냈어요. 잠시 후 다시 시도해 주세요.',
  already_invited: '이미 이 방으로 초대했어요.',
  invite_not_available: '이미 처리되었거나 취소된 초대입니다.',
  invite_expired: '초대가 만료됐어요.',
  inviter_left_room: '초대한 친구가 방을 나갔어요.',
  active_session_exists: '진행 중인 방이나 게임을 먼저 종료해 주세요.',
}

export function inviteErrorMessage(error: unknown) {
  const raw = error instanceof Error ? error.message : String(error)
  const key = Object.keys(MESSAGES).find(candidate => raw.includes(candidate))
  return key ? MESSAGES[key] : '게임 초대를 처리하지 못했어요. 잠시 후 다시 시도해 주세요.'
}
