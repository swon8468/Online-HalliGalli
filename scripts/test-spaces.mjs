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
  { email: 'space-external-test@example.com', nickname: '외부도메인', platformRole: 'player' },
  { email: 'space-fake-domain-test@fake-swonport.kr', nickname: '유사도메인', platformRole: 'player' },
  { email: 'space-subdomain-test@sub.swonport.kr', nickname: '하위도메인', platformRole: 'player' },
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
const superClient = await clientFor(accounts[0].email), managerClient = await clientFor(accounts[1].email), memberClient = await clientFor(accounts[2].email), outsiderClient = await clientFor(accounts[3].email), externalClient = await clientFor(accounts[4].email), fakeDomainClient = await clientFor(accounts[5].email), subdomainClient = await clientFor(accounts[6].email)
async function invoke(client, body, expectedOk = true) {
  const result = await client.functions.invoke('space-admin', { body })
  let responseBody = result.data
  if (result.error?.context instanceof Response) responseBody = await result.error.context.json().catch(() => null)
  if (expectedOk && (result.error || !responseBody?.ok)) throw new Error(responseBody?.error ?? result.error?.message ?? 'space-admin 실패')
  if (!expectedOk && !result.error && responseBody?.ok) throw new Error(`${body.action} 요청이 잘못 허용됨`)
  return { ...result, data: responseBody }
}
async function rpc(client, name, args, expectedOk = true) { const result = await client.rpc(name, args); if (expectedOk && result.error) throw result.error; if (!expectedOk && !result.error) throw new Error(`${name} 요청이 잘못 허용됨`); return result }

for (const invalidDomain of ['swonport.kr', '@@swonport.kr', '@swonport']) {
  const denied = await invoke(superClient, { action: 'create_space', name: '잘못된 도메인', slug: `invalid-domain-${invalidDomain.length}-${invalidDomain.charCodeAt(0)}`, emailDomain: invalidDomain, managerEmail: 'never-created@swonport.kr', managerNickname: '생성금지', managerPassword: password, reason: '도메인 입력 검증' }, false)
  if (denied.data?.error !== 'invalid_email_domain') throw new Error(`${invalidDomain} 형식이 차단되지 않았습니다.`)
}
const malformedManager = await invoke(superClient, { action: 'create_space', name: '잘못된 관리자', slug: 'invalid-manager-email', emailDomain: '@swonport.kr', managerEmail: 'manager@@swonport.kr', managerNickname: '생성금지', managerPassword: password, reason: '관리자 이메일 검증' }, false)
if (malformedManager.data?.error !== 'manager_email_domain_mismatch') throw new Error('복수 @ 관리자 이메일이 차단되지 않았습니다.')

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
  const created = await invoke(superClient, { action: 'create_space', name: '자동화 단체', slug: 'automation-organization', description: '스페이스 자동 테스트', emailDomain: ' @SWONPORT.KR ', managerEmail: ' SPACE-CREATED-MANAGER@SWONPORT.KR ', managerNickname: '자동관리자', managerPassword: password, reason: '자동 테스트 스페이스 생성' })
  if (created.data.manager.email !== 'space-created-manager@swonport.kr' || created.data.manager.role !== 'manager' || !created.data.manager.password) throw new Error('별도 스페이스 관리자 생성 실패')
  space = { id: created.data.space.id, slug: created.data.space.slug, join_code: null }
}
const createdManagers = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 })
if (createdManagers.error) throw createdManagers.error
const createdManagerUser = createdManagers.data.users.find(user => user.email === 'space-created-manager@swonport.kr')
if (!createdManagerUser) throw new Error('별도 스페이스 관리자 Auth 계정이 없습니다.')
const initialRoles = await admin.from('space_members').select('user_id,role').eq('space_id', space.id).in('user_id', [users.get(accounts[0].email).id, createdManagerUser.id])
if (initialRoles.error) throw initialRoles.error
if (initialRoles.data.find(row => row.user_id === users.get(accounts[0].email).id)?.role !== 'owner' || initialRoles.data.find(row => row.user_id === createdManagerUser.id)?.role !== 'manager') throw new Error('플랫폼 관리자 owner / 별도 관리자 manager 역할 배정 실패')
const updatedCreatedManager = await admin.auth.admin.updateUserById(createdManagerUser.id, { password, email_confirm: true })
if (updatedCreatedManager.error) throw updatedCreatedManager.error
const createdManagerClient = await clientFor('space-created-manager@swonport.kr')
const createdManagerSnapshot = await invoke(createdManagerClient, { action: 'snapshot', spaceId: space.id })
if (!createdManagerSnapshot.data.actor.canManage || createdManagerSnapshot.data.actor.spaceRole !== 'manager') throw new Error('별도 스페이스 관리자 로그인 또는 관리 권한 실패')
await admin.from('spaces').update({ name: '자동화 단체', status: 'active', join_enabled: true, allowed_email_domain: '@swonport.kr', archived_at: null }).eq('id', space.id)
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
const externalJoin = await rpc(externalClient, 'join_space_by_code', { p_join_code: joinCode }, false)
if (externalJoin.error?.message !== 'space_email_domain_required') throw new Error('기관 이메일 도메인 가입 제한 실패')
for (const client of [fakeDomainClient, subdomainClient]) {
  const denied = await rpc(client, 'join_space_by_code', { p_join_code: joinCode }, false)
  if (denied.error?.message !== 'space_email_domain_required') throw new Error('유사 또는 하위 도메인 가입 제한 실패')
}
const externalAttach = await invoke(superClient, { action: 'add_existing', spaceId: space.id, email: accounts[4].email, role: 'member', reason: '외부 도메인 차단 검증' }, false)
if (externalAttach.data?.error !== 'space_email_domain_required') throw new Error('외부 도메인 기존 계정 연결 차단 실패')

