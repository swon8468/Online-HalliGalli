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
const accounts = Array.from({ length: 3 }, (_, index) => ({ email: `friend${index + 1}@swonport.kr`, nickname: `친구테스트${index + 1}` }))

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
const expectRpcError = async (promise, message) => {
  try {
    await promise
  } catch (error) {
    if (String(error.message).includes(message)) return
    throw error
  }
  throw new Error(`예상한 RPC 오류가 발생하지 않음: ${message}`)
}
const withTimeout = (promise, label) => Promise.race([
  promise,
  new Promise((_, reject) => setTimeout(() => reject(new Error(`${label} 시간 초과`)), 15_000)),
])
const cleanup = async () => {
  const requests = await admin.from('friend_requests').delete().in('sender_id', userIds).in('receiver_id', userIds)
  if (requests.error) throw requests.error
  const blocks = await admin.from('friend_blocks').delete().in('blocker_id', userIds).in('blocked_id', userIds)
  if (blocks.error) throw blocks.error
  const friendships = await admin.from('friendships').delete().in('user_low', userIds).in('user_high', userIds)
  if (friendships.error) throw friendships.error
  const restore = await admin.from('profiles').update({ suspended_until: null, suspension_reason: null }).in('id', userIds)
  if (restore.error) throw restore.error
}

await cleanup()

// Search by nickname/tag and self-request protection.
const ownSearch = await rpc(clients[0], 'search_friend_users', { p_query: accounts[0].nickname })
if (ownSearch[0]?.user_id !== userIds[0] || ownSearch[0]?.relationship !== 'self') throw new Error('자기 자신 검색 상태 실패')
const targetProfile = await admin.from('profiles').select('friend_tag').eq('id', userIds[1]).single()
if (targetProfile.error) throw targetProfile.error
const tagSearch = await rpc(clients[0], 'search_friend_users', { p_query: targetProfile.data.friend_tag })
if (tagSearch[0]?.user_id !== userIds[1]) throw new Error('친구 태그 검색 실패')
await expectRpcError(rpc(clients[0], 'send_friend_request', { p_receiver_id: userIds[0] }), 'cannot_friend_self')

// Direct table mutation must be blocked; only RPCs may change relationship state.
const directInsert = await clients[0].from('friend_requests').insert({ sender_id: userIds[0], receiver_id: userIds[1] })
if (!directInsert.error) throw new Error('friend_requests 직접 insert가 허용됨')

let resolveRealtime
const realtimeEvent = new Promise(resolve => { resolveRealtime = resolve })
let resolveSubscribed
const realtimeSubscribed = new Promise(resolve => { resolveSubscribed = resolve })
const realtimeChannel = clients[1].channel(`friend-test:${crypto.randomUUID()}`)
  .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'friend_requests', filter: `receiver_id=eq.${userIds[1]}` }, payload => {
    if (payload.new.receiver_id === userIds[1]) resolveRealtime(payload)
  })
  .subscribe(status => { if (status === 'SUBSCRIBED') resolveSubscribed(status) })
await withTimeout(realtimeSubscribed, 'Realtime 구독')
const sent = await rpc(clients[0], 'send_friend_request', { p_receiver_id: userIds[1] })
if (sent.status !== 'pending') throw new Error('친구 요청 전송 실패')
await withTimeout(realtimeEvent, '친구 요청 Realtime 반영')
await clients[1].removeChannel(realtimeChannel)
await expectRpcError(rpc(clients[0], 'send_friend_request', { p_receiver_id: userIds[1] }), 'already_requested')
const [senderOverview, receiverOverview] = await Promise.all([
  rpc(clients[0], 'get_friends_overview'), rpc(clients[1], 'get_friends_overview'),
])
if (senderOverview.sent.length !== 1 || receiverOverview.received.length !== 1) throw new Error('보낸/받은 요청 조회 실패')

// A reverse request atomically accepts the existing request.
const crossed = await rpc(clients[1], 'send_friend_request', { p_receiver_id: userIds[0] })
if (crossed.status !== 'accepted' || crossed.crossRequest !== true) throw new Error('교차 요청 자동 수락 실패')
const acceptedOverview = await rpc(clients[0], 'get_friends_overview')
if (acceptedOverview.friends.length !== 1 || acceptedOverview.sent.length !== 0) throw new Error('교차 요청 친구 관계 생성 실패')
await expectRpcError(rpc(clients[0], 'send_friend_request', { p_receiver_id: userIds[1] }), 'already_friends')
await rpc(clients[0], 'remove_friend', { p_friend_id: userIds[1] })

// Explicit decline and sender cancellation.
const declineRequest = await rpc(clients[0], 'send_friend_request', { p_receiver_id: userIds[1] })
await rpc(clients[1], 'respond_friend_request', { p_request_id: declineRequest.requestId, p_accept: false })
if ((await rpc(clients[0], 'get_friends_overview')).sent.length !== 0) throw new Error('요청 거절 반영 실패')
const cancelRequest = await rpc(clients[0], 'send_friend_request', { p_receiver_id: userIds[1] })
await rpc(clients[0], 'cancel_friend_request', { p_request_id: cancelRequest.requestId })
if ((await rpc(clients[1], 'get_friends_overview')).received.length !== 0) throw new Error('보낸 요청 취소 반영 실패')

// Explicit acceptance.
const acceptRequest = await rpc(clients[0], 'send_friend_request', { p_receiver_id: userIds[2] })
await rpc(clients[2], 'respond_friend_request', { p_request_id: acceptRequest.requestId, p_accept: true })
if ((await rpc(clients[2], 'get_friends_overview')).friends[0]?.userId !== userIds[0]) throw new Error('요청 수락 실패')

// Blocking removes relationships, cancels requests, hides search, and prevents new requests.
await rpc(clients[0], 'block_friend_user', { p_user_id: userIds[2] })
const blockedOverview = await rpc(clients[0], 'get_friends_overview')
if (blockedOverview.friends.length !== 0 || blockedOverview.blocked[0]?.userId !== userIds[2]) throw new Error('차단 상태 반영 실패')
await expectRpcError(rpc(clients[2], 'send_friend_request', { p_receiver_id: userIds[0] }), 'friend_unavailable')
const blockedSearch = await rpc(clients[0], 'search_friend_users', { p_query: accounts[2].nickname })
if (blockedSearch.length !== 0) throw new Error('차단 사용자 검색 노출')
await rpc(clients[0], 'unblock_friend_user', { p_user_id: userIds[2] })

// Suspended users are excluded and cannot participate in friend actions.
const suspend = await admin.from('profiles').update({ suspended_until: new Date(Date.now() + 3_600_000).toISOString(), suspension_reason: '자동 테스트' }).eq('id', userIds[1])
if (suspend.error) throw suspend.error
if ((await rpc(clients[0], 'search_friend_users', { p_query: accounts[1].nickname })).length !== 0) throw new Error('정지 사용자 검색 노출')
await expectRpcError(rpc(clients[0], 'send_friend_request', { p_receiver_id: userIds[1] }), 'account_unavailable')

await cleanup()
console.log('verified friend search, send, receive, accept, decline, cancel, cross-request, remove, block, and unblock')
console.log('direct writes are denied and suspended users are excluded')
