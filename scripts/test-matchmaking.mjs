import { execFileSync } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import { createClient } from '@supabase/supabase-js'

const parseEnv = source => Object.fromEntries(source.split(/\r?\n/).flatMap(line => {
  const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/)
  return match ? [[match[1], match[2].replace(/^(['"])(.*)\1$/, '$2')]] : []
}))
const env = parseEnv(await readFile('.env.development', 'utf8'))
const password = process.env.TEST_USER_PASSWORD
if (!password || password.length < 8) throw new Error('TEST_USER_PASSWORD가 8자 이상이어야 합니다.')
const localEnv = process.env.TEST_LOCAL === '1'
  ? parseEnv(execFileSync('npx', ['supabase', 'status', '-o', 'env'], { encoding: 'utf8' }))
  : {}
const testUrl = process.env.TEST_SUPABASE_URL || localEnv.API_URL || env.VITE_SUPABASE_URL
const testAnonKey = process.env.TEST_SUPABASE_ANON_KEY || localEnv.ANON_KEY || env.VITE_SUPABASE_ANON_KEY
let serviceRoleKey = process.env.TEST_SUPABASE_SERVICE_ROLE_KEY || localEnv.SERVICE_ROLE_KEY || ''
if (!serviceRoleKey) {
  const projectRef = new URL(testUrl).hostname.split('.')[0]
  const response = await fetch(`https://api.supabase.com/v1/projects/${projectRef}/api-keys?reveal=true`, {
    headers: { Authorization: `Bearer ${env.SUPABASE_ACCESS_TOKEN}` },
  })
  if (!response.ok) throw new Error(`개발 프로젝트 API 키 조회 실패 (${response.status})`)
  const keys = await response.json()
  const serviceRole = keys.find(key => key.name === 'service_role')
  serviceRoleKey = serviceRole?.api_key ?? serviceRole?.value
}
if (!testUrl || !testAnonKey || !serviceRoleKey) throw new Error('테스트 Supabase 설정이 필요합니다.')

const admin = createClient(testUrl, serviceRoleKey, { auth: { persistSession: false, autoRefreshToken: false } })
const makeClient = () => createClient(testUrl, testAnonKey, { auth: { persistSession: false, autoRefreshToken: false } })
const accounts = Array.from({ length: 6 }, (_, index) => ({
  email: `match${index + 1}@swonport.kr`, nickname: `매칭${index + 1}`,
}))

if (process.env.TEST_CREATE_USERS === '1') {
  const listed = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 })
  if (listed.error) throw listed.error
  for (const account of accounts) {
    const existing = listed.data.users.find(user => user.email?.toLowerCase() === account.email)
    const result = existing
      ? await admin.auth.admin.updateUserById(existing.id, { password, email_confirm: true, user_metadata: { nickname: account.nickname } })
      : await admin.auth.admin.createUser({ email: account.email, password, email_confirm: true, user_metadata: { nickname: account.nickname } })
    if (result.error) throw result.error
  }
}

const clients = []
const userIds = []
for (const account of accounts) {
  const client = makeClient()
  const signed = await client.auth.signInWithPassword({ email: account.email, password })
  if (signed.error) throw signed.error
  clients.push(client)
  userIds.push(signed.data.user.id)
}

const rpc = async (client, name, parameters) => {
  const result = await client.rpc(name, parameters)
  if (result.error) throw result.error
  return result.data
}
const cleanup = async roomId => {
  const queue = await admin.from('matchmaking_queue').delete().in('user_id', userIds)
  if (queue.error) throw queue.error
  if (roomId) {
    const room = await admin.from('rooms').delete().eq('id', roomId)
    if (room.error) throw room.error
  }
}

await cleanup()

// Cancellation, refresh recovery, heartbeat, and stale cleanup.
let waiting = await rpc(clients[0], 'join_matchmaking', { p_player_count: 6 })
if (waiting.status !== 'waiting' || waiting.playerCount !== 6 || waiting.queueCount !== 1) throw new Error('대기열 참가 실패')
const recovered = await rpc(clients[0], 'get_matchmaking_status')
if (recovered.status !== 'waiting' || recovered.playerCount !== 6) throw new Error('새로고침 대기열 복구 실패')
const heartbeat = await rpc(clients[0], 'heartbeat_matchmaking')
if (heartbeat.status !== 'waiting') throw new Error('매칭 heartbeat 실패')
const cancelled = await rpc(clients[0], 'cancel_matchmaking')
if (cancelled.status !== 'idle') throw new Error('매칭 취소 실패')

await rpc(clients[0], 'join_matchmaking', { p_player_count: 6 })
const staleAt = new Date(Date.now() - 31_000).toISOString()
const ageQueue = await admin.from('matchmaking_queue').update({ heartbeat_at: staleAt }).eq('user_id', userIds[0])
if (ageQueue.error) throw ageQueue.error
await rpc(clients[1], 'join_matchmaking', { p_player_count: 6 })
const staleRow = await admin.from('matchmaking_queue').select('user_id').eq('user_id', userIds[0]).maybeSingle()
if (staleRow.error || staleRow.data) throw staleRow.error ?? new Error('만료된 대기열 정리 실패')
await cleanup()

for (const playerCount of [2, 3, 4, 5, 6]) {
  const joinResults = await Promise.all(clients.slice(0, playerCount).map(client =>
    rpc(client, 'join_matchmaking', { p_player_count: playerCount })))
  if (joinResults.some(result => !['waiting', 'matched'].includes(result.status))) throw new Error(`${playerCount}인 대기열 참가 실패`)

  const statuses = await Promise.all(clients.slice(0, playerCount).map(client => rpc(client, 'get_matchmaking_status')))
  const gameIds = new Set(statuses.map(status => status.gameId))
  const roomIds = new Set(statuses.map(status => status.roomId))
  if (statuses.some(status => status.status !== 'matched' || status.members.length !== playerCount) || gameIds.size !== 1 || roomIds.size !== 1) {
    throw new Error(`${playerCount}인 단일 매칭 생성 실패`)
  }
  const gameId = statuses[0].gameId
  const roomId = statuses[0].roomId
  const [room, members, players, cards] = await Promise.all([
    admin.from('rooms').select('kind,status,max_players').eq('id', roomId).single(),
    admin.from('room_members').select('user_id,seat,role').eq('room_id', roomId).order('seat'),
    admin.from('game_players').select('user_id,seat,card_count').eq('game_id', gameId).order('seat'),
    admin.from('game_cards').select('id', { count: 'exact', head: true }).eq('game_id', gameId),
  ])
  const firstError = [room, members, players, cards].find(result => result.error)?.error
  if (firstError) throw firstError
  const cardCounts = players.data.map(player => player.card_count)
  if (room.data.kind !== 'matchmaking' || room.data.status !== 'playing' || room.data.max_players !== playerCount ||
      members.data.length !== playerCount || players.data.length !== playerCount || cards.count !== 56 ||
      cardCounts.reduce((sum, count) => sum + count, 0) !== 56 || Math.max(...cardCounts) - Math.min(...cardCounts) > 1) {
    throw new Error(`${playerCount}인 매칭 게임 초기화 실패`)
  }

  // Duplicate joins after the match must return the same game, never create a second one.
  const duplicate = await rpc(clients[0], 'join_matchmaking', { p_player_count: playerCount })
  if (duplicate.gameId !== gameId) throw new Error(`${playerCount}인 중복 매칭 방지 실패`)
  const hostedGames = await admin.from('rooms').select('id', { count: 'exact', head: true })
    .eq('kind', 'matchmaking').eq('host_id', userIds.find(id => id === members.data[0].user_id))
  if (hostedGames.error || hostedGames.count !== 1) throw hostedGames.error ?? new Error(`${playerCount}인 중복 게임 생성됨`)

  await cleanup(roomId)
}

console.log('verified real matchmaking for 2, 3, 4, 5, and 6 players')
console.log('join, cancel, refresh recovery, heartbeat, stale cleanup, atomic single match, game creation, and duplicate prevention passed')
