import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { createClient } from '@supabase/supabase-js'

const parseEnv = source => Object.fromEntries(source.split(/\r?\n/).flatMap(line => { const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/); return match ? [[match[1], match[2].replace(/^(['"])(.*)\1$/, '$2')]] : [] }))
const env = parseEnv(await readFile('.env.development', 'utf8')), url = env.VITE_SUPABASE_URL, anon = env.VITE_SUPABASE_ANON_KEY
const keyResponse = await fetch(`https://api.supabase.com/v1/projects/${new URL(url).hostname.split('.')[0]}/api-keys?reveal=true`, { headers: { Authorization: `Bearer ${env.SUPABASE_ACCESS_TOKEN}` } })
if (!keyResponse.ok) throw new Error('개발 프로젝트 키 조회 실패')
const service = (await keyResponse.json()).find(key => key.name === 'service_role')?.api_key
const admin = createClient(url, service, { auth: { persistSession: false, autoRefreshToken: false } })
const password = `Cards-${createHash('sha256').update(env.SUPABASE_ACCESS_TOKEN).digest('hex').slice(0, 18)}!`
const identities = [
  { email: 'cards-manager-test@swonport.kr', nickname: '카드관리자' },
  { email: 'cards-member-test@swonport.kr', nickname: '카드멤버' },
  { email: 'cards-outsider-test@swonport.kr', nickname: '카드외부' },
]
const listed = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 }); if (listed.error) throw listed.error
const users = new Map()
for (const item of identities) {
  const existing = listed.data.users.find(user => user.email === item.email)
  const result = existing ? await admin.auth.admin.updateUserById(existing.id, { password, email_confirm: true, ban_duration: 'none', user_metadata: { nickname: item.nickname }, app_metadata: { platform_role: 'player' } }) : await admin.auth.admin.createUser({ email: item.email, password, email_confirm: true, user_metadata: { nickname: item.nickname } })
  if (result.error || !result.data.user) throw result.error ?? new Error('테스트 계정 생성 실패')
  users.set(item.email, result.data.user)
  await admin.from('profiles').update({ nickname: item.nickname, platform_role: 'player', deleted_at: null, suspended_until: null }).eq('id', result.data.user.id)
}
const space = (await admin.from('spaces').select('id').eq('slug', 'automation-organization').single()).data
if (!space) throw new Error('스페이스 테스트를 먼저 실행해 주세요.')
await admin.from('spaces').update({ status: 'active' }).eq('id', space.id)
await admin.from('space_members').upsert([
  { space_id: space.id, user_id: users.get(identities[0].email).id, role: 'manager' },
  { space_id: space.id, user_id: users.get(identities[1].email).id, role: 'member' },
], { onConflict: 'space_id,user_id' })
async function signed(email) { const c = createClient(url, anon, { auth: { persistSession: false, autoRefreshToken: false } }); const result = await c.auth.signInWithPassword({ email, password }); if (result.error) throw result.error; return c }
const manager = await signed(identities[0].email), member = await signed(identities[1].email), outsider = await signed(identities[2].email)
async function rpc(c, name, args, expectOk = true) { const result = await c.rpc(name, args); if (expectOk && result.error) throw result.error; if (!expectOk && !result.error) throw new Error(`${name} 요청이 잘못 허용됨`); return result }
async function deleteSet(cardSetId, expectOk = true) {
  const result = await manager.functions.invoke('delete-card-set', { body: { cardSetId } })
  if (expectOk && (result.error || !result.data?.ok)) throw result.error ?? new Error(result.data?.error ?? '카드 세트 삭제 실패')
  if (!expectOk && !result.error && result.data?.ok) throw new Error('사용 중인 카드 세트 삭제가 잘못 허용됨')
  return result
}

const defaults = await manager.from('card_sets').select('id,name,status,version').eq('is_platform_default', true).single()
if (defaults.error || defaults.data.status !== 'published') throw defaults.error ?? new Error('기본 카드 세트 없음')
const defaultDesigns = await manager.from('card_designs').select('id').eq('card_set_id', defaults.data.id)
if (defaultDesigns.error || defaultDesigns.data.length !== 20) throw defaultDesigns.error ?? new Error('기본 56장 디자인 구성 실패')
const forbiddenDefaultEdit = await manager.from('card_designs').update({ label: '위조' }).eq('id', defaultDesigns.data[0].id).select('id')
if (!forbiddenDefaultEdit.error && forbiddenDefaultEdit.data.length > 0) throw new Error('게시된 기본 카드 편집이 허용됨')
await rpc(member, 'create_card_set', { p_name: '권한 위조', p_description: '', p_space_id: space.id }, false)

const oldSets = await admin.from('card_sets').select('id').eq('space_id', space.id).like('name', '자동 카드%')
if (oldSets.data?.length) {
  await admin.from('rooms').update({ card_set_id: null }).in('card_set_id', oldSets.data.map(item => item.id))
  await admin.from('card_sets').delete().in('id', oldSets.data.map(item => item.id))
}
const created = await rpc(manager, 'create_card_set', { p_name: '자동 카드 세트', p_description: '자동 테스트', p_space_id: space.id })
const cardSet = Array.isArray(created.data) ? created.data[0] : created.data
if (!/^[0-9a-f-]{36}$/.test(cardSet?.id ?? '')) throw new Error(`카드 세트 RPC 반환값 오류: ${JSON.stringify(cardSet)}`)
const designs = await manager.from('card_designs').select('id,fruit_type,fruit_count,quantity,design').eq('card_set_id', cardSet.id).order('fruit_type').order('fruit_count')
if (designs.error || designs.data.length !== 20) throw designs.error ?? new Error('초안 디자인 복제 실패')
const edited = await manager.from('card_designs').update({ label: '자동 딸기', design: { background: '#fff0f2', accent: '#d70020', render: 'builtin' } }).eq('id', designs.data[0].id)
if (edited.error) throw edited.error
const outsiderDraft = await outsider.from('card_sets').select('id').eq('id', cardSet.id)
if (outsiderDraft.error || outsiderDraft.data.length !== 0) throw outsiderDraft.error ?? new Error('초안 카드가 외부 사용자에게 노출됨')

const png = new Uint8Array([137,80,78,71,13,10,26,10,0,0,0,13,73,72,68,82,0,0,0,1,0,0,0,1,8,6,0,0,0,31,21,196,137,0,0,0,13,73,68,65,84,8,215,99,248,207,192,240,31,0,5,0,1,255,137,153,61,29,0,0,0,0,73,69,78,68,174,66,96,130])
const suspendedAssetPath = `${cardSet.id}/suspended-${Date.now()}.png`
const managerUserId = users.get(identities[0].email).id
const suspended = await admin.from('profiles').update({ suspended_until: new Date(Date.now() + 60_000).toISOString() }).eq('id', managerUserId)
if (suspended.error) throw suspended.error
try {
  const suspendedUpload = await manager.storage.from('card-assets').upload(suspendedAssetPath, png, { contentType: 'image/png' })
  if (!suspendedUpload.error) {
    await admin.storage.from('card-assets').remove([suspendedAssetPath])
    throw new Error('정지 전에 발급된 세션으로 카드 파일 업로드가 허용됨')
  }
} finally {
  const restored = await admin.from('profiles').update({ suspended_until: null }).eq('id', managerUserId)
  if (restored.error) throw restored.error
}
const restoredUpload = await manager.storage.from('card-assets').upload(suspendedAssetPath, png, { contentType: 'image/png' })
if (restoredUpload.error) throw new Error(`정지 해제 후 기존 세션의 카드 업로드 복구 실패: ${restoredUpload.error.message}`)
const restoredCleanup = await manager.storage.from('card-assets').remove([suspendedAssetPath])
if (restoredCleanup.error) throw restoredCleanup.error
const assetPath = `${cardSet.id}/test-${Date.now()}.png`
const upload = await manager.storage.from('card-assets').upload(assetPath, png, { contentType: 'image/png' })
if (upload.error) throw upload.error
const badUpload = await manager.storage.from('card-assets').upload(`${cardSet.id}/bad-${Date.now()}.txt`, new TextEncoder().encode('bad'), { contentType: 'text/plain' })
if (!badUpload.error) throw new Error('허용되지 않은 카드 파일 형식 업로드됨')
await manager.from('card_sets').update({ back_asset_path: assetPath }).eq('id', cardSet.id)

await rpc(manager, 'publish_card_set', { p_card_set_id: cardSet.id })
let published = await admin.from('card_sets').select('status,version').eq('id', cardSet.id).single()
if (published.error || published.data.status !== 'published' || published.data.version !== 1) throw published.error ?? new Error('v1 게시 실패')
await rpc(manager, 'unpublish_card_set', { p_card_set_id: cardSet.id })
await manager.from('card_designs').update({ quantity: 4 }).eq('id', designs.data[0].id)
await rpc(manager, 'publish_card_set', { p_card_set_id: cardSet.id })
published = await admin.from('card_sets').select('status,version').eq('id', cardSet.id).single()
const versions = await admin.from('card_set_versions').select('version').eq('card_set_id', cardSet.id).order('version')
if (published.data.version !== 2 || versions.data?.map(item => item.version).join(',') !== '1,2') throw new Error('v2 버전 스냅샷 실패')

const clone = await rpc(manager, 'clone_card_set', { p_source_id: cardSet.id, p_name: '자동 카드 복사본', p_space_id: space.id })
const cloneSet = Array.isArray(clone.data) ? clone.data[0] : clone.data
await deleteSet(cloneSet.id)
if ((await admin.from('card_sets').select('id').eq('id', cloneSet.id)).data.length) throw new Error('복제 카드 삭제 실패')

const room = await rpc(member, 'create_space_room', { p_space_id: space.id, p_max_players: 2, p_card_set_id: cardSet.id })
const roomValue = Array.isArray(room.data) ? room.data[0] : room.data
await rpc(member, 'set_room_card_set', { p_room_id: roomValue.id, p_card_set_id: cardSet.id })
await deleteSet(cardSet.id, false)
await admin.from('rooms').delete().eq('id', roomValue.id)
await rpc(manager, 'unpublish_card_set', { p_card_set_id: cardSet.id })
const deletedSet = await deleteSet(cardSet.id)
if (deletedSet.data?.storageCleanupPending || deletedSet.data?.removedAssets !== 1) throw new Error('카드 세트 Storage 정리가 완료되지 않았습니다.')
const remainingAssets = await admin.storage.from('card-assets').list(cardSet.id, { limit: 100 })
if (remainingAssets.error || remainingAssets.data.some(item => item.id)) throw remainingAssets.error ?? new Error('삭제된 카드 세트 파일이 Storage에 남았습니다.')

console.log('verified active-manager storage enforcement, default 56-card set, draft isolation, image validation, v1/v2 publishing, cloning, deletion, room selection, and in-use protection')
