import { createHash, randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { createClient } from '@supabase/supabase-js'

const parseEnv = source => Object.fromEntries(source.split(/\r?\n/).flatMap(line => {
  const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/)
  return match ? [[match[1], match[2].replace(/^(['"])(.*)\1$/, '$2')]] : []
}))
const env = parseEnv(await readFile('.env.development', 'utf8'))
const url = env.VITE_SUPABASE_URL
const anon = env.VITE_SUPABASE_ANON_KEY
const accessToken = process.env.SUPABASE_ACCESS_TOKEN || env.SUPABASE_ACCESS_TOKEN
if (!url || !anon || !accessToken) throw new Error('개발 Supabase 설정이 필요합니다.')

const keysResponse = await fetch(`https://api.supabase.com/v1/projects/${new URL(url).hostname.split('.')[0]}/api-keys?reveal=true`, {
  headers: { Authorization: `Bearer ${accessToken}` },
})
if (!keysResponse.ok) throw new Error(`개발 프로젝트 키 조회 실패 (${keysResponse.status})`)
const serviceEntry = (await keysResponse.json()).find(key => key.name === 'service_role')
const service = serviceEntry?.api_key ?? serviceEntry?.value
if (!service) throw new Error('개발 service role 키를 찾지 못했습니다.')

const admin = createClient(url, service, { auth: { persistSession: false, autoRefreshToken: false } })
const password = process.env.TEST_USER_PASSWORD || `Push-${createHash('sha256').update(accessToken).digest('hex').slice(0, 18)}!`
const accounts = [0, 1].map(index => ({ email: `push-e2e-${index + 1}@swonport.kr`, nickname: `푸시검증${index + 1}` }))
const createdIds = []
let roomId = null

try {
  const listed = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 })
  if (listed.error) throw listed.error
  for (const account of accounts) {
    const existing = listed.data.users.find(user => user.email === account.email)
    if (existing) await admin.auth.admin.deleteUser(existing.id)
    const created = await admin.auth.admin.createUser({ email: account.email, password, email_confirm: true, user_metadata: { nickname: account.nickname } })
    if (created.error || !created.data.user) throw created.error ?? new Error('푸시 테스트 계정 생성 실패')
    createdIds.push(created.data.user.id)
  }

  const clients = []
  for (const account of accounts) {
    const client = createClient(url, anon, { auth: { persistSession: false, autoRefreshToken: false } })
    const signed = await client.auth.signInWithPassword({ email: account.email, password })
    if (signed.error) throw signed.error
    clients.push(client)
  }

  const endpoint = `https://push.test.invalid/subscription/${randomUUID()}`
  const payload = { p_endpoint: endpoint, p_p256dh: 'p'.repeat(64), p_auth: 'a'.repeat(24), p_user_agent: 'release-candidate-integration' }
  const first = await clients[0].rpc('register_push_subscription', payload)
  if (first.error) throw first.error
  const second = await clients[1].rpc('register_push_subscription', payload)
  if (second.error) throw second.error
  const claimed = await admin.from('push_subscriptions').select('user_id').eq('endpoint', endpoint).single()
  if (claimed.error || claimed.data.user_id !== createdIds[1]) throw claimed.error ?? new Error('공유 기기 endpoint 재할당 실패')

  const anonymous = createClient(url, anon, { auth: { persistSession: false, autoRefreshToken: false } })
  const rejected = await anonymous.rpc('register_push_subscription', payload)
  if (!rejected.error) throw new Error('비인증 푸시 등록이 차단되지 않았습니다.')
  const oldOwnerDelete = await clients[0].from('push_subscriptions').delete().eq('endpoint', endpoint)
  if (oldOwnerDelete.error) throw oldOwnerDelete.error
  const preserved = await admin.from('push_subscriptions').select('id').eq('endpoint', endpoint).maybeSingle()
  if (preserved.error || !preserved.data) throw preserved.error ?? new Error('이전 사용자가 현재 구독을 삭제했습니다.')
  const currentOwnerDelete = await clients[1].from('push_subscriptions').delete().eq('endpoint', endpoint)
  if (currentOwnerDelete.error) throw currentOwnerDelete.error
  const removed = await admin.from('push_subscriptions').select('id').eq('endpoint', endpoint).maybeSingle()
  if (removed.error || removed.data) throw removed.error ?? new Error('현재 사용자의 구독 해제가 반영되지 않았습니다.')

  const roomResult = await clients[0].rpc('create_private_room', { p_max_players: 2 })
  if (roomResult.error) throw roomResult.error
  const room = Array.isArray(roomResult.data) ? roomResult.data[0] : roomResult.data
  roomId = room.id
  const inviteResult = await admin.from('game_invites').insert({
    sender_id: createdIds[0], receiver_id: createdIds[1], room_id: roomId,
    expires_at: new Date(Date.now() + 10 * 60_000).toISOString(),
  }).select('id').single()
  if (inviteResult.error) throw inviteResult.error
  const directClaim = await clients[0].rpc('claim_game_invite_push', {
    p_invite_id: inviteResult.data.id,
    p_sender_id: createdIds[0],
    p_sent_at: new Date().toISOString(),
  })
  if (!directClaim.error) throw new Error('클라이언트가 내부 푸시 선점 RPC를 직접 호출했습니다.')

  const suspendedSender = await admin.from('profiles').update({
    suspended_until: new Date(Date.now() + 60_000).toISOString(),
    suspension_reason: '푸시 보안 자동 테스트',
  }).eq('id', createdIds[0])
  if (suspendedSender.error) throw suspendedSender.error
  try {
    const suspendedDelivery = await clients[0].functions.invoke('send-push', { body: { inviteId: inviteResult.data.id } })
    if (!suspendedDelivery.error) throw new Error('정지 전에 발급된 세션의 푸시 전송이 허용되었습니다.')
    const unclaimedWhileSuspended = await admin.from('game_invites').select('push_sent_at').eq('id', inviteResult.data.id).single()
    if (unclaimedWhileSuspended.error || unclaimedWhileSuspended.data.push_sent_at) {
      throw unclaimedWhileSuspended.error ?? new Error('정지 계정 요청이 푸시 전송을 선점했습니다.')
    }
  } finally {
    const restoredSender = await admin.from('profiles').update({ suspended_until: null, suspension_reason: null }).eq('id', createdIds[0])
    if (restoredSender.error) throw restoredSender.error
  }

  const forgedDelivery = await clients[1].functions.invoke('send-push', { body: { inviteId: inviteResult.data.id } })
  if (!forgedDelivery.error) throw new Error('초대 발신자가 아닌 사용자의 푸시 전송이 허용되었습니다.')
  const unclaimedInvite = await admin.from('game_invites').select('push_sent_at').eq('id', inviteResult.data.id).single()
  if (unclaimedInvite.error || unclaimedInvite.data.push_sent_at) throw unclaimedInvite.error ?? new Error('권한 없는 요청이 푸시 전송을 선점했습니다.')

  const deliveries = await Promise.all([
    clients[0].functions.invoke('send-push', { body: { inviteId: inviteResult.data.id } }),
    clients[0].functions.invoke('send-push', { body: { inviteId: inviteResult.data.id } }),
  ])
  if (deliveries.some(result => result.error)) throw deliveries.find(result => result.error).error
  if (deliveries.filter(result => result.data?.duplicate === true).length !== 1
    || deliveries.filter(result => result.data?.duplicate === false).length !== 1) {
    throw new Error('동일 초대 푸시의 원자적 1회 전송 보장 실패')
  }
  const claimedInvite = await admin.from('game_invites').select('push_sent_at').eq('id', inviteResult.data.id).single()
  if (claimedInvite.error || !claimedInvite.data.push_sent_at) throw claimedInvite.error ?? new Error('푸시 전송 claim 기록 실패')

  const cancelled = await admin.from('game_invites').update({ status: 'cancelled' }).eq('id', inviteResult.data.id)
  if (cancelled.error) throw cancelled.error
  const retryInvite = await admin.from('game_invites').insert({
    sender_id: createdIds[0], receiver_id: createdIds[1], room_id: roomId,
    expires_at: new Date(Date.now() + 10 * 60_000).toISOString(),
  }).select('id').single()
  if (retryInvite.error) throw retryInvite.error
  const transientEndpoint = `https://push.test.invalid/transient/${randomUUID()}`
  const transientSubscription = await admin.from('push_subscriptions').insert({
    user_id: createdIds[1], endpoint: transientEndpoint, p256dh: 'p'.repeat(64), auth: 'a'.repeat(24), user_agent: 'transient-release-test',
  })
  if (transientSubscription.error) throw transientSubscription.error
  const transientDelivery = await clients[0].functions.invoke('send-push', { body: { inviteId: retryInvite.data.id } })
  if (!transientDelivery.error) throw new Error('일시 푸시 실패가 성공으로 보고되었습니다.')
  const releasedInvite = await admin.from('game_invites').select('push_sent_at').eq('id', retryInvite.data.id).single()
  if (releasedInvite.error || releasedInvite.data.push_sent_at) throw releasedInvite.error ?? new Error('일시 실패 후 푸시 선점이 해제되지 않았습니다.')
  const removedTransient = await admin.from('push_subscriptions').delete().eq('endpoint', transientEndpoint)
  if (removedTransient.error) throw removedTransient.error
  const retriedDelivery = await clients[0].functions.invoke('send-push', { body: { inviteId: retryInvite.data.id } })
  if (retriedDelivery.error || retriedDelivery.data?.duplicate !== false) throw retriedDelivery.error ?? new Error('선점 해제 후 푸시 재호출 실패')
  const reclaimedInvite = await admin.from('game_invites').select('push_sent_at').eq('id', retryInvite.data.id).single()
  if (reclaimedInvite.error || !reclaimedInvite.data.push_sent_at) throw reclaimedInvite.error ?? new Error('재호출 후 푸시 선점 기록 실패')

  console.log('verified authenticated push registration, shared-device endpoint reassignment, inactive-session denial, RLS ownership, idempotent delivery, and transient retry release')
} finally {
  if (roomId) await admin.from('rooms').delete().eq('id', roomId)
  for (const id of createdIds) await admin.auth.admin.deleteUser(id)
}
