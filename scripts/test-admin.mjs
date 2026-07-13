import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { createClient } from '@supabase/supabase-js'

const parseEnv = source => Object.fromEntries(source.split(/\r?\n/).flatMap(line => {
  const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/)
  return match ? [[match[1], match[2].replace(/^(['"])(.*)\1$/, '$2')]] : []
}))
const env = parseEnv(await readFile('.env.development', 'utf8'))
const url = env.VITE_SUPABASE_URL, anon = env.VITE_SUPABASE_ANON_KEY
if (!url || !anon || !env.SUPABASE_ACCESS_TOKEN) throw new Error('개발 Supabase 설정이 필요합니다.')
const keyResponse = await fetch(`https://api.supabase.com/v1/projects/${new URL(url).hostname.split('.')[0]}/api-keys?reveal=true`, { headers: { Authorization: `Bearer ${env.SUPABASE_ACCESS_TOKEN}` } })
if (!keyResponse.ok) throw new Error(`개발 프로젝트 API 키 조회 실패 (${keyResponse.status})`)
const keys = await keyResponse.json()
const service = keys.find(key => key.name === 'service_role')?.api_key
if (!service) throw new Error('service role 키를 조회하지 못했습니다.')
const admin = createClient(url, service, { auth: { persistSession: false, autoRefreshToken: false } })
const password = `Admin-${createHash('sha256').update(env.SUPABASE_ACCESS_TOKEN).digest('hex').slice(0, 18)}!`

const accounts = [
  { email: 'admin-player-test@swonport.kr', nickname: '관리대상', role: 'player' },
  { email: 'admin-support-test@swonport.kr', nickname: '지원테스트', role: 'support' },
  { email: 'admin-platform-test@swonport.kr', nickname: '관리테스트', role: 'admin' },
  { email: 'admin-super-test@swonport.kr', nickname: '슈퍼테스트', role: 'super_admin' },
]
const listed = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 })
if (listed.error) throw listed.error
const users = new Map()
for (const account of accounts) {
  const existing = listed.data.users.find(user => user.email === account.email)
  const result = existing
    ? await admin.auth.admin.updateUserById(existing.id, { password, email_confirm: true, ban_duration: 'none', user_metadata: { nickname: account.nickname }, app_metadata: { platform_role: account.role } })
    : await admin.auth.admin.createUser({ email: account.email, password, email_confirm: true, user_metadata: { nickname: account.nickname }, app_metadata: { platform_role: account.role } })
  if (result.error || !result.data.user) throw result.error ?? new Error('테스트 사용자 생성 실패')
  users.set(account.role, result.data.user)
  const profile = await admin.from('profiles').update({ nickname: account.nickname, platform_role: account.role, suspended_until: null, suspension_reason: null, deleted_at: null }).eq('id', result.data.user.id)
  if (profile.error) throw profile.error
}

async function signedClient(email) {
  const client = createClient(url, anon, { auth: { persistSession: false, autoRefreshToken: false } })
  const signed = await client.auth.signInWithPassword({ email, password })
  if (signed.error) throw signed.error
  return client
}
const player = await signedClient(accounts[0].email)
const support = await signedClient(accounts[1].email)
const platform = await signedClient(accounts[2].email)
const superAdmin = await signedClient(accounts[3].email)

async function invoke(client, body, expectedOk = true) {
  const result = await client.functions.invoke('admin-actions', { body })
  let responseBody = result.data
  if (result.error?.context instanceof Response) responseBody = await result.error.context.json().catch(() => null)
  if (expectedOk && (result.error || !responseBody?.ok)) throw result.error ?? new Error(responseBody?.error ?? '관리 함수 호출 실패')
  if (!expectedOk && !result.error && responseBody?.ok) throw new Error(`${body.action} 요청이 예상과 달리 허용됨`)
  return { ...result, data: responseBody }
}

const playerDenied = await invoke(player, { action: 'snapshot' }, false)
if (!/^EDGE-/.test(playerDenied.data?.requestId ?? '')) throw new Error('관리 함수 오류 진단 ID가 없습니다.')
const supportSnapshot = await invoke(support, { action: 'snapshot' })
if (supportSnapshot.data.actor.role !== 'support' || !Array.isArray(supportSnapshot.data.data.profiles)) throw new Error('지원 담당자 조회 실패')
await invoke(support, { action: 'suspend_user', targetId: users.get('player').id, reason: '권한 검증' }, false)

await invoke(platform, { action: 'suspend_user', targetId: users.get('player').id, reason: '자동 테스트 기간 정지', durationDays: 7 })
let profile = await admin.from('profiles').select('suspended_until,suspension_reason').eq('id', users.get('player').id).single()
if (profile.error || !profile.data.suspended_until || profile.data.suspension_reason !== '자동 테스트 기간 정지') throw profile.error ?? new Error('기간 정지 반영 실패')
const suspendedRequest = await player.rpc('create_private_room', { p_max_players: 2 })
if (!suspendedRequest.error || !suspendedRequest.error.message.includes('account_suspended')) {
  throw new Error('정지 전에 발급된 JWT로 Data API 요청이 허용되었습니다.')
}
await invoke(platform, { action: 'unsuspend_user', targetId: users.get('player').id, reason: '자동 테스트 복구' })
profile = await admin.from('profiles').select('suspended_until').eq('id', users.get('player').id).single()
if (profile.error || profile.data.suspended_until) throw profile.error ?? new Error('정지 해제 실패')
const restoredRoom = await player.rpc('create_private_room', { p_max_players: 2 })
if (restoredRoom.error) throw new Error(`정지 해제 후 기존 세션 복구 실패: ${restoredRoom.error.message}`)
const restoredRoomValue = Array.isArray(restoredRoom.data) ? restoredRoom.data[0] : restoredRoom.data
await admin.from('rooms').delete().eq('id', restoredRoomValue.id)
await invoke(platform, { action: 'change_role', targetId: users.get('player').id, reason: '권한 범위 검증', role: 'support' }, false)

const now = new Date().toISOString()
const roomInsert = await admin.from('rooms').insert({ kind: 'private', status: 'waiting', host_id: users.get('player').id, max_players: 2, code: `ADM${String(Date.now()).slice(-3)}`, created_at: now, updated_at: now }).select('id').single()
if (roomInsert.error) throw roomInsert.error
await invoke(platform, { action: 'close_room', targetId: roomInsert.data.id, reason: '자동 테스트 방 종료' })
const closed = await admin.from('rooms').select('status').eq('id', roomInsert.data.id).single()
if (closed.error || closed.data.status !== 'closed') throw closed.error ?? new Error('방 강제 종료 실패')

await invoke(superAdmin, { action: 'change_role', targetId: users.get('support').id, reason: '자동 테스트 역할 변경', role: 'admin' })
let changed = await admin.from('profiles').select('platform_role').eq('id', users.get('support').id).single()
if (changed.error || changed.data.platform_role !== 'admin') throw changed.error ?? new Error('슈퍼 관리자 역할 변경 실패')
await invoke(superAdmin, { action: 'change_role', targetId: users.get('support').id, reason: '자동 테스트 역할 복원', role: 'support' })

const createdEmail = 'admin-created-test@swonport.kr'
const refreshedUsers = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 })
let created = refreshedUsers.data.users.find(user => user.email === createdEmail)
if (!created) {
  const result = await invoke(superAdmin, { action: 'create_admin', email: createdEmail, password, nickname: '생성관리자', role: 'support', reason: '자동 테스트 관리자 생성' })
  created = { id: result.data.userId, email: createdEmail }
}
const createdProfile = await admin.from('profiles').select('platform_role,nickname').eq('id', created.id).single()
if (createdProfile.error || createdProfile.data.platform_role !== 'support' || createdProfile.data.nickname !== '생성관리자') throw createdProfile.error ?? new Error('관리자 계정 생성 검증 실패')

const audit = await admin.from('moderation_actions').select('action,reason').or(`target_user_id.eq.${users.get('player').id},target_room_id.eq.${roomInsert.data.id}`).order('created_at', { ascending: false })
if (audit.error || !audit.data.some(row => row.action === 'suspend') || !audit.data.some(row => row.action === 'unsuspend') || !audit.data.some(row => row.action === 'close_room')) throw audit.error ?? new Error('감사 로그 기록 실패')

await admin.from('rooms').delete().eq('id', roomInsert.data.id)
console.log('verified diagnostic request IDs, player denial, support read-only access, existing-JWT suspension/recovery, room closure, super-admin role changes, admin creation, and immutable audit records')
