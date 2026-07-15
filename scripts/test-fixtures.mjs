import { readFile } from 'node:fs/promises'
import { createClient } from '@supabase/supabase-js'

const CONFIRMATION = 'DELETE_DEVELOPMENT_TEST_FIXTURES'
const mode = process.argv[2] ?? 'preview'
if (!['preview', 'cleanup'].includes(mode)) throw new Error('사용법: node scripts/test-fixtures.mjs <preview|cleanup>')

const fixtureEmails = new Set([
  'account-delete-test@swonport.kr',
  'account-delete-peer-test@swonport.kr',
  'admin-created-test@swonport.kr',
  'admin-platform-test@swonport.kr',
  'admin-player-test@swonport.kr',
  'admin-super-test@swonport.kr',
  'admin-support-test@swonport.kr',
  'cards-manager-test@swonport.kr',
  'cards-member-test@swonport.kr',
  'cards-outsider-test@swonport.kr',
  'custom-game-host@swonport.kr',
  'custom-game-player@swonport.kr',
  'maintenance-admin@swonport.kr',
  'maintenance-player@swonport.kr',
  'space-bulk1@swonport.kr',
  'space-bulk2@swonport.kr',
  'space-bulk-atomic@swonport.kr',
  'space-bulk-external@example.com',
  'space-created-test@swonport.kr',
  'space-created-manager@swonport.kr',
  'space-company-manager@swonport.kr',
  'space-external-test@example.com',
  'space-fake-domain-test@fake-swonport.kr',
  'space-manager-test@swonport.kr',
  'space-member-test@swonport.kr',
  'space-outsider-test@swonport.kr',
  'space-subdomain-test@sub.swonport.kr',
  'space-super-test@swonport.kr',
  'user1@swonport.kr',
  'user2@swonport.kr',
  ...Array.from({ length: 3 }, (_, index) => `friend${index + 1}@swonport.kr`),
  ...Array.from({ length: 3 }, (_, index) => `invite${index + 1}@swonport.kr`),
  ...Array.from({ length: 3 }, (_, index) => `lobby${index + 1}@swonport.kr`),
  ...Array.from({ length: 6 }, (_, index) => `match${index + 1}@swonport.kr`),
  ...Array.from({ length: 6 }, (_, index) => `multi${index + 1}@swonport.kr`),
  ...Array.from({ length: 2 }, (_, index) => `push-e2e-${index + 1}@swonport.kr`),
  ...Array.from({ length: 2 }, (_, index) => `recovery${index + 1}@swonport.kr`),
])

