import { readFile } from 'node:fs/promises'
import { createClient } from '@supabase/supabase-js'

const parseEnv = source => Object.fromEntries(source.split(/\r?\n/).flatMap(line => {
  const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/)
  return match ? [[match[1], match[2].replace(/^(['"])(.*)\1$/, '$2')]] : []
}))
const env = parseEnv(await readFile('.env.development', 'utf8'))
const url = env.VITE_SUPABASE_URL, anon = env.VITE_SUPABASE_ANON_KEY
const response = await fetch(`https://api.supabase.com/v1/projects/${new URL(url).hostname.split('.')[0]}/api-keys?reveal=true`, { headers: { Authorization: `Bearer ${env.SUPABASE_ACCESS_TOKEN}` } })
if (!response.ok) throw new Error(`개발 프로젝트 API 키 조회 실패 (${response.status})`)
const keys = await response.json()
const service = keys.find(key => key.name === 'service_role')?.api_key
if (!url || !anon || !service) throw new Error('개발 Supabase 설정이 필요합니다.')
const admin = createClient(url, service, { auth: { persistSession: false, autoRefreshToken: false } })
const localOrigin = 'http://127.0.0.1:43129'
const rejectedOrigin = await fetch(`${url}/functions/v1/delete-account`, {
  method: 'OPTIONS',
  headers: { Origin: 'https://attacker.invalid', apikey: anon, 'Access-Control-Request-Method': 'POST' },
})
const rejectedBody = await rejectedOrigin.json().catch(() => null)
if (rejectedOrigin.status !== 403 || rejectedBody?.error !== 'origin_not_allowed' || rejectedOrigin.headers.has('access-control-allow-origin')) {
  throw new Error('허용되지 않은 회원 탈퇴 API Origin이 차단되지 않았습니다.')
}
const unauthenticatedDelete = await fetch(`${url}/functions/v1/delete-account`, {
  method: 'POST',
  headers: { Origin: localOrigin, apikey: anon, 'Content-Type': 'application/json' },
  body: JSON.stringify({ confirmation: '회원 탈퇴' }),
})
if (unauthenticatedDelete.status !== 401) throw new Error('인증되지 않은 회원 탈퇴 API 호출이 차단되지 않았습니다.')

const email = 'account-delete-test@swonport.kr', peerEmail = 'account-delete-peer-test@swonport.kr'
const initialPassword = 'AccountTest2026', changedPassword = 'AccountChanged2026'
const listed = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 })
if (listed.error) throw listed.error
let account = listed.data.users.find(user => user.email === email)
const authResult = account
  ? await admin.auth.admin.updateUserById(account.id, { password: initialPassword, email_confirm: true, ban_duration: 'none', user_metadata: { nickname: '계정테스트' } })
  : await admin.auth.admin.createUser({ email, password: initialPassword, email_confirm: true, user_metadata: { nickname: '계정테스트' } })
if (authResult.error) throw authResult.error
account = authResult.data.user
let peer = listed.data.users.find(user => user.email === peerEmail)
const peerResult = peer
  ? await admin.auth.admin.updateUserById(peer.id, { password: initialPassword, email_confirm: true, ban_duration: 'none', user_metadata: { nickname: '탈퇴검증친구' } })
  : await admin.auth.admin.createUser({ email: peerEmail, password: initialPassword, email_confirm: true, user_metadata: { nickname: '탈퇴검증친구' } })
if (peerResult.error || !peerResult.data.user) throw peerResult.error ?? new Error('탈퇴 검증 상대 계정 생성 실패')
peer = peerResult.data.user
const resetProfile = await admin.from('profiles').update({ nickname: '계정테스트', friend_tag: `account#${account.id.replaceAll('-', '').slice(0, 8)}`, deleted_at: null, suspended_until: null, suspension_reason: null }).eq('id', account.id)
if (resetProfile.error) throw resetProfile.error
const resetPeer = await admin.from('profiles').update({ nickname: '탈퇴검증친구', deleted_at: null, suspended_until: null, suspension_reason: null }).eq('id', peer.id)
if (resetPeer.error) throw resetPeer.error

const room = await admin.from('rooms').insert({ kind: 'private', status: 'waiting', host_id: peer.id, max_players: 2 }).select('id').single()
if (room.error) throw room.error
const seededRelationships = await Promise.all([
  admin.from('matchmaking_queue').upsert({ user_id: account.id, player_count: 2, status: 'waiting', heartbeat_at: new Date().toISOString() }),
  admin.from('game_invites').insert({ sender_id: peer.id, receiver_id: account.id, room_id: room.data.id }),
  admin.from('friend_requests').insert({ sender_id: peer.id, receiver_id: account.id }),
  admin.from('friendships').upsert({ user_low: account.id < peer.id ? account.id : peer.id, user_high: account.id < peer.id ? peer.id : account.id }),
])
if (seededRelationships.some(result => result.error)) throw seededRelationships.find(result => result.error).error

const client = createClient(url, anon, { auth: { persistSession: false, autoRefreshToken: false } })
let signed = await client.auth.signInWithPassword({ email, password: initialPassword })
if (signed.error) throw signed.error
let update = await client.from('profiles').update({ nickname: '계정수정테스트' }).eq('id', account.id)
if (update.error) throw update.error
const changed = await client.auth.updateUser({ password: changedPassword })
if (changed.error) throw changed.error
await client.auth.signOut()
signed = await client.auth.signInWithPassword({ email, password: changedPassword })
if (signed.error) throw signed.error

const invalidDelete = await client.functions.invoke('delete-account', { body: { confirmation: '잘못된 확인' } })
if (!invalidDelete.error) throw new Error('잘못된 탈퇴 확인값이 허용됨')
const deleted = await client.functions.invoke('delete-account', { body: { confirmation: '회원 탈퇴' } })
if (deleted.error || !deleted.data?.ok) throw deleted.error ?? new Error('회원 탈퇴 함수 실패')
const deletedProfile = await admin.from('profiles').select('nickname,deleted_at').eq('id', account.id).single()
if (deletedProfile.error || !deletedProfile.data.deleted_at || deletedProfile.data.nickname !== '탈퇴한 사용자') throw deletedProfile.error ?? new Error('프로필 탈퇴 상태 반영 실패')
const [queue, invite, request, friendship] = await Promise.all([
  admin.from('matchmaking_queue').select('user_id').eq('user_id', account.id),
  admin.from('game_invites').select('status').eq('receiver_id', account.id).eq('room_id', room.data.id).single(),
  admin.from('friend_requests').select('status').eq('receiver_id', account.id).eq('sender_id', peer.id).single(),
  admin.from('friendships').select('user_low').or(`user_low.eq.${account.id},user_high.eq.${account.id}`),
])
if (queue.error || queue.data.length || invite.error || invite.data.status !== 'cancelled'
  || request.error || request.data.status !== 'cancelled' || friendship.error || friendship.data.length) {
  throw queue.error ?? invite.error ?? request.error ?? friendship.error ?? new Error('탈퇴 연관 데이터 원자적 정리 실패')
}
const deletedSessionRequest = await client.rpc('create_private_room', { p_max_players: 2 })
if (!deletedSessionRequest.error || !deletedSessionRequest.error.message.includes('account_deleted')) {
  throw new Error('탈퇴 전에 발급된 JWT로 Data API 요청이 허용되었습니다.')
}
await client.auth.signOut()
const denied = await client.auth.signInWithPassword({ email, password: changedPassword })
if (!denied.error) throw new Error('탈퇴 계정 재로그인이 허용됨')

await admin.from('rooms').delete().eq('id', room.data.id)

console.log('verified profile update, password change, strict deletion confirmation, atomic relationship cleanup, existing-JWT rejection, soft deletion, auth ban, and deleted-account login rejection')
