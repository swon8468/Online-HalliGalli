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

if (!testUrl || !testAnonKey) throw new Error('테스트 Supabase URL과 anon key가 필요합니다.')
if (!serviceRoleKey) {
  const accessToken = env.SUPABASE_ACCESS_TOKEN
  if (!accessToken) throw new Error('개발 환경 SUPABASE_ACCESS_TOKEN이 필요합니다.')
  const projectRef = new URL(testUrl).hostname.split('.')[0]
  const response = await fetch(`https://api.supabase.com/v1/projects/${projectRef}/api-keys?reveal=true`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  })
  if (!response.ok) throw new Error(`개발 프로젝트 API 키 조회 실패 (${response.status})`)
  const keys = await response.json()
  const serviceRole = keys.find(key => key.name === 'service_role')
  serviceRoleKey = serviceRole?.api_key ?? serviceRole?.value
  if (!serviceRoleKey) throw new Error('service_role 키를 찾지 못했습니다.')
}

const makeClient = () => createClient(testUrl, testAnonKey, {
  auth: { persistSession: false, autoRefreshToken: false },
})
const admin = createClient(testUrl, serviceRoleKey, {
  auth: { persistSession: false, autoRefreshToken: false },
})

const accounts = [
  { email: 'recovery1@swonport.kr', nickname: '복구테스트1' },
  { email: 'recovery2@swonport.kr', nickname: '복구테스트2' },
]
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

const user1 = makeClient()
const user2 = makeClient()
const signed1 = await user1.auth.signInWithPassword({ email: accounts[0].email, password })
const signed2 = await user2.auth.signInWithPassword({ email: accounts[1].email, password })
if (signed1.error || signed2.error) throw signed1.error ?? signed2.error
const user1Id = signed1.data.user.id
const user2Id = signed2.data.user.id

const rpc = async (client, name, parameters) => {
  const result = await client.rpc(name, parameters)
  if (result.error) throw result.error
  return result.data
}
const activeSession = client => rpc(client, 'get_my_active_session')
const createRoom = async () => {
  const data = await rpc(user1, 'create_private_room', { p_max_players: 2 })
  return Array.isArray(data) ? data[0] : data
}

const room = await createRoom()
await rpc(user2, 'join_private_room', { p_code: room.code })

const waitingSession = await activeSession(user1)
if (waitingSession?.type !== 'room' || waitingSession.roomId !== room.id) {
  throw new Error('대기방 새로고침 복구 세션 조회 실패')
}

await rpc(user1, 'mark_room_session_disconnected', { p_room_id: room.id })
let member = await admin.from('room_members').select('disconnected_at').eq('room_id', room.id).eq('user_id', user1Id).single()
if (member.error || !member.data.disconnected_at) throw member.error ?? new Error('대기방 연결 종료 기록 실패')
await rpc(user1, 'heartbeat_room_session', { p_room_id: room.id })
member = await admin.from('room_members').select('disconnected_at').eq('room_id', room.id).eq('user_id', user1Id).single()
if (member.error || member.data.disconnected_at) throw member.error ?? new Error('대기방 재접속 복구 실패')

const staleHostTime = new Date(Date.now() - 90_000).toISOString()
const ageHost = await admin.from('room_members').update({
  last_seen_at: staleHostTime,
  disconnected_at: staleHostTime,
}).eq('room_id', room.id).eq('user_id', user1Id)
if (ageHost.error) throw ageHost.error
await rpc(user2, 'heartbeat_room_session', { p_room_id: room.id })
const handedOffRoom = await admin.from('rooms').select('host_id').eq('id', room.id).single()
const handedOffMembers = await admin.from('room_members').select('user_id,role').eq('room_id', room.id).is('left_at', null).is('kicked_at', null)
if (handedOffRoom.error || handedOffMembers.error) throw handedOffRoom.error ?? handedOffMembers.error
if (handedOffRoom.data.host_id !== user2Id || handedOffMembers.data.find(row => row.user_id === user2Id)?.role !== 'host') {
  throw new Error('연결 종료 방장 위임 실패')
}

const gameId = await rpc(user2, 'start_room_game', { p_room_id: room.id })
const gameSession1 = await activeSession(user1)
const gameSession2 = await activeSession(user2)
if (gameSession1?.type !== 'game' || gameSession2?.type !== 'game' || gameSession1.gameId !== gameId || gameSession2.gameId !== gameId) {
  throw new Error('게임 중 새로고침 복구 세션 조회 실패')
}

await rpc(user1, 'mark_game_session_disconnected', { p_game_id: gameId })
const stalePlayerTime = new Date(Date.now() - 150_000).toISOString()
const ageRoomPlayer = await admin.from('room_members').update({
  last_seen_at: stalePlayerTime,
  disconnected_at: stalePlayerTime,
}).eq('room_id', room.id).eq('user_id', user1Id)
const ageGamePlayer = await admin.from('game_players').update({
  last_seen_at: stalePlayerTime,
  disconnected_at: stalePlayerTime,
}).eq('game_id', gameId).eq('user_id', user1Id)
if (ageRoomPlayer.error || ageGamePlayer.error) throw ageRoomPlayer.error ?? ageGamePlayer.error
await rpc(user2, 'heartbeat_game_session', { p_game_id: gameId })

const finishedGame = await admin.from('games').select('state,finished_at').eq('id', gameId).single()
const disconnectedPlayer = await admin.from('game_players').select('abandoned_at').eq('game_id', gameId).eq('user_id', user1Id).single()
if (finishedGame.error || disconnectedPlayer.error) throw finishedGame.error ?? disconnectedPlayer.error
if (!disconnectedPlayer.data.abandoned_at || !finishedGame.data.finished_at || finishedGame.data.state?.winnerId !== user2Id) {
  throw new Error('재접속 제한 시간 초과 탈락 및 게임 종료 실패')
}
const sessionAfterFinish1 = await activeSession(user1)
const sessionAfterFinish2 = await activeSession(user2)
if ([sessionAfterFinish1, sessionAfterFinish2].some(session => session?.type === 'game' && session.gameId === gameId)) {
  throw new Error('종료된 게임이 활성 세션으로 복구됨')
}

const room2 = await createRoom()
await rpc(user2, 'join_private_room', { p_code: room2.code })
await rpc(user2, 'leave_room', { p_room_id: room2.id })
let leftMember = await admin.from('room_members').select('left_at').eq('room_id', room2.id).eq('user_id', user2Id).single()
if (leftMember.error || !leftMember.data.left_at) throw leftMember.error ?? new Error('자발적 방 나가기 상태 정리 실패')
await rpc(user2, 'join_private_room', { p_code: room2.code })
leftMember = await admin.from('room_members').select('left_at,disconnected_at').eq('room_id', room2.id).eq('user_id', user2Id).single()
if (leftMember.error || leftMember.data.left_at || leftMember.data.disconnected_at) throw leftMember.error ?? new Error('자발적 이탈 후 재입장 실패')
await rpc(user1, 'kick_room_member', { p_room_id: room2.id, p_user_id: user2Id })
const kickedRejoin = await user2.rpc('join_private_room', { p_code: room2.code })
if (!kickedRejoin.error?.message.includes('kicked_users_cannot_rejoin')) throw new Error('강퇴 사용자의 재입장 차단 실패')

console.log(`verified session recovery: rooms ${room.code}, ${room2.code}`)
console.log('waiting/game recovery, heartbeat, disconnect, host handoff, timeout forfeit, leave/rejoin, and kick lockout passed')
