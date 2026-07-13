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
if (!url || !anon || !env.SUPABASE_ACCESS_TOKEN) throw new Error('개발 Supabase 설정이 필요합니다.')

const projectRef = new URL(url).hostname.split('.')[0]
const keyResponse = await fetch(`https://api.supabase.com/v1/projects/${projectRef}/api-keys?reveal=true`, {
  headers: { Authorization: `Bearer ${env.SUPABASE_ACCESS_TOKEN}` },
})
if (!keyResponse.ok) throw new Error(`개발 프로젝트 키 조회 실패 (${keyResponse.status})`)
const service = (await keyResponse.json()).find(key => key.name === 'service_role')?.api_key
if (!service) throw new Error('service role 키를 찾지 못했습니다.')

const admin = createClient(url, service, { auth: { persistSession: false, autoRefreshToken: false } })
const player = createClient(url, anon, { auth: { persistSession: false, autoRefreshToken: false } })
const password = `Admin-${createHash('sha256').update(env.SUPABASE_ACCESS_TOKEN).digest('hex').slice(0, 18)}!`
const securityEmail = 'admin-player-test@swonport.kr'
const listedUsers = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 })
if (listedUsers.error) throw listedUsers.error
const existingSecurityUser = listedUsers.data.users.find(user => user.email === securityEmail)
const preparedSecurityUser = existingSecurityUser
  ? await admin.auth.admin.updateUserById(existingSecurityUser.id, {
      password, email_confirm: true, ban_duration: 'none',
      user_metadata: { nickname: '관리대상' }, app_metadata: { platform_role: 'player' },
    })
  : await admin.auth.admin.createUser({
      email: securityEmail, password, email_confirm: true,
      user_metadata: { nickname: '관리대상' }, app_metadata: { platform_role: 'player' },
    })
if (preparedSecurityUser.error || !preparedSecurityUser.data.user) throw preparedSecurityUser.error ?? new Error('보안 테스트 사용자 준비 실패')
const resetSecurityProfile = await admin.from('profiles').update({
  nickname: '관리대상', platform_role: 'player', suspended_until: null, suspension_reason: null, deleted_at: null,
}).eq('id', preparedSecurityUser.data.user.id)
if (resetSecurityProfile.error) throw resetSecurityProfile.error
const signed = await player.auth.signInWithPassword({ email: securityEmail, password })
if (signed.error || !signed.data.user) throw signed.error ?? new Error('보안 테스트 사용자 로그인 실패')

const wait = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds))
const subscribe = channel => new Promise((resolve, reject) => {
  const timeout = setTimeout(() => reject(new Error('Realtime 구독 시간 초과')), 8_000)
  channel.subscribe(status => {
    if (status === 'SUBSCRIBED') {
      clearTimeout(timeout)
      resolve()
    } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
      clearTimeout(timeout)
      reject(new Error(`Realtime 구독 실패: ${status}`))
    }
  })
})

const evilOrigin = 'https://attacker.invalid'
const rejectedOrigin = await fetch(`${url}/functions/v1/admin-actions`, {
  method: 'OPTIONS',
  headers: { Origin: evilOrigin, apikey: anon, 'Access-Control-Request-Method': 'POST' },
})
const rejectedBody = await rejectedOrigin.json().catch(() => null)
if (rejectedOrigin.status !== 403 || rejectedBody?.error !== 'origin_not_allowed' || rejectedOrigin.headers.has('access-control-allow-origin')) {
  throw new Error('허용되지 않은 관리자 API Origin이 차단되지 않았습니다.')
}
const localOrigin = 'http://127.0.0.1:43129'
const allowedOrigin = await fetch(`${url}/functions/v1/admin-actions`, {
  method: 'OPTIONS',
  headers: { Origin: localOrigin, apikey: anon, 'Access-Control-Request-Method': 'POST' },
})
if (!allowedOrigin.ok || allowedOrigin.headers.get('access-control-allow-origin') !== localOrigin) throw new Error('개발 Origin 허용 검증 실패')

const rejectedPushOrigin = await fetch(`${url}/functions/v1/send-push`, {
  method: 'OPTIONS',
  headers: { Origin: evilOrigin, apikey: anon, 'Access-Control-Request-Method': 'POST' },
})
const rejectedPushBody = await rejectedPushOrigin.json().catch(() => null)
if (rejectedPushOrigin.status !== 403 || rejectedPushBody?.error !== 'origin_not_allowed' || rejectedPushOrigin.headers.has('access-control-allow-origin')) {
  throw new Error('허용되지 않은 푸시 API Origin이 차단되지 않았습니다.')
}
const unauthenticatedPush = await fetch(`${url}/functions/v1/send-push`, {
  method: 'POST',
  headers: { Origin: localOrigin, apikey: anon, 'Content-Type': 'application/json' },
  body: JSON.stringify({ inviteId: randomUUID() }),
})
if (unauthenticatedPush.status !== 401) throw new Error('인증되지 않은 푸시 API 호출이 차단되지 않았습니다.')

