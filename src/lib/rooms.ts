import { supabase } from './supabase'
import { createUuid } from './id'
import { cardAssetUrl } from './cards'

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
  connected: boolean
  disconnectedAt: string | null
  ready: boolean
}

export interface GamePlayerInfo {
  userId: string
  nickname: string
  seat: number
  cardCount: number
  isCurrentTurn: boolean
  eliminated: boolean
  abandoned: boolean
  rematchRequested: boolean
  connected: boolean
  disconnectedAt: string | null
}

export type ActiveSession =
  | { type: 'game'; gameId: string; roomId: string }
  | { type: 'room'; roomId: string }

export type GameFruit = 'strawberry' | 'banana' | 'lime' | 'plum'

export interface GameTableCard {
  cardId?: string
  userId: string
  fruit: GameFruit
  count: number
}

export interface GameCardDesign {
  fruit: GameFruit
  count: number
  label: string
  assetUrl: string | null
  style: Record<string, string>
}

export interface GameCardTheme {
  id: string
  name: string
  version: number
  backAssetUrl: string | null
  backStyle: Record<string, string>
  designs: GameCardDesign[]
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
  playerResults?: GamePlayerResult[]
  rematchRequestedCount?: number
  rematchPlayerCount?: number
  rematchGameId?: string
}

export interface GamePlayerResult {
  userId: string
  cardCount: number
  totalOwned: number
  eliminated: boolean
  abandoned: boolean
  rank: number | null
  revealedCards: number
  correctRings: number
  wrongRings: number
  cardsWon: number
  cardsPaid: number
  rematchRequested: boolean
}

export interface GameView {
  roomId: string
  state: GameSnapshot
  players: GamePlayerInfo[]
  theme: GameCardTheme | null
}

function requireSupabase() {
  if (!supabase) throw new Error('Supabase가 설정되지 않았습니다.')
  return supabase
}

type GamePlayerRow = {
  user_id: string
  seat: number
  card_count: number
  eliminated_at?: string | null
  abandoned_at?: string | null
  rematch_requested_at?: string | null
  disconnected_at?: string | null
  last_seen_at?: string | null
  profiles: { nickname: string } | { nickname: string }[] | null
}

async function fetchGamePlayerRows(client: ReturnType<typeof requireSupabase>, gameId: string): Promise<GamePlayerRow[]> {
  const result = await client.from('game_players')
    .select('user_id,seat,card_count,eliminated_at,abandoned_at,rematch_requested_at,disconnected_at,last_seen_at,profiles(nickname)')
    .eq('game_id', gameId).order('seat')
  if (result.error && ['42703', 'PGRST204'].includes(result.error.code)) {
    const fallback = await client.from('game_players')
      .select('user_id,seat,card_count,profiles(nickname)')
      .eq('game_id', gameId).order('seat')
    if (fallback.error) throw fallback.error
    return (fallback.data ?? []) as unknown as GamePlayerRow[]
  }
  if (result.error) throw result.error
  return (result.data ?? []) as unknown as GamePlayerRow[]
}

export async function createPrivateRoom(maxPlayers: number): Promise<RoomInfo> {
  const client = requireSupabase()
  const { data, error } = await client.rpc('create_private_room', { p_max_players: maxPlayers })
  if (error) throw error
  const room = Array.isArray(data) ? data[0] : data
  if (!room) throw new Error('방을 생성하지 못했습니다.')
  return { id: room.id, code: room.code, maxPlayers: room.max_players, status: room.status, hostId: room.host_id }
}