const room = await rpc(memberClient, 'create_space_room', { p_space_id: space.id, p_max_players: 3, p_card_set_id: null })
if (!room.data?.id || room.data.space_id !== space.id) throw new Error('스페이스 전용 방 생성 실패')
const roomRead = await outsiderClient.from('rooms').select('id').eq('id', room.data.id)
if (roomRead.error || roomRead.data.length !== 1) throw roomRead.error ?? new Error('같은 스페이스 멤버가 방을 읽지 못함')

let secondSpace = (await admin.from('spaces').select('id').eq('slug', 'automation-company').maybeSingle()).data
if (!secondSpace) {
  const created = await invoke(superClient, { action: 'create_space', name: '자동화 회사', slug: 'automation-company', description: '격리 자동 테스트', emailDomain: '@swonport.kr', managerEmail: 'space-company-manager@swonport.kr', managerNickname: '회사관리자', reason: '격리용 스페이스 생성' })
  secondSpace = { id: created.data.space.id }
}
await admin.from('spaces').update({ status: 'active', join_enabled: false, allowed_email_domain: '@swonport.kr', archived_at: null }).eq('id', secondSpace.id)
await invoke(managerClient, { action: 'snapshot', spaceId: secondSpace.id }, false)
const secondRoom = await admin.from('rooms').insert({ code: `ISO${String(Date.now()).slice(-3)}`, kind: 'private', status: 'waiting', host_id: users.get(accounts[0].email).id, max_players: 2, space_id: secondSpace.id }).select('id').single()
if (secondRoom.error) throw secondRoom.error
const isolatedRead = await managerClient.from('rooms').select('id').eq('id', secondRoom.data.id)
if (isolatedRead.error || isolatedRead.data.length !== 0) throw isolatedRead.error ?? new Error('다른 스페이스 방 격리 실패')
await rpc(managerClient, 'join_private_room', { p_code: (await admin.from('rooms').select('code').eq('id', secondRoom.data.id).single()).data.code }, false)

const createdAccount = await invoke(managerClient, { action: 'create_account', spaceId: space.id, email: 'space-created-test@swonport.kr', nickname: '생성멤버', role: 'member', reason: '개별 계정 생성 테스트' })
if (!createdAccount.data.account.userId) throw new Error('개별 계정 생성 실패')
const atomicBulk = await invoke(managerClient, { action: 'bulk_create_accounts', spaceId: space.id, accounts: [{ email: 'space-bulk-atomic@swonport.kr', nickname: '원자멤버' }, { email: 'space-bulk-external@example.com', nickname: '외부멤버' }], reason: '일괄 원자성 검증' }, false)
if (atomicBulk.data?.error !== 'bulk_validation_failed' || atomicBulk.data?.failures?.[0]?.error !== 'space_email_domain_required') throw new Error('일괄 등록 선검증 실패')
const afterRejectedBulk = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 })
if (afterRejectedBulk.error) throw afterRejectedBulk.error
if (afterRejectedBulk.data.users.some(user => user.email === 'space-bulk-atomic@swonport.kr')) throw new Error('실패한 일괄 요청이 일부 계정을 남겼습니다.')
const bulk = await invoke(managerClient, { action: 'bulk_create_accounts', spaceId: space.id, accounts: [{ email: 'space-bulk1@swonport.kr', nickname: '일괄멤버1', externalId: 'B-001' }, { email: 'space-bulk2@swonport.kr', nickname: '일괄멤버2', externalId: 'B-002' }], reason: 'CSV 일괄 계정 생성 테스트' })
if (bulk.data.accounts.length !== 2 || bulk.data.failures.length) throw new Error('일괄 계정 생성 실패')

await invoke(superClient, { action: 'update_space', spaceId: space.id, status: 'archived', reason: '행사 종료 테스트' })
if ((await admin.from('spaces').select('status,archived_at').eq('id', space.id).single()).data.status !== 'archived') throw new Error('스페이스 비활성화 실패')
await invoke(superClient, { action: 'update_space', spaceId: space.id, status: 'active', reason: '자동 테스트 후 복구' })

await admin.from('rooms').update({ status: 'closed' }).in('id', [room.data.id, secondRoom.data.id])
console.log('verified diagnostic IDs, PII-safe failures, space creation, manager/member roles, join-code rotation, scoped rooms, cross-space isolation, account creation, bulk CSV flow, and archive/restore')