for (const functionName of ['bootstrap-super-admin', 'check-identifier', 'space-admin']) {
  const rejected = await fetch(`${url}/functions/v1/${functionName}`, {
    method: 'OPTIONS',
    headers: { Origin: evilOrigin, apikey: anon, 'Access-Control-Request-Method': 'POST' },
  })
  const body = await rejected.json().catch(() => null)
  if (rejected.status !== 403 || body?.error !== 'origin_not_allowed' || rejected.headers.has('access-control-allow-origin')) {
    throw new Error(`${functionName}의 허용되지 않은 Origin이 차단되지 않았습니다.`)
  }
  const allowed = await fetch(`${url}/functions/v1/${functionName}`, {
    method: 'OPTIONS',
    headers: { Origin: localOrigin, apikey: anon, 'Access-Control-Request-Method': 'POST' },
  })
  if (!allowed.ok || allowed.headers.get('access-control-allow-origin') !== localOrigin) {
    throw new Error(`${functionName}의 가변 로컬 개발 포트가 허용되지 않았습니다.`)
  }
}
const identifierFromCurrentPort = await fetch(`${url}/functions/v1/check-identifier`, {
  method: 'POST',
  headers: { Origin: localOrigin, apikey: anon, 'Content-Type': 'application/json' },
  body: JSON.stringify({ type: 'email', value: 'invalid-email' }),
})
if (identifierFromCurrentPort.status !== 400 || identifierFromCurrentPort.headers.get('access-control-allow-origin') !== localOrigin) {
  throw new Error('현재 로컬 포트에서 중복 확인 요청이 Edge Function까지 도달하지 못했습니다.')
}
const bootstrapStatusFromCurrentPort = await fetch(`${url}/functions/v1/bootstrap-super-admin`, {
  method: 'POST',
  headers: { Origin: localOrigin, apikey: anon, 'Content-Type': 'application/json' },
  body: JSON.stringify({ action: 'status' }),
})
const bootstrapStatusBody = await bootstrapStatusFromCurrentPort.json().catch(() => null)
if (!bootstrapStatusFromCurrentPort.ok || bootstrapStatusBody?.available !== false) {
  throw new Error('현재 로컬 포트에서 최초 관리자 상태 조회가 동작하지 않았습니다.')
}
const unauthenticatedSpaceAdmin = await fetch(`${url}/functions/v1/space-admin`, {
  method: 'POST',
  headers: { Origin: localOrigin, apikey: anon, 'Content-Type': 'application/json' },
  body: JSON.stringify({ action: 'snapshot', spaceId: randomUUID() }),
})
if (unauthenticatedSpaceAdmin.status !== 401) throw new Error('인증되지 않은 스페이스 관리자 API 호출이 차단되지 않았습니다.')

const bootstrap = await player.rpc('complete_platform_bootstrap', { p_user_id: signed.data.user.id })
if (!bootstrap.error) throw new Error('일반 사용자가 최초 슈퍼 관리자 RPC를 호출했습니다.')
const directAccountDeletion = await player.rpc('finalize_account_deletion', {
  p_user_id: signed.data.user.id,
  p_deleted_tag: `deleted#${signed.data.user.id.replaceAll('-', '').slice(0, 8)}`,
  p_deleted_at: new Date().toISOString(),
})
if (!directAccountDeletion.error) throw new Error('일반 사용자가 계정 탈퇴 내부 RPC를 직접 호출했습니다.')

const target = await admin.from('profiles').select('id,nickname').neq('id', signed.data.user.id).limit(1).single()
if (target.error) throw target.error
const forgedNickname = `위조${String(Date.now()).slice(-6)}`
const forgedUpdate = await player.from('profiles').update({ nickname: forgedNickname }).eq('id', target.data.id).select('id')
if (forgedUpdate.error || forgedUpdate.data.length !== 0) throw forgedUpdate.error ?? new Error('다른 사용자 프로필 위조가 허용되었습니다.')
const unchanged = await admin.from('profiles').select('nickname').eq('id', target.data.id).single()
if (unchanged.error || unchanged.data.nickname !== target.data.nickname) throw unchanged.error ?? new Error('다른 사용자 프로필이 변경되었습니다.')

const securityRoom = await admin.from('rooms').insert({
  kind: 'private', status: 'playing', host_id: signed.data.user.id, max_players: 2,
}).select('id').single()
if (securityRoom.error) throw securityRoom.error
const securityRoomMember = await admin.from('room_members').insert({
  room_id: securityRoom.data.id,
  user_id: signed.data.user.id,
  role: 'host',
  seat: 0,
})
if (securityRoomMember.error) throw securityRoomMember.error
const securityGame = await admin.from('games').insert({
  room_id: securityRoom.data.id,
  current_turn: signed.data.user.id,
  state: { phase: 'playing', securityTest: true },
}).select('id').single()
if (securityGame.error) throw securityGame.error
const securityPlayer = await admin.from('game_players').insert({
  game_id: securityGame.data.id,
  user_id: signed.data.user.id,
  seat: 0,
  card_count: 1,
})
if (securityPlayer.error) throw securityPlayer.error

