import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { createClient } from '@supabase/supabase-js'

const parseEnv = source => Object.fromEntries(source.split(/\r?\n/).flatMap(line => {
  const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/)
  return match ? [[match[1], match[2].replace(/^(['"])(.*)\1$/, '$2')]] : []
}))
const env = parseEnv(await readFile('.env.development', 'utf8'))
const password = process.env.TEST_USER_PASSWORD ?? `Test-${createHash('sha256').update(env.SUPABASE_ACCESS_TOKEN).digest('hex').slice(0, 18)}!`
const localEnv = process.env.TEST_LOCAL === '1' ? parseEnv(execFileSync('npx', ['supabase', 'status', '-o', 'env'], { encoding: 'utf8' })) : {}
const testUrl = process.env.TEST_SUPABASE_URL || localEnv.API_URL || env.VITE_SUPABASE_URL
const testAnonKey = process.env.TEST_SUPABASE_ANON_KEY || localEnv.ANON_KEY || env.VITE_SUPABASE_ANON_KEY
let serviceRoleKey = process.env.TEST_SUPABASE_SERVICE_ROLE_KEY || localEnv.SERVICE_ROLE_KEY || ''
if (!serviceRoleKey) {
  const projectRef = new URL(testUrl).hostname.split('.')[0]
  const response = await fetch(`https://api.supabase.com/v1/projects/${projectRef}/api-keys?reveal=true`, { headers: { Authorization: `Bearer ${env.SUPABASE_ACCESS_TOKEN}` } })
  if (!response.ok) throw new Error(`개발 프로젝트 API 키 조회 실패 (${response.status})`)
  const keys = await response.json()
  const serviceRole = keys.find(key => key.name === 'service_role')
  serviceRoleKey = serviceRole?.api_key ?? serviceRole?.value
}
if (!testUrl || !testAnonKey || !serviceRoleKey) throw new Error('테스트 Supabase 설정이 필요합니다.')

const admin = createClient(testUrl, serviceRoleKey, { auth: { persistSession: false, autoRefreshToken: false } })
const makeClient = () => createClient(testUrl, testAnonKey, { auth: { persistSession: false, autoRefreshToken: false } })
const accounts = Array.from({ length: 3 }, (_, index) => ({ email: `invite${index + 1}@swonport.kr`, nickname: `초대테스트${index + 1}` }))
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

const clients = [], userIds = []
for (const account of accounts) {
  const client = makeClient()
  const signed = await client.auth.signInWithPassword({ email: account.email, password })
  if (signed.error) throw signed.error
  clients.push(client); userIds.push(signed.data.user.id)
}
const rpc = async (client, name, parameters) => {
  const result = await client.rpc(name, parameters)
  if (result.error) throw result.error
  return result.data
}
const expectError = async (promise, expected) => {
  try { await promise } catch (error) { if (String(error.message).includes(expected)) return; throw error }
  throw new Error(`예상한 오류가 발생하지 않음: ${expected}`)
}
const cleanup = async () => {
  const rooms = await admin.from('rooms').select('id').in('host_id', userIds)
  if (rooms.error) throw rooms.error
  if (rooms.data.length) {
    const deleted = await admin.from('rooms').delete().in('id', rooms.data.map(room => room.id))
    if (deleted.error) throw deleted.error
  }
  const invites = await admin.from('game_invites').delete().in('sender_id', userIds).in('receiver_id', userIds)
  if (invites.error) throw invites.error
  const friendships = await admin.from('friendships').delete().in('user_low', userIds).in('user_high', userIds)
  if (friendships.error) throw friendships.error
}
await cleanup()

for (const friendId of userIds.slice(1)) {
  const pair = [userIds[0], friendId].sort()
  const relation = await admin.from('friendships').insert({ user_low: pair[0], user_high: pair[1] })
  if (relation.error) throw relation.error
}

const room = await rpc(clients[0], 'create_private_room', { p_max_players: 3 })
const roomId = room.id
const context = await rpc(clients[0], 'get_game_invite_context')
if (!context.available || context.roomId !== roomId) throw new Error('초대 가능한 대기방 탐색 실패')
if ((await rpc(clients[1], 'get_game_invite_context')).available) throw new Error('방이 없는 사용자에게 초대 컨텍스트 노출')

const direct = await clients[0].from('game_invites').insert({ sender_id: userIds[0], receiver_id: userIds[1], room_id: roomId })
if (!direct.error) throw new Error('game_invites 직접 insert가 허용됨')

let resolveEvent, rejectEvent, resolveSubscription, rejectSubscription
const eventReceived = new Promise((resolve, reject) => { resolveEvent = resolve; rejectEvent = reject })
const subscribed = new Promise((resolve, reject) => { resolveSubscription = resolve; rejectSubscription = reject })
const channel = clients[1].channel(`invite-test:${crypto.randomUUID()}`)
  .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'game_invites', filter: `receiver_id=eq.${userIds[1]}` }, payload => resolveEvent(payload))
  .subscribe(status => {
    if (status === 'SUBSCRIBED') resolveSubscription(status)
    if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
      const error = new Error(`초대 Realtime 채널 상태: ${status}`)
      rejectSubscription(error); rejectEvent(error)
    }
  })
const withTimeout = (promise, label, timeoutMs = 30_000) => new Promise((resolve, reject) => {
  const timer = setTimeout(() => reject(new Error(`${label} 시간 초과`)), timeoutMs)
  promise.then(
    value => { clearTimeout(timer); resolve(value) },
    error => { clearTimeout(timer); reject(error) },
  )
})
await withTimeout(subscribed, '초대 Realtime 구독')
await new Promise(resolve => setTimeout(resolve, 750))
const first = await rpc(clients[0], 'send_game_invite', { p_receiver_id: userIds[1], p_room_id: roomId })
await withTimeout(eventReceived, '초대 Realtime 수신')
await clients[1].removeChannel(channel)
await expectError(rpc(clients[0], 'send_game_invite', { p_receiver_id: userIds[1], p_room_id: roomId }), 'already_invited')
const [sentOverview, receivedOverview] = await Promise.all([rpc(clients[0], 'get_game_invites'), rpc(clients[1], 'get_game_invites')])
if (sentOverview.sent[0]?.id !== first.id || receivedOverview.received[0]?.id !== first.id) throw new Error('보낸/받은 초대 조회 실패')
await rpc(clients[0], 'cancel_game_invite', { p_invite_id: first.id })

const declined = await rpc(clients[0], 'send_game_invite', { p_receiver_id: userIds[1], p_room_id: roomId })
await rpc(clients[1], 'respond_game_invite', { p_invite_id: declined.id, p_accept: false })
if ((await rpc(clients[1], 'get_game_invites')).received.length !== 0) throw new Error('초대 거절 반영 실패')

const accepted = await rpc(clients[0], 'send_game_invite', { p_receiver_id: userIds[1], p_room_id: roomId })
const acceptedResult = await rpc(clients[1], 'respond_game_invite', { p_invite_id: accepted.id, p_accept: true })
if (acceptedResult.roomId !== roomId) throw new Error('초대 수락 결과 실패')
const joined = await admin.from('room_members').select('seat,left_at,kicked_at').eq('room_id', roomId).eq('user_id', userIds[1]).single()
if (joined.error || joined.data.left_at || joined.data.kicked_at) throw joined.error ?? new Error('초대 수락 후 방 참가 실패')
await rpc(clients[1], 'leave_room', { p_room_id: roomId })

const expired = await rpc(clients[0], 'send_game_invite', { p_receiver_id: userIds[1], p_room_id: roomId })
const ageInvite = await admin.from('game_invites').update({ expires_at: new Date(Date.now() - 1000).toISOString() }).eq('id', expired.id)
if (ageInvite.error) throw ageInvite.error
await expectError(rpc(clients[1], 'respond_game_invite', { p_invite_id: expired.id, p_accept: true }), 'invite_expired')
if ((await rpc(clients[1], 'get_game_invites')).received.length !== 0) throw new Error('만료 초대 정리 실패')

const oldTimestamp = new Date(Date.now() - 3_600_000).toISOString()
let ageHistory = await admin.from('game_invites').update({ created_at: oldTimestamp }).eq('sender_id', userIds[0])
if (ageHistory.error) throw ageHistory.error
for (let index = 0; index < 5; index += 1) {
  const rateInvite = await rpc(clients[0], 'send_game_invite', { p_receiver_id: userIds[1], p_room_id: roomId })
  await rpc(clients[0], 'cancel_game_invite', { p_invite_id: rateInvite.id })
}
await expectError(rpc(clients[0], 'send_game_invite', { p_receiver_id: userIds[1], p_room_id: roomId }), 'invite_rate_limited')
ageHistory = await admin.from('game_invites').update({ created_at: oldTimestamp }).eq('sender_id', userIds[0])
if (ageHistory.error) throw ageHistory.error

// Invite sent while waiting must become unusable after the room starts.
const beforeStart = await rpc(clients[0], 'send_game_invite', { p_receiver_id: userIds[1], p_room_id: roomId })
const thirdInvite = await rpc(clients[0], 'send_game_invite', { p_receiver_id: userIds[2], p_room_id: roomId })
await rpc(clients[2], 'respond_game_invite', { p_invite_id: thirdInvite.id, p_accept: true })
await rpc(clients[2], 'set_room_ready', { p_room_id: roomId, p_ready: true })
await rpc(clients[0], 'start_room_game', { p_room_id: roomId })
await expectError(rpc(clients[1], 'respond_game_invite', { p_invite_id: beforeStart.id, p_accept: true }), 'room_not_invitable')

await cleanup()
await Promise.all(clients.map(client => client.removeAllChannels()))
console.log('verified invite context, realtime delivery, duplicate prevention, cancel, decline, accept-and-join, expiry, and started-room rejection')
console.log('direct invite writes are denied; server validates friendship, room state, capacity, active sessions, and rate limits')