const parseEnv = source => Object.fromEntries(source.split(/\r?\n/).flatMap(line => {
  const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/)
  return match ? [[match[1], match[2].replace(/^(['"])(.*)\1$/, '$2')]] : []
}))
const env = parseEnv(await readFile('.env.development', 'utf8'))
const url = process.env.TEST_SUPABASE_URL || env.VITE_SUPABASE_URL
const accessToken = process.env.SUPABASE_ACCESS_TOKEN || env.SUPABASE_ACCESS_TOKEN
if (env.VITE_APP_ENV !== 'development') throw new Error('개발 환경에서만 테스트 fixture를 정리할 수 있습니다.')
if (!url || !accessToken) throw new Error('개발 Supabase URL과 access token이 필요합니다.')

const projectRef = new URL(url).hostname.split('.')[0]
const keyResponse = await fetch(`https://api.supabase.com/v1/projects/${projectRef}/api-keys?reveal=true`, {
  headers: { Authorization: `Bearer ${accessToken}` },
})
if (!keyResponse.ok) throw new Error(`개발 프로젝트 키 조회 실패 (${keyResponse.status})`)
const serviceEntry = (await keyResponse.json()).find(key => key.name === 'service_role')
const service = serviceEntry?.api_key ?? serviceEntry?.value
if (!service) throw new Error('개발 service role 키를 찾지 못했습니다.')
const admin = createClient(url, service, { auth: { persistSession: false, autoRefreshToken: false } })

async function listAllUsers() {
  const users = []
  for (let page = 1; ; page += 1) {
    const listed = await admin.auth.admin.listUsers({ page, perPage: 1000 })
    if (listed.error) throw listed.error
    users.push(...listed.data.users)
    if (listed.data.users.length < 1000) return users
  }
}

const unique = rows => [...new Map(rows.map(row => [row.id, row])).values()]
const selectIn = async (table, columns, field, values) => {
  if (!values.length) return []
  const result = await admin.from(table).select(columns).in(field, values)
  if (result.error) throw result.error
  return result.data
}

async function snapshot() {
  const users = (await listAllUsers()).filter(user => fixtureEmails.has(user.email?.toLowerCase() ?? ''))
  const userIds = users.map(user => user.id)
  const spaces = await selectIn('spaces', 'id,created_by', 'created_by', userIds)
  const spaceIds = spaces.map(space => space.id)
  const cardSets = unique([
    ...await selectIn('card_sets', 'id,space_id,created_by,is_platform_default', 'created_by', userIds),
    ...await selectIn('card_sets', 'id,space_id,created_by,is_platform_default', 'space_id', spaceIds),
  ])
  if (cardSets.some(cardSet => cardSet.is_platform_default)) throw new Error('플랫폼 기본 카드 세트는 fixture 정리 대상이 될 수 없습니다.')
  const cardSetIds = cardSets.map(cardSet => cardSet.id)
  const rooms = unique([
    ...await selectIn('rooms', 'id,host_id,space_id,card_set_id', 'host_id', userIds),
    ...await selectIn('rooms', 'id,host_id,space_id,card_set_id', 'space_id', spaceIds),
    ...await selectIn('rooms', 'id,host_id,space_id,card_set_id', 'card_set_id', cardSetIds),
  ])
  const roomIds = rooms.map(room => room.id)
  const [spaceMembers, roomMembers, bootstrap] = await Promise.all([
    selectIn('space_members', 'space_id,user_id', 'space_id', spaceIds),
    selectIn('room_members', 'room_id,user_id', 'room_id', roomIds),
    admin.from('platform_bootstrap').select('consumed_by').eq('singleton', true).maybeSingle(),
  ])
  if (bootstrap.error) throw bootstrap.error
  const fixtureIds = new Set(userIds)
  const externalSpaceMembers = spaceMembers.filter(member => !fixtureIds.has(member.user_id))
  const externalRoomMembers = roomMembers.filter(member => !fixtureIds.has(member.user_id))
  const externalRoomHosts = rooms.filter(room => !fixtureIds.has(room.host_id))
  const bootstrapOwned = Boolean(bootstrap.data?.consumed_by && fixtureIds.has(bootstrap.data.consumed_by))
  const report = {
    projectRef,
    mode,
    fixtureAccounts: users.length,
    rooms: rooms.length,
    spaces: spaces.length,
    cardSets: cardSets.length,
    externalSpaceMembers: externalSpaceMembers.length,
    externalRoomMembers: externalRoomMembers.length,
    externalRoomHosts: externalRoomHosts.length,
    bootstrapOwned,
  }
  return { report, users, userIds, spaces, spaceIds, cardSets, cardSetIds, rooms, roomIds }
}

async function removeWhereIn(table, field, values) {
  if (!values.length) return
  const removed = await admin.from(table).delete().in(field, values)
  if (removed.error) throw removed.error
}

async function deleteUserWithRetry(userId) {
  let lastError
  for (let attempt = 0; attempt < 7; attempt += 1) {
    try {
      const removed = await admin.auth.admin.deleteUser(userId)
      if (!removed.error) return
      lastError = removed.error
    } catch (error) {
      lastError = error
    }
    await new Promise(resolve => setTimeout(resolve, Math.min(500 * (2 ** attempt), 5_000)))
  }
  throw lastError ?? new Error('fixture Auth 계정 정리 실패')
}

const before = await snapshot()
console.log(JSON.stringify(before.report))
if (mode === 'preview') process.exit(0)
if (process.env.TEST_FIXTURE_CLEANUP !== CONFIRMATION) throw new Error(`정리하려면 TEST_FIXTURE_CLEANUP=${CONFIRMATION}가 필요합니다.`)
if (before.report.bootstrapOwned) throw new Error('최초 슈퍼 관리자 계정이 fixture allowlist와 겹쳐 정리를 중단했습니다.')
if (before.report.externalSpaceMembers || before.report.externalRoomMembers || before.report.externalRoomHosts) {
  throw new Error('fixture 리소스에 allowlist 외 사용자가 연결되어 정리를 중단했습니다.')
}

for (const cardSet of before.cardSets) {
  const listed = await admin.storage.from('card-assets').list(cardSet.id, { limit: 1000 })
  if (listed.error) throw listed.error
  const paths = listed.data.filter(item => item.id).map(item => `${cardSet.id}/${item.name}`)
  if (paths.length) {
    const removed = await admin.storage.from('card-assets').remove(paths)
    if (removed.error) throw removed.error
  }
}

await removeWhereIn('moderation_actions', 'actor_id', before.userIds)
await removeWhereIn('moderation_actions', 'target_user_id', before.userIds)
await removeWhereIn('moderation_actions', 'target_room_id', before.roomIds)
await removeWhereIn('moderation_actions', 'target_space_id', before.spaceIds)
await removeWhereIn('rooms', 'id', before.roomIds)
await removeWhereIn('card_sets', 'id', before.cardSetIds)
await removeWhereIn('spaces', 'id', before.spaceIds)
for (const user of before.users.reverse()) await deleteUserWithRetry(user.id)

const after = await snapshot()
console.log(JSON.stringify({ cleaned: true, remaining: after.report }))
if (after.report.fixtureAccounts || after.report.rooms || after.report.spaces || after.report.cardSets) {
  throw new Error('fixture 데이터가 정리 후에도 남아 있습니다.')
}
