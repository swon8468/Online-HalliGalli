import { supabase } from './supabase'

export interface MatchmakingMember {
  userId: string
  nickname: string
  seat: number
}

export interface MatchmakingStatus {
  status: 'idle' | 'waiting' | 'matched'
  playerCount?: number
  queueCount: number
  roomId?: string
  gameId?: string
  members: MatchmakingMember[]
  heartbeatAt?: string
}

function client() {
  if (!supabase) throw new Error('Supabase가 설정되지 않았습니다.')
  return supabase
}

function normalize(data: unknown): MatchmakingStatus {
  const value = (data && typeof data === 'object' ? data : {}) as Record<string, unknown>
  const status = value.status === 'waiting' || value.status === 'matched' ? value.status : 'idle'
  return {
    status,
    playerCount: typeof value.playerCount === 'number' ? value.playerCount : undefined,
    queueCount: typeof value.queueCount === 'number' ? value.queueCount : 0,
    roomId: typeof value.roomId === 'string' ? value.roomId : undefined,
    gameId: typeof value.gameId === 'string' ? value.gameId : undefined,
    members: Array.isArray(value.members) ? value.members as MatchmakingMember[] : [],
    heartbeatAt: typeof value.heartbeatAt === 'string' ? value.heartbeatAt : undefined,
  }
}

async function rpc(name: string, parameters?: Record<string, unknown>) {
  const { data, error } = await client().rpc(name, parameters)
  if (error) throw error
  return normalize(data)
}

export const getMatchmakingStatus = () => rpc('get_matchmaking_status')
export const joinMatchmaking = (playerCount: number) => rpc('join_matchmaking', { p_player_count: playerCount })
export const heartbeatMatchmaking = () => rpc('heartbeat_matchmaking')
export const cancelMatchmaking = () => rpc('cancel_matchmaking')

export function subscribeToMatchmaking(userId: string, onChange: () => void) {
  if (!supabase) return () => undefined
  const channel = supabase.channel(`matchmaking:${userId}`)
    .on('postgres_changes', {
      event: '*', schema: 'public', table: 'matchmaking_queue', filter: `user_id=eq.${userId}`,
    }, onChange)
    .subscribe()
  return () => { void supabase?.removeChannel(channel) }
}

export function subscribeToOnlineUsers(userId: string, onUsers: (userIds: Set<string>) => void) {
  if (!supabase) return () => undefined
  const channel = supabase.channel('online-users', { config: { presence: { key: userId } } })
    .on('presence', { event: 'sync' }, () => onUsers(new Set(Object.keys(channel.presenceState()))))
    .subscribe(status => {
      if (status === 'SUBSCRIBED') void channel.track({ onlineAt: new Date().toISOString() })
    })
  return () => { void supabase?.removeChannel(channel) }
}

export function subscribeToOnlinePresence(userId: string, onCount: (count: number) => void) {
  return subscribeToOnlineUsers(userId, userIds => onCount(userIds.size))
}
