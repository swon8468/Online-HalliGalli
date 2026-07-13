import { supabase } from './supabase'

export interface RoomInfo {
  id: string
  code: string
  maxPlayers: number
  status: 'waiting' | 'playing' | 'finished' | 'closed'
  hostId: string
}

export interface RoomMemberInfo {
  userId: string
  nickname: string
  role: 'host' | 'player'
  seat: number
}

export interface GamePlayerInfo {
  userId: string
  nickname: string
  seat: number
  cardCount: number
  isCurrentTurn: boolean
}

export type GameFruit = 'strawberry' | 'banana' | 'lime' | 'plum'

export interface GameTableCard {
  userId: string
  fruit: GameFruit
  count: number
}

export interface GameSnapshot {
  phase: 'playing' | 'finished'
  round: number
  version: number
  currentTurn: string
  table: GameTableCard[]
  fruitTotals: Record<GameFruit, number>
  bellActive: boolean
  winnerId: string | null
  lastResult?: { type: 'reveal' | 'ring'; userId: string; correct: boolean | null; fruit: GameFruit | null; count: number | null } | null
}

export interface GameView {
  state: GameSnapshot
  players: GamePlayerInfo[]
}

function requireSupabase() {
  if (!supabase) throw new Error('Supabase가 설정되지 않았습니다.')
  return supabase
}

export async function createPrivateRoom(maxPlayers: number): Promise<RoomInfo> {
  const client = requireSupabase()
  const { data, error } = await client.rpc('create_private_room', { p_max_players: maxPlayers })
  if (error) throw error
  const room = Array.isArray(data) ? data[0] : data
  if (!room) throw new Error('방을 생성하지 못했습니다.')
  return { id: room.id, code: room.code, maxPlayers: room.max_players, status: room.status, hostId: room.host_id }
}

export async function joinPrivateRoom(code: string): Promise<RoomInfo> {
  const client = requireSupabase()
  const { data, error } = await client.rpc('join_private_room', { p_code: code })
  if (error) throw error
  const room = Array.isArray(data) ? data[0] : data
  if (!room) throw new Error('참여할 방을 찾지 못했습니다.')
  return { id: room.id, code: room.code, maxPlayers: room.max_players, status: room.status, hostId: room.host_id }
}

export async function loadRoomMembers(roomId: string): Promise<RoomMemberInfo[]> {
  const client = requireSupabase()
  const { data, error } = await client.from('room_members').select('user_id,role,seat,profiles(nickname)').eq('room_id', roomId).is('kicked_at', null).order('seat')
  if (error) throw error
  return (data ?? []).map(member => {
    const profile = Array.isArray(member.profiles) ? member.profiles[0] : member.profiles
    return { userId: member.user_id, nickname: profile?.nickname ?? '플레이어', role: member.role, seat: member.seat ?? 0 }
  })
}

export async function kickRoomMember(roomId: string, userId: string) {
  const { error } = await requireSupabase().rpc('kick_room_member', { p_room_id: roomId, p_user_id: userId })
  if (error) throw error
}

export async function leaveRoom(roomId: string) {
  const { error } = await requireSupabase().rpc('leave_room', { p_room_id: roomId })
  if (error) throw error
}

export async function startRoomGame(roomId: string) {
  const { data, error } = await requireSupabase().rpc('start_room_game', { p_room_id: roomId })
  if (error) throw error
  return data as string
}

export async function loadRoomGame(roomId: string) {
  const client = requireSupabase()
  const { data: room, error: roomError } = await client.from('rooms').select('status').eq('id', roomId).single()
  if (roomError) throw roomError
  if (room.status !== 'playing') return null
  const { data: game, error: gameError } = await client.from('games').select('id').eq('room_id', roomId).single()
  if (gameError) throw gameError
  return game.id as string
}

export async function loadGamePlayers(gameId: string): Promise<GamePlayerInfo[]> {
  const client = requireSupabase()
  const [{ data: game, error: gameError }, { data: players, error: playersError }] = await Promise.all([
    client.from('games').select('current_turn').eq('id', gameId).single(),
    client.from('game_players').select('user_id,seat,card_count,profiles(nickname)').eq('game_id', gameId).order('seat'),
  ])
  if (gameError) throw gameError
  if (playersError) throw playersError
  return (players ?? []).map(player => {
    const profile = Array.isArray(player.profiles) ? player.profiles[0] : player.profiles
    return { userId: player.user_id, nickname: profile?.nickname ?? '플레이어', seat: player.seat, cardCount: player.card_count, isCurrentTurn: player.user_id === game.current_turn }
  })
}

export async function loadGameView(gameId: string): Promise<GameView> {
  const client = requireSupabase()
  const [{ data: game, error: gameError }, { data: players, error: playersError }] = await Promise.all([
    client.from('games').select('state,current_turn,version').eq('id', gameId).single(),
    client.from('game_players').select('user_id,seat,card_count,profiles(nickname)').eq('game_id', gameId).order('seat'),
  ])
  if (gameError) throw gameError
  if (playersError) throw playersError
  const state = game.state as GameSnapshot
  return {
    state: { ...state, currentTurn: game.current_turn, version: game.version },
    players: (players ?? []).map(player => {
      const profile = Array.isArray(player.profiles) ? player.profiles[0] : player.profiles
      return { userId: player.user_id, nickname: profile?.nickname ?? '플레이어', seat: player.seat, cardCount: player.card_count, isCurrentTurn: player.user_id === game.current_turn }
    }),
  }
}

export async function revealGameCard(gameId: string): Promise<GameSnapshot> {
  const { data, error } = await requireSupabase().rpc('reveal_game_card', { p_game_id: gameId })
  if (error) throw error
  return data as GameSnapshot
}

export async function ringGameBell(gameId: string) {
  const { data, error } = await requireSupabase().rpc('attempt_ring', { p_game_id: gameId })
  if (error) throw error
  return data as { accepted: boolean; correct?: boolean; reason?: string; state: GameSnapshot }
}

export function subscribeToGame(gameId: string, onChange: () => void) {
  const client = supabase
  if (!client) return () => undefined
  const channel = client.channel(`game:${gameId}`)
    .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'games', filter: `id=eq.${gameId}` }, onChange)
    .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'game_players', filter: `game_id=eq.${gameId}` }, onChange)
    .subscribe()
  return () => { void client.removeChannel(channel) }
}

export function subscribeToRoom(roomId: string, onChange: () => void) {
  const client = supabase
  if (!client) return () => undefined
  const channel = client.channel(`room:${roomId}`)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'room_members', filter: `room_id=eq.${roomId}` }, onChange)
    .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'rooms', filter: `id=eq.${roomId}` }, onChange)
    .subscribe()
  return () => { void client.removeChannel(channel) }
}