let suspendedRoomEvents = 0
let restoredRoomEvents = 0
let suspendedChannel
let restoredChannel
try {
  const suspendedProfile = await admin.from('profiles').update({
    suspended_until: new Date(Date.now() + 60_000).toISOString(),
    suspension_reason: 'Realtime 보안 자동 테스트',
  }).eq('id', signed.data.user.id)
  if (suspendedProfile.error) throw suspendedProfile.error

  suspendedChannel = player.channel(`security-suspended-${randomUUID()}`)
    .on('postgres_changes', {
      event: 'UPDATE', schema: 'public', table: 'rooms', filter: `id=eq.${securityRoom.data.id}`,
    }, () => { suspendedRoomEvents += 1 })
  await subscribe(suspendedChannel)
  await wait(300)
  const hiddenUpdate = await admin.from('rooms').update({ updated_at: new Date().toISOString() }).eq('id', securityRoom.data.id)
  if (hiddenUpdate.error) throw hiddenUpdate.error
  await wait(4_000)
  if (suspendedRoomEvents !== 0) throw new Error('정지 전에 발급된 세션이 Realtime 방 변경을 수신했습니다.')
  await player.removeChannel(suspendedChannel)
  suspendedChannel = undefined

  const restoredProfile = await admin.from('profiles').update({ suspended_until: null, suspension_reason: null }).eq('id', signed.data.user.id)
  if (restoredProfile.error) throw restoredProfile.error
  restoredChannel = player.channel(`security-restored-${randomUUID()}`)
    .on('postgres_changes', {
      event: 'UPDATE', schema: 'public', table: 'rooms', filter: `id=eq.${securityRoom.data.id}`,
    }, () => { restoredRoomEvents += 1 })
  await subscribe(restoredChannel)
  await wait(300)
  const visibleUpdate = await admin.from('rooms').update({ updated_at: new Date(Date.now() + 1_000).toISOString() }).eq('id', securityRoom.data.id)
  if (visibleUpdate.error) throw visibleUpdate.error
  for (let attempt = 0; restoredRoomEvents === 0 && attempt < 20; attempt += 1) await wait(100)
  if (restoredRoomEvents !== 1) throw new Error(`정지 해제 후 Realtime 복구 실패 (${restoredRoomEvents}건)`)
} finally {
  if (suspendedChannel) await player.removeChannel(suspendedChannel)
  if (restoredChannel) await player.removeChannel(restoredChannel)
  const restoredProfile = await admin.from('profiles').update({ suspended_until: null, suspension_reason: null }).eq('id', signed.data.user.id)
  if (restoredProfile.error) throw restoredProfile.error
}
const existingGame = { data: { game_id: securityGame.data.id, user_id: signed.data.user.id } }
const directEvent = await player.from('game_events').insert({
  game_id: existingGame.data.game_id,
  user_id: signed.data.user.id,
  event_type: 'ring',
  action_id: randomUUID(),
  payload: { security_test: true },
})
if (!directEvent.error) throw new Error('클라이언트의 game_events 직접 쓰기가 허용되었습니다.')

const actionId = randomUUID()
const firstEvent = await admin.from('game_events').insert({
  game_id: existingGame.data.game_id,
  user_id: existingGame.data.user_id,
  event_type: 'security_rate_test',
  action_id: actionId,
  payload: { security_test: true },
})
if (firstEvent.error) throw firstEvent.error
await admin.from('game_events').delete().eq('action_id', actionId)

const triggerAction = randomUUID()
const firstRing = await admin.from('game_events').insert({
  game_id: existingGame.data.game_id,
  user_id: existingGame.data.user_id,
  event_type: 'ring',
  action_id: triggerAction,
  payload: { security_test: true },
})
if (firstRing.error) throw firstRing.error
const secondAction = randomUUID()
const secondRing = await admin.from('game_events').insert({
  game_id: existingGame.data.game_id,
  user_id: existingGame.data.user_id,
  event_type: 'ring',
  action_id: secondAction,
  payload: { security_test: true },
})
await admin.from('game_events').delete().in('action_id', [triggerAction, secondAction])
if (!secondRing.error || !secondRing.error.message.includes('game_action_rate_limited')) throw new Error('게임 액션 서버 rate limit 검증 실패')

const removedSecurityRoom = await admin.from('rooms').delete().eq('id', securityRoom.data.id)
if (removedSecurityRoom.error) throw removedSecurityRoom.error

console.log('verified strict Edge CORS with variable local ports, push authentication, internal RPC denial, cross-user profile isolation, inactive-session Realtime denial and recovery, direct game-event denial, and server game-action rate limiting')