export async function createSpaceRoom(spaceId: string, maxPlayers: number, cardSetId: string | null = null): Promise<RoomInfo> {
  const { data, error } = await requireSupabase().rpc('create_space_room', { p_space_id: spaceId, p_max_players: maxPlayers, p_card_set_id: cardSetId })
  if (error) throw error
  const room = Array.isArray(data) ? data[0] : data
  if (!room) throw new Error('스페이스 방을 생성하지 못했습니다.')
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

export async function loadRoom(roomId: string): Promise<RoomInfo> {
  const { data: room, error } = await requireSupabase().from('rooms')
    .select('id,code,max_players,status,host_id').eq('id', roomId).single()
  if (error) throw error
  return { id: room.id, code: room.code, maxPlayers: room.max_players, status: room.status, hostId: room.host_id }
}

export async function loadRoomMembers(roomId: string): Promise<RoomMemberInfo[]> {
  const client = requireSupabase()
  const extended = await client.from('room_members').select('user_id,role,seat,disconnected_at,left_at,is_ready,profiles(nickname)').eq('room_id', roomId).is('kicked_at', null).is('left_at', null).order('seat')
  const result = extended.error && ['42703', 'PGRST204'].includes(extended.error.code)
    ? await client.from('room_members').select('user_id,role,seat,profiles(nickname)').eq('room_id', roomId).is('kicked_at', null).order('seat')
    : extended
  if (result.error) throw result.error
  return (result.data ?? []).map(member => {
    const profile = Array.isArray(member.profiles) ? member.profiles[0] : member.profiles
    const connection = member as typeof member & { disconnected_at?: string | null }
    return { userId: member.user_id, nickname: profile?.nickname ?? '플레이어', role: member.role, seat: member.seat ?? 0, connected: !connection.disconnected_at, disconnectedAt: connection.disconnected_at ?? null, ready: member.role === 'host' || Boolean((member as typeof member & { is_ready?: boolean }).is_ready) }
  })
}

export async function kickRoomMember(roomId: string, userId: string, reason: string) {
  const { error } = await requireSupabase().rpc('kick_room_member', { p_room_id: roomId, p_user_id: userId, p_reason: reason })
  if (error) throw error
}

export async function setRoomReady(roomId: string, ready: boolean) {
  const { error } = await requireSupabase().rpc('set_room_ready', { p_room_id: roomId, p_ready: ready })
  if (error) throw error
}

export async function updateRoomCapacity(roomId: string, maxPlayers: number) {
  const { data, error } = await requireSupabase().rpc('update_room_capacity', { p_room_id: roomId, p_max_players: maxPlayers })
  if (error) throw error
  const room = Array.isArray(data) ? data[0] : data
  return { id: room.id, code: room.code, maxPlayers: room.max_players, status: room.status, hostId: room.host_id } as RoomInfo
}

export async function transferRoomHost(roomId: string, userId: string) {
  const { error } = await requireSupabase().rpc('transfer_room_host', { p_room_id: roomId, p_user_id: userId })
  if (error) throw error
}

export async function closeWaitingRoom(roomId: string) {
  const { error } = await requireSupabase().rpc('close_waiting_room', { p_room_id: roomId })
  if (error) throw error
}

export async function getMyRoomRemoval(roomId: string): Promise<{ kicked?: boolean, reason?: string, left?: boolean }> {
  const { data, error } = await requireSupabase().rpc('get_my_room_removal', { p_room_id: roomId })
  if (error) throw error
  return (data ?? {}) as { kicked?: boolean, reason?: string, left?: boolean }
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
  const { data: game, error: gameError } = await client.from('games').select('id').eq('room_id', roomId).is('finished_at', null).maybeSingle()
  if (gameError) throw gameError
  return game?.id ? String(game.id) : null
}

export async function loadGamePlayers(gameId: string): Promise<GamePlayerInfo[]> {
  const client = requireSupabase()
  const [{ data: game, error: gameError }, players] = await Promise.all([
    client.from('games').select('current_turn').eq('id', gameId).single(),
    fetchGamePlayerRows(client, gameId),
  ])
  if (gameError) throw gameError
  return players.map(player => {
    const profile = Array.isArray(player.profiles) ? player.profiles[0] : player.profiles
    return {
      userId: player.user_id,
      nickname: profile?.nickname ?? '플레이어',
      seat: player.seat,
      cardCount: player.card_count,
      isCurrentTurn: player.user_id === game.current_turn,
      eliminated: Boolean(player.eliminated_at) || player.card_count === 0,
      abandoned: Boolean(player.abandoned_at),
      rematchRequested: Boolean(player.rematch_requested_at),
      connected: !player.disconnected_at,
      disconnectedAt: player.disconnected_at ?? null,
    }
  })
}

export async function loadGameView(gameId: string): Promise<GameView> {
  const client = requireSupabase()
  const [{ data: game, error: gameError }, players] = await Promise.all([
    client.from('games').select('room_id,state,current_turn,version,card_set_id,card_set_version,card_set_snapshot').eq('id', gameId).single(),
    fetchGamePlayerRows(client, gameId),
  ])
  if (gameError) throw gameError
  const state = game.state as GameSnapshot
  const themeSnapshot = game.card_set_snapshot as {
    card_set?: { name?: string; back_asset_path?: string | null; back_design?: Record<string, string> }
    designs?: Array<{ fruit_type?: string; fruit_count?: number; label?: string | null; front_asset_path?: string | null; design?: Record<string, string> }>
  } | null
  const theme = game.card_set_id && themeSnapshot ? {
    id: String(game.card_set_id),
    name: themeSnapshot.card_set?.name ?? '게임 카드',
    version: Number(game.card_set_version ?? 1),
    backAssetUrl: cardAssetUrl(themeSnapshot.card_set?.back_asset_path ?? null),
    backStyle: themeSnapshot.card_set?.back_design ?? {},
    designs: (themeSnapshot.designs ?? []).flatMap(design => {
      if (!['strawberry', 'banana', 'lime', 'plum'].includes(design.fruit_type ?? '') || !design.fruit_count) return []
      return [{
        fruit: design.fruit_type as GameFruit,
        count: Number(design.fruit_count),
        label: design.label ?? '',
        assetUrl: cardAssetUrl(design.front_asset_path ?? null),
        style: design.design ?? {},
      }]
    }),
  } satisfies GameCardTheme : null
  return {
    roomId: game.room_id,
    state: { ...state, currentTurn: game.current_turn, version: game.version },
    theme,
    players: players.map(player => {
      const profile = Array.isArray(player.profiles) ? player.profiles[0] : player.profiles
      const result = state.playerResults?.find(item => item.userId === player.user_id)
      return {
        userId: player.user_id,
        nickname: profile?.nickname ?? '플레이어',
        seat: player.seat,
        cardCount: player.card_count,
        isCurrentTurn: player.user_id === game.current_turn,
        eliminated: Boolean(player.eliminated_at) || result?.eliminated || player.card_count === 0,
        abandoned: Boolean(player.abandoned_at) || result?.abandoned || false,
        rematchRequested: Boolean(player.rematch_requested_at) || result?.rematchRequested || false,
        connected: !player.disconnected_at,
        disconnectedAt: player.disconnected_at ?? null,
      }
    }),
  }
}

export async function revealGameCard(gameId: string): Promise<GameSnapshot> {
  const client = requireSupabase()
  let { data, error } = await client.rpc('reveal_game_card', { p_game_id: gameId, p_action_id: createUuid() })
  if (error?.code === 'PGRST202') ({ data, error } = await client.rpc('reveal_game_card', { p_game_id: gameId }))
  if (error) throw error
  return data as GameSnapshot
}

export async function ringGameBell(gameId: string) {
  const client = requireSupabase()
  let { data, error } = await client.rpc('attempt_ring', { p_game_id: gameId, p_action_id: createUuid() })
  if (error?.code === 'PGRST202') ({ data, error } = await client.rpc('attempt_ring', { p_game_id: gameId }))
  if (error) throw error
  return data as { accepted: boolean; correct?: boolean; reason?: string; state: GameSnapshot }
}

export async function abandonGame(gameId: string): Promise<GameSnapshot> {
  const { data, error } = await requireSupabase().rpc('abandon_game', { p_game_id: gameId, p_action_id: createUuid() })
  if (error) throw error
  return data as GameSnapshot
}

export async function requestGameRematch(gameId: string) {
  const { data, error } = await requireSupabase().rpc('request_game_rematch', { p_game_id: gameId })
  if (error) throw error
  return data as { ready: boolean; gameId?: string; state: GameSnapshot }
}

export async function returnFinishedGameToRoom(gameId: string): Promise<RoomInfo> {
  const { data, error } = await requireSupabase().rpc('return_finished_game_to_room', { p_game_id: gameId })
  if (error) throw error
  const room = Array.isArray(data) ? data[0] : data
  if (!room) throw new Error('돌아갈 방을 찾지 못했습니다.')
  return { id: room.id, code: room.code, maxPlayers: room.max_players, status: room.status, hostId: room.host_id }
}

export async function findMyActiveSession(): Promise<ActiveSession | null> {
  // A missing client is the intentional local demo mode. Once a client is
  // configured, every lookup error must still propagate to the entry gate.
  if (!supabase) return null
  const { data, error } = await supabase.rpc('get_my_active_session')
  if (error) throw error
  if (!data || typeof data !== 'object') return null
  const session = data as Record<string, unknown>
  if (session.type === 'game' && typeof session.gameId === 'string' && typeof session.roomId === 'string') {
    return { type: 'game', gameId: session.gameId, roomId: session.roomId }
  }
  if (session.type === 'room' && typeof session.roomId === 'string') return { type: 'room', roomId: session.roomId }
  return null
}

export async function heartbeatRoomSession(roomId: string) {
  const { error } = await requireSupabase().rpc('heartbeat_room_session', { p_room_id: roomId })
  if (error) throw error
}

export async function heartbeatGameSession(gameId: string) {
  const { error } = await requireSupabase().rpc('heartbeat_game_session', { p_game_id: gameId })
  if (error) throw error
}

export async function markRoomSessionDisconnected(roomId: string) {
  const { error } = await requireSupabase().rpc('mark_room_session_disconnected', { p_room_id: roomId })
  if (error) throw error
}

export async function markGameSessionDisconnected(gameId: string) {
  const { error } = await requireSupabase().rpc('mark_game_session_disconnected', { p_game_id: gameId })
  if (error) throw error
}

export function subscribeToGame(gameId: string, onChange: () => void) {
  const client = supabase
  if (!client) return () => undefined
  let disposed = false
  let replicationReconciled = false
  const reconcile = () => { if (!disposed) onChange() }
  // A unique topic avoids an old async cleanup closing a replacement channel
  // during React StrictMode remounts or fast route transitions.
  const channel = client.channel(`game:${gameId}:${createUuid()}`, {
    config: { broadcast: { replication_ready: true } },
  })
    .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'games', filter: `id=eq.${gameId}` }, reconcile)
    .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'game_players', filter: `game_id=eq.${gameId}` }, reconcile)
    .on('system', {}, payload => {
      // Joining the websocket topic does not mean Postgres replication is ready.
      // Reconcile after the server confirms the WAL stream so updates made in
      // the short join/replication gap cannot leave the screen stale.
      if (payload.status === 'ok' && !replicationReconciled) {
        replicationReconciled = true
        reconcile()
      } else if (payload.status === 'error') {
        replicationReconciled = false
        reconcile()
      }
    })
    .subscribe(status => {
      if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
        replicationReconciled = false
        reconcile()
      }
    })
  return () => { disposed = true; void client.removeChannel(channel) }
}

export function subscribeToRoom(roomId: string, onChange: () => void) {
  const client = supabase
  if (!client) return () => undefined
  let disposed = false
  let replicationReconciled = false
  const reconcile = () => { if (!disposed) onChange() }
  const channel = client.channel(`room:${roomId}:${createUuid()}`, {
    config: { broadcast: { replication_ready: true } },
  })
    .on('postgres_changes', { event: '*', schema: 'public', table: 'room_members', filter: `room_id=eq.${roomId}` }, reconcile)
    .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'rooms', filter: `id=eq.${roomId}` }, reconcile)
    .on('system', {}, payload => {
      if (payload.status === 'ok' && !replicationReconciled) {
        replicationReconciled = true
        reconcile()
      } else if (payload.status === 'error') {
        replicationReconciled = false
        reconcile()
      }
    })
    .subscribe(status => {
      if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
        replicationReconciled = false
        reconcile()
      }
    })
  return () => { disposed = true; void client.removeChannel(channel) }
}
