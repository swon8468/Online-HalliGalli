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
  { email: 'space-support-test@swonport.kr', nickname: '지원담당자', platformRole: 'support' },
]
const listed = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 })
if (listed.error) throw listed.error
const regeneratedEmails = new Set(['space-created-test@swonport.kr', 'space-bulk1@swonport.kr', 'space-bulk2@swonport.kr', 'space-bulk-atomic@swonport.kr'])
for (const existing of listed.data.users.filter(user => regeneratedEmails.has(user.email ?? ''))) {
  const removed = await admin.auth.admin.deleteUser(existing.id)
  if (removed.error) throw removed.error
}
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
const clearedClaims = await admin.from('space_action_claims').delete().in('actor_id', [...users.values()].map(user => user.id))
if (clearedClaims.error) throw clearedClaims.error
async function clientFor(email) { const client = createClient(url, anon, { auth: { persistSession: false, autoRefreshToken: false } }); const signed = await client.auth.signInWithPassword({ email, password }); if (signed.error) throw signed.error; return client }
const superClient = await clientFor(accounts[0].email), managerClient = await clientFor(accounts[1].email), memberClient = await clientFor(accounts[2].email), outsiderClient = await clientFor(accounts[3].email), externalClient = await clientFor(accounts[4].email), fakeDomainClient = await clientFor(accounts[5].email), subdomainClient = await clientFor(accounts[6].email), supportClient = await clientFor(accounts[7].email)
async function invoke(client, body, expectedOk = true) {
  const requestBody = { ...body, requestId: body.requestId ?? crypto.randomUUID() }
  const result = await client.functions.invoke('space-admin', { body: requestBody })
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
const ensuredInitialRoles = await admin.from('space_members').upsert([
  { space_id: space.id, user_id: users.get(accounts[0].email).id, role: 'owner', invited_by: users.get(accounts[0].email).id },
  { space_id: space.id, user_id: createdManagerUser.id, role: 'manager', invited_by: users.get(accounts[0].email).id },
], { onConflict: 'space_id,user_id' })
if (ensuredInitialRoles.error) throw ensuredInitialRoles.error
const initialRoles = await admin.from('space_members').select('user_id,role').eq('space_id', space.id).in('user_id', [users.get(accounts[0].email).id, createdManagerUser.id])
if (initialRoles.error) throw initialRoles.error
if (initialRoles.data.find(row => row.user_id === users.get(accounts[0].email).id)?.role !== 'owner' || initialRoles.data.find(row => row.user_id === createdManagerUser.id)?.role !== 'manager') throw new Error('플랫폼 관리자 owner / 별도 관리자 manager 역할 배정 실패')
const updatedCreatedManager = await admin.auth.admin.updateUserById(createdManagerUser.id, { password, email_confirm: true })
if (updatedCreatedManager.error) throw updatedCreatedManager.error
const createdManagerClient = await clientFor('space-created-manager@swonport.kr')
const createdManagerSnapshot = await invoke(createdManagerClient, { action: 'snapshot', spaceId: space.id })
if (!createdManagerSnapshot.data.actor.canManage || createdManagerSnapshot.data.actor.spaceRole !== 'manager') throw new Error('별도 스페이스 관리자 로그인 또는 관리 권한 실패')
await admin.from('spaces').update({ name: '자동화 단체', status: 'active', join_enabled: true, join_policy: 'code', join_code_expires_at: null, allowed_email_domain: '@swonport.kr', allowed_email_domains: ['@swonport.kr'], archived_at: null }).eq('id', space.id)
await admin.from('space_members').delete().eq('space_id', space.id).neq('user_id', users.get(accounts[0].email).id)
await admin.from('space_members').upsert({ space_id: space.id, user_id: users.get(accounts[0].email).id, role: 'owner', invited_by: users.get(accounts[0].email).id }, { onConflict: 'space_id,user_id' })

await invoke(superClient, { action: 'add_existing', spaceId: space.id, email: accounts[1].email, role: 'manager', externalId: 'M-001', reason: '자동 테스트 관리자 추가' })
await invoke(superClient, { action: 'add_existing', spaceId: space.id, email: accounts[2].email, role: 'member', externalId: 'S-001', reason: '자동 테스트 멤버 추가' })
const managerSnapshot = await invoke(managerClient, { action: 'snapshot', spaceId: space.id })
if (!managerSnapshot.data.actor.canManage || managerSnapshot.data.data.metrics.members < 3) throw new Error('스페이스 관리자 조회 실패')
const managerMembers = await invoke(managerClient, { action: 'members_page', spaceId: space.id, page: 1, pageSize: 2 })
if (managerMembers.data.data.items.length !== 2 || managerMembers.data.data.total < 3) throw new Error('멤버 서버 페이지네이션 실패')
const memberSnapshot = await invoke(memberClient, { action: 'snapshot', spaceId: space.id }, false)
if (memberSnapshot.data?.error !== 'space_manager_required') throw new Error('일반 멤버의 관리 snapshot 접근이 차단되지 않았습니다.')
const supportSnapshot = await invoke(supportClient, { action: 'snapshot', spaceId: space.id })
if (supportSnapshot.data.actor.canManage || !supportSnapshot.data.actor.canView) throw new Error('지원 담당자 읽기 전용 권한이 올바르지 않습니다.')
if (supportSnapshot.data.data.space.join_code !== null) throw new Error('지원 담당자에게 가입 코드가 노출되었습니다.')
const supportMembers = await invoke(supportClient, { action: 'members_page', spaceId: space.id })
if (!supportMembers.data.actor.piiMasked || supportMembers.data.data.items.some(member => member.email || member.phone)) throw new Error('지원 담당자 멤버 연락처가 마스킹되지 않았습니다.')
await invoke(supportClient, { action: 'update_space', spaceId: space.id, name: '지원 계정 위조' }, false)
await invoke(memberClient, { action: 'update_space', spaceId: space.id, name: '권한 위조', reason: '권한 검증' }, false)
const outsiderDenied = await invoke(outsiderClient, { action: 'snapshot', spaceId: space.id }, false)
if (!/^EDGE-/.test(outsiderDenied.data?.requestId ?? '')) throw new Error('스페이스 함수 오류 진단 ID가 없습니다.')
const invalidAccount = await invoke(managerClient, { action: 'create_account', spaceId: space.id, email: 'private-address@example.com', nickname: 'x', reason: '오류 정보 노출 검증' }, false)
if (invalidAccount.data?.error !== 'invalid_account' || JSON.stringify(invalidAccount.data).includes('private-address')) throw new Error('스페이스 오류 응답에서 개인정보가 제거되지 않았습니다.')

const managerRotation = await invoke(managerClient, { action: 'rotate_join_code', spaceId: space.id }, false)
if (managerRotation.data?.error !== 'space_owner_required') throw new Error('관리자의 소유자 전용 가입 코드 회전이 차단되지 않았습니다.')
const rotated = await invoke(superClient, { action: 'rotate_join_code', spaceId: space.id })
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
await admin.from('spaces').update({ status: 'active', join_enabled: false, join_policy: 'closed', allowed_email_domain: '@swonport.kr', allowed_email_domains: ['@swonport.kr'], archived_at: null }).eq('id', secondSpace.id)
await invoke(managerClient, { action: 'snapshot', spaceId: secondSpace.id }, false)
const secondRoom = await admin.from('rooms').insert({ code: `ISO${String(Date.now()).slice(-3)}`, kind: 'private', status: 'waiting', host_id: users.get(accounts[0].email).id, max_players: 2, space_id: secondSpace.id }).select('id').single()
if (secondRoom.error) throw secondRoom.error
const isolatedRead = await managerClient.from('rooms').select('id').eq('id', secondRoom.data.id)
if (isolatedRead.error || isolatedRead.data.length !== 0) throw isolatedRead.error ?? new Error('다른 스페이스 방 격리 실패')
await rpc(managerClient, 'join_private_room', { p_code: (await admin.from('rooms').select('code').eq('id', secondRoom.data.id).single()).data.code }, false)

const createdAccount = await invoke(managerClient, { action: 'create_account', spaceId: space.id, email: 'space-created-test@swonport.kr', nickname: '생성멤버', role: 'member', reason: '개별 계정 생성 테스트' })
if (!createdAccount.data.account.userId) throw new Error('개별 계정 생성 실패')
const managedAccountId = createdAccount.data.account.userId
const managedAccountClient = createClient(url, anon, { auth: { persistSession: false, autoRefreshToken: false } })
const managedSignIn = await managedAccountClient.auth.signInWithPassword({ email: 'space-created-test@swonport.kr', password: createdAccount.data.account.password })
if (managedSignIn.error) throw managedSignIn.error
await invoke(managerClient, { action: 'update_account', spaceId: space.id, targetUserId: managedAccountId, nickname: '수정멤버', externalId: 'U-001' })
const passwordReset = await invoke(managerClient, { action: 'reset_password', spaceId: space.id, targetUserId: managedAccountId })
if (!passwordReset.data.credential?.password || JSON.stringify(passwordReset.data).includes(createdAccount.data.account.password)) throw new Error('임시 비밀번호 일회성 재발급 실패')
const invalidatedSession = await managedAccountClient.from('profiles').select('id').eq('id', managedAccountId)
if (!invalidatedSession.error?.message.includes('session_invalidated')) throw new Error('비밀번호 재발급 후 기존 데이터 세션이 무효화되지 않았습니다.')
await invoke(managerClient, { action: 'suspend_account', spaceId: space.id, targetUserId: managedAccountId })
const suspendedSignIn = await createClient(url, anon, { auth: { persistSession: false } }).auth.signInWithPassword({ email: 'space-created-test@swonport.kr', password: passwordReset.data.credential.password })
if (!suspendedSignIn.error) throw new Error('정지된 관리 계정 로그인이 허용되었습니다.')
await invoke(managerClient, { action: 'reactivate_account', spaceId: space.id, targetUserId: managedAccountId })
const reactivatedClient = createClient(url, anon, { auth: { persistSession: false, autoRefreshToken: false } })
const reactivatedSignIn = await reactivatedClient.auth.signInWithPassword({ email: 'space-created-test@swonport.kr', password: passwordReset.data.credential.password })
if (reactivatedSignIn.error) throw reactivatedSignIn.error
await reactivatedClient.auth.signOut()
const protectedExisting = await invoke(managerClient, { action: 'reset_password', spaceId: space.id, targetUserId: users.get(accounts[2].email).id }, false)
if (protectedExisting.data?.error !== 'existing_account_protected') throw new Error('기존 개인 계정의 비밀번호 관리가 차단되지 않았습니다.')
const atomicBulk = await invoke(managerClient, { action: 'bulk_create_accounts', spaceId: space.id, accounts: [{ email: 'space-bulk-atomic@swonport.kr', nickname: '원자멤버' }, { email: 'space-bulk-external@example.com', nickname: '외부멤버' }], reason: '일괄 원자성 검증' }, false)
if (atomicBulk.data?.error !== 'bulk_validation_failed' || atomicBulk.data?.failures?.[0]?.error !== 'space_email_domain_required') throw new Error('일괄 등록 선검증 실패')
const afterRejectedBulk = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 })
if (afterRejectedBulk.error) throw afterRejectedBulk.error
if (afterRejectedBulk.data.users.some(user => user.email === 'space-bulk-atomic@swonport.kr')) throw new Error('실패한 일괄 요청이 일부 계정을 남겼습니다.')
const bulk = await invoke(managerClient, { action: 'bulk_create_accounts', spaceId: space.id, accounts: [{ email: 'space-bulk1@swonport.kr', nickname: '일괄멤버1', externalId: 'B-001' }, { email: 'space-bulk2@swonport.kr', nickname: '일괄멤버2', externalId: 'B-002' }], reason: 'CSV 일괄 계정 생성 테스트' })
if (bulk.data.accounts.length !== 2 || bulk.data.failures.length) throw new Error('일괄 계정 생성 실패')
const managedPage = await invoke(managerClient, { action: 'members_page', spaceId: space.id, kindFilter: 'managed', page: 1, pageSize: 1 })
if (managedPage.data.data.total < 3 || managedPage.data.data.items.length !== 1) throw new Error('관리 계정 필터/페이지네이션 실패')
await invoke(managerClient, { action: 'delete_account', spaceId: space.id, targetUserId: bulk.data.accounts[0].userId })
const deletedManaged = await admin.auth.admin.getUserById(bulk.data.accounts[0].userId)
if (!deletedManaged.error) throw new Error('안전 검사를 통과한 관리 계정이 삭제되지 않았습니다.')

