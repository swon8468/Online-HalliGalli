import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { createClient } from '@supabase/supabase-js'

const parseEnv = source => Object.fromEntries(source.split(/\r?\n/).flatMap(line => { const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/); return match ? [[match[1], match[2].replace(/^(['"])(.*)\1$/, '$2')]] : [] }))
const env = parseEnv(await readFile('.env.development', 'utf8'))
const url = env.VITE_SUPABASE_URL, anon = env.VITE_SUPABASE_ANON_KEY
if (!url || !anon || !env.SUPABASE_ACCESS_TOKEN) throw new Error('개발 Supabase 설정이 필요합니다.')
const keyResponse = await fetch(`https://api.supabase.com/v1/projects/${new URL(url).hostname.split('.')[0]}/api-keys?reveal=true`, { headers: { Authorization: `Bearer ${env.SUPABASE_ACCESS_TOKEN}` } })
if (!keyResponse.ok) throw new Error('개발 프로젝트 키 조회 실패')
const service = (await keyResponse.json()).find(key => key.name === 'service_role')?.api_key
const admin = createClient(url, service, { auth: { persistSession: false, autoRefreshToken: false } })
const password = `Space-${createHash('sha256').update(env.SUPABASE_ACCESS_TOKEN).digest('hex').slice(0, 18)}!`
const accounts = [
  { email: 'space-super-test@swonport.kr', nickname: '스페이스총괄', platformRole: 'super_admin' },
  { email: 'space-manager-test@swonport.kr', nickname: '스페이스관리', platformRole: 'player' },
  { email: 'space-member-test@swonport.kr', nickname: '스페이스멤버', platformRole: 'player' },
  { email: 'space-outsider-test@swonport.kr', nickname: '외부사용자', platformRole: 'player' },
]
const listed = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 })
if (listed.error) throw listed.error
const users = new Map()
for (const account of accounts) {
  const existing = listed.data.users.find(user => user.email === account.email)
  const result = existing
    ? await admin.auth.admin.updateUserById(existing.id, { password, email_confirm: true, ban_duration: 'none', user_metadata: { nickname: account.nickname }, app_metadata: { platform_role: account.platformRole } })
    : await admin.auth.admin.createUser({ email: account.email, password, email_confirm: true, user_metadata: { nickname: account.nickname }, app_metadata: { platform_role: account.platformRole } })
  if (result.error || !result.data.user) throw result.error ?? new Error('테스트 사용자 생성 실패')
  users.set(account.email, result.data.user)
  const profile = await admin.from('profiles').update({ nickname: account.nickname, platform_role: account.platformRole, suspended_until: null, deleted_at: null }).eq('id', result.data.user.id)
  if (profile.error) throw profile.error
}
async function clientFor(email) { const client = createClient(url, anon, { auth: { persistSession: false, autoRefreshToken: false } }); const signed = await client.auth.signInWithPassword({ email, password }); if (signed.error) throw signed.error; return client }
const superClient = await clientFor(accounts[0].email), managerClient = await clientFor(accounts[1].email), memberClient = await clientFor(accounts[2].email), outsiderClient = await clientFor(accounts[3].email)
async function invoke(client, body, expectedOk = true) {
  const result = await client.functions.invoke('space-admin', { body })
  let responseBody = result.data
  if (result.error?.context instanceof Response) responseBody = await result.error.context.json().catch(() => null)
  if (expectedOk && (result.error || !responseBody?.ok)) throw new Error(responseBody?.error ?? result.error?.message ?? 'space-admin 실패')
  if (!expectedOk && !result.error && responseBody?.ok) throw new Error(`${body.action} 요청이 잘못 허용됨`)
  return { ...result, data: responseBody }
}
async function rpc(client, name, args, expectedOk = true) { const result = await client.rpc(name, args); if (expectedOk && result.error) throw result.error; if (!expectedOk && !result.error) throw new Error(`${name} 요청이 잘못 허용됨`); return result }

let space = (await admin.from('spaces').select('id,slug,join_code').eq('slug', 'automation-organization').maybeSingle()).data
if (!space) {
  const legacySpace = (await admin.from('spaces').select('id,slug,join_code').eq('slug', 'automation-school').maybeSingle()).data
  if (legacySpace) {
    const renamed = await admin.from('spaces').update({ name: '자동화 단체', slug: 'automation-organization' }).eq('id', legacySpace.id).select('id,slug,join_code').single()
    if (renamed.error) throw renamed.error
    space = renamed.data
  }
}
if (!space) {
  const created = await invoke(superClient, { action: 'create_space', name: '자동화 단체', slug: 'automation-organization', description: '스페이스 자동 테스트', reason: '자동 테스트 스페이스 생성' })
  space = { id: created.data.space.id, slug: created.data.space.slug, join_code: null }
}
await admin.from('spaces').update({ name: '자동화 단체', status: 'active', join_enabled: true, archived_at: null }).eq('id', space.id)
await admin.from('space_members').delete().eq('space_id', space.id).neq('user_id', users.get(accounts[0].email).id)
await admin.from('space_members').upsert({ space_id: space.id, user_id: users.get(accounts[0].email).id, role: 'owner', invited_by: users.get(accounts[0].email).id }, { onConflict: 'space_id,user_id' })

await invoke(superClient, { action: 'add_existing', spaceId: space.id, email: accounts[1].email, role: 'manager', externalId: 'M-001', reason: '자동 테스트 관리자 추가' })
await invoke(superClient, { action: 'add_existing', spaceId: space.id, email: accounts[2].email, role: 'member', externalId: 'S-001', reason: '자동 테스트 멤버 추가' })
const managerSnapshot = await invoke(managerClient, { action: 'snapshot', spaceId: space.id })
if (!managerSnapshot.data.actor.canManage || managerSnapshot.data.data.members.length < 3) throw new Error('스페이스 관리자 조회 실패')
await invoke(memberClient, { action: 'update_space', spaceId: space.id, name: '권한 위조', reason: '권한 검증' }, false)
const outsiderDenied = await invoke(outsiderClient, { action: 'snapshot', spaceId: space.id }, false)
if (!/^EDGE-/.test(outsiderDenied.data?.requestId ?? '')) throw new Error('스페이스 함수 오류 진단 ID가 없습니다.')
const invalidAccount = await invoke(managerClient, { action: 'create_account', spaceId: space.id, email: 'private-address@example.com', nickname: 'x', reason: '오류 정보 노출 검증' }, false)
if (invalidAccount.data?.error !== 'invalid_account' || JSON.stringify(invalidAccount.data).includes('private-address')) throw new Error('스페이스 오류 응답에서 개인정보가 제거되지 않았습니다.')

const rotated = await invoke(managerClient, { action: 'rotate_join_code', spaceId: space.id, reason: '자동 테스트 코드 회전' })
const joinCode = rotated.data.joinCode
await admin.from('space_members').delete().eq('space_id', space.id).eq('user_id', users.get(accounts[3].email).id)
const joined = await rpc(outsiderClient, 'join_space_by_code', { p_join_code: joinCode })
if (joined.data.id !== space.id) throw new Error('가입 코드 가입 실패')

const room = await rpc(memberClient, 'create_space_room', { p_space_id: space.id, p_max_players: 3, p_card_set_id: null })
if (!room.data?.id || room.data.space_id !== space.id) throw new Error('스페이스 전용 방 생성 실패')
const roomRead = await outsiderClient.from('rooms').select('id').eq('id', room.data.id)
if (roomRead.error || roomRead.data.length !== 1) throw roomRead.error ?? new Error('같은 스페이스 멤버가 방을 읽지 못함')

let secondSpace = (await admin.from('spaces').select('id').eq('slug', 'automation-company').maybeSingle()).data
if (!secondSpace) {
  const created = await invoke(superClient, { action: 'create_space', name: '자동화 회사', slug: 'automation-company', description: '격리 자동 테스트', reason: '격리용 스페이스 생성' })
  secondSpace = { id: created.data.space.id }
}
await admin.from('spaces').update({ status: 'active', join_enabled: false, archived_at: null }).eq('id', secondSpace.id)
await invoke(managerClient, { action: 'snapshot', spaceId: secondSpace.id }, false)
const secondRoom = await admin.from('rooms').insert({ code: `ISO${String(Date.now()).slice(-3)}`, kind: 'private', status: 'waiting', host_id: users.get(accounts[0].email).id, max_players: 2, space_id: secondSpace.id }).select('id').single()
if (secondRoom.error) throw secondRoom.error
const isolatedRead = await managerClient.from('rooms').select('id').eq('id', secondRoom.data.id)
if (isolatedRead.error || isolatedRead.data.length !== 0) throw isolatedRead.error ?? new Error('다른 스페이스 방 격리 실패')
await rpc(managerClient, 'join_private_room', { p_code: (await admin.from('rooms').select('code').eq('id', secondRoom.data.id).single()).data.code }, false)

const createdAccount = await invoke(managerClient, { action: 'create_account', spaceId: space.id, email: 'space-created-test@swonport.kr', nickname: '생성멤버', role: 'member', reason: '개별 계정 생성 테스트' })
if (!createdAccount.data.account.userId) throw new Error('개별 계정 생성 실패')
const bulk = await invoke(managerClient, { action: 'bulk_create_accounts', spaceId: space.id, accounts: [{ email: 'space-bulk1@swonport.kr', nickname: '일괄멤버1', externalId: 'B-001' }, { email: 'space-bulk2@swonport.kr', nickname: '일괄멤버2', externalId: 'B-002' }], reason: 'CSV 일괄 계정 생성 테스트' })
if (bulk.data.accounts.length !== 2 || bulk.data.failures.length) throw new Error('일괄 계정 생성 실패')

await invoke(superClient, { action: 'update_space', spaceId: space.id, status: 'archived', reason: '행사 종료 테스트' })
if ((await admin.from('spaces').select('status,archived_at').eq('id', space.id).single()).data.status !== 'archived') throw new Error('스페이스 비활성화 실패')
await invoke(superClient, { action: 'update_space', spaceId: space.id, status: 'active', reason: '자동 테스트 후 복구' })

await admin.from('rooms').update({ status: 'closed' }).in('id', [room.data.id, secondRoom.data.id])
console.log('verified diagnostic IDs, PII-safe failures, space creation, manager/member roles, join-code rotation, scoped rooms, cross-space isolation, account creation, bulk CSV flow, and archive/restore')