const idempotencyId = crypto.randomUUID()
await invoke(superClient, { action: 'update_space', spaceId: space.id, description: '멱등성 검증', requestId: idempotencyId })
const replay = await invoke(superClient, { action: 'update_space', spaceId: space.id, description: '재실행 금지', requestId: idempotencyId }, false)
if (replay.data?.error !== 'action_already_processed') throw new Error('민감 작업 중복 실행이 차단되지 않았습니다.')

await invoke(superClient, { action: 'transfer_owner', spaceId: space.id, targetUserId: users.get(accounts[1].email).id })
const ownerAfterTransfer = await admin.from('space_members').select('user_id,role').eq('space_id', space.id).in('user_id', [users.get(accounts[0].email).id, users.get(accounts[1].email).id])
if (ownerAfterTransfer.data.find(item => item.user_id === users.get(accounts[1].email).id)?.role !== 'owner') throw new Error('소유권 이전 실패')
await invoke(managerClient, { action: 'transfer_owner', spaceId: space.id, targetUserId: users.get(accounts[0].email).id })

await invoke(superClient, { action: 'update_space', spaceId: space.id, joinPolicy: 'closed' })
const closedJoin = await rpc(outsiderClient, 'join_space_by_code', { p_join_code: joinCode }, false)
if (closedJoin.error?.message !== 'space_join_disabled') throw new Error('가입 중지 정책이 적용되지 않았습니다.')
await invoke(superClient, { action: 'update_space', spaceId: space.id, joinPolicy: 'code', joinEnabled: true, joinCodeExpiresAt: new Date(Date.now() - 60_000).toISOString() })
const expiredJoin = await rpc(outsiderClient, 'join_space_by_code', { p_join_code: joinCode }, false)
if (expiredJoin.error?.message !== 'space_join_code_expired') throw new Error('가입 코드 만료가 적용되지 않았습니다.')
await invoke(superClient, { action: 'update_space', spaceId: space.id, joinCodeExpiresAt: null })

await invoke(superClient, { action: 'update_space', spaceId: space.id, status: 'archived', reason: '행사 종료 테스트' })
if ((await admin.from('spaces').select('status,archived_at').eq('id', space.id).single()).data.status !== 'archived') throw new Error('스페이스 비활성화 실패')
await invoke(superClient, { action: 'update_space', spaceId: space.id, status: 'active', reason: '자동 테스트 후 복구' })

await admin.from('rooms').update({ status: 'closed' }).in('id', [room.data.id, secondRoom.data.id])
console.log('verified PII-safe permissions, server pagination, join policies, managed-account lifecycle/session invalidation, idempotency, ownership transfer, scoped rooms, bulk atomicity, and archive/restore')
