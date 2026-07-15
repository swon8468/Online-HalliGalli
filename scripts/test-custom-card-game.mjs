import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { createClient } from '@supabase/supabase-js'

const parseEnv = source => Object.fromEntries(source.split(/\r?\n/).flatMap(line => { const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/); return match ? [[match[1], match[2].replace(/^(['"])(.*)\1$/, '$2')]] : [] }))
const env = parseEnv(await readFile('.env.development', 'utf8'))
const url = env.VITE_SUPABASE_URL, anon = env.VITE_SUPABASE_ANON_KEY
const keyResponse = await fetch(`https://api.supabase.com/v1/projects/${new URL(url).hostname.split('.')[0]}/api-keys?reveal=true`, { headers: { Authorization: `Bearer ${env.SUPABASE_ACCESS_TOKEN}` } })
if (!keyResponse.ok) throw new Error('개발 프로젝트 키 조회 실패')
const service = (await keyResponse.json()).find(key => key.name === 'service_role')?.api_key
const admin = createClient(url, service, { auth: { persistSession: false, autoRefreshToken: false } })
const password = `Custom-${createHash('sha256').update(env.SUPABASE_ACCESS_TOKEN).digest('hex').slice(0, 18)}!`
const identities = [
  { email: 'custom-game-host@swonport.kr', nickname: '커스텀방장' },
  { email: 'custom-game-player@swonport.kr', nickname: '커스텀참가자' },
]

const listed = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 })
if (listed.error) throw listed.error
const users = new Map()
for (const identity of identities) {
  const existing = listed.data.users.find(user => user.email === identity.email)
  const result = existing
    ? await admin.auth.admin.updateUserById(existing.id, { password, email_confirm: true, ban_duration: 'none', user_metadata: { nickname: identity.nickname } })
    : await admin.auth.admin.createUser({ email: identity.email, password, email_confirm: true, user_metadata: { nickname: identity.nickname } })
  if (result.error || !result.data.user) throw result.error ?? new Error('테스트 계정 생성 실패')
  users.set(identity.email, result.data.user)
  const profile = await admin.from('profiles').update({ nickname: identity.nickname, deleted_at: null, suspended_until: null }).eq('id', result.data.user.id)
  if (profile.error) throw profile.error
}

const space = (await admin.from('spaces').select('id').eq('slug', 'automation-organization').single()).data
if (!space) throw new Error('스페이스 테스트를 먼저 실행해 주세요.')
await admin.from('spaces').update({ status: 'active' }).eq('id', space.id)
await admin.from('space_members').upsert([
  { space_id: space.id, user_id: users.get(identities[0].email).id, role: 'manager' },
  { space_id: space.id, user_id: users.get(identities[1].email).id, role: 'member' },
], { onConflict: 'space_id,user_id' })

const oldSets = await admin.from('card_sets').select('id').eq('space_id', space.id).eq('name', '엔진 카드 자동테스트')
if (oldSets.data?.length) {
  await admin.from('rooms').delete().in('card_set_id', oldSets.data.map(item => item.id))
  await admin.from('card_sets').delete().in('id', oldSets.data.map(item => item.id))
}

async function signed(email) {
  const client = createClient(url, anon, { auth: { persistSession: false, autoRefreshToken: false } })
  const result = await client.auth.signInWithPassword({ email, password })
  if (result.error) throw result.error
  return client
}
async function rpc(client, name, args) {
  const result = await client.rpc(name, args)
  if (result.error) throw result.error
  return Array.isArray(result.data) ? result.data[0] : result.data
}

const host = await signed(identities[0].email)
const player = await signed(identities[1].email)
const cardSet = await rpc(host, 'create_card_set', { p_name: '엔진 카드 자동테스트', p_description: '버전 고정 통합 테스트', p_space_id: space.id })
const firstDesign = await host.from('card_designs').select('id').eq('card_set_id', cardSet.id).eq('fruit_type', 'strawberry').eq('fruit_count', 1).single()
if (firstDesign.error) throw firstDesign.error
const editV1 = await host.from('card_designs').update({ quantity: 7, label: '버전1 딸기', front_asset_path: `${cardSet.id}/missing-v1.png`, design: { background: '#ffe8ee', accent: '#c50028', render: 'builtin' } }).eq('id', firstDesign.data.id)
if (editV1.error) throw editV1.error
await rpc(host, 'publish_card_set', { p_card_set_id: cardSet.id })

const room = await rpc(host, 'create_space_room', { p_space_id: space.id, p_max_players: 2, p_card_set_id: cardSet.id })
await rpc(player, 'join_private_room', { p_code: room.code })
await rpc(player, 'set_room_ready', { p_room_id: room.id, p_ready: true })
const gameId = await rpc(host, 'start_room_game', { p_room_id: room.id })
const gameV1 = await admin.from('games').select('card_set_id,card_set_version,card_set_snapshot,shuffle_metadata').eq('id', gameId).single()
const cardsV1 = await admin.from('game_cards').select('id,holder_id,pile_order,fruit,fruit_count', { count: 'exact' }).eq('game_id', gameId)
if (gameV1.error || gameV1.data.card_set_id !== cardSet.id || gameV1.data.card_set_version !== 1 || cardsV1.count !== 58) throw gameV1.error ?? new Error('커스텀 v1 덱 생성 실패')
if (gameV1.data.shuffle_metadata?.policy !== 'constrained-rounds-v1' || gameV1.data.shuffle_metadata?.usedFallback !== false) throw new Error('커스텀 덱이 공용 제한 셔플 정책을 사용하지 않았습니다.')
if (new Set(cardsV1.data.map(card => card.id)).size !== 58) throw new Error('커스텀 덱 물리 cardId 중복')
for (const holderId of new Set(cardsV1.data.map(card => card.holder_id))) {
  const pile = cardsV1.data.filter(card => card.holder_id === holderId).sort((left, right) => left.pile_order - right.pile_order)
  for (let index = 1; index < pile.length; index += 1) {
    if (pile[index - 1].fruit === pile[index].fruit && pile[index - 1].fruit_count === pile[index].fruit_count) throw new Error('커스텀 덱 연속 동일 앞면 제한 실패')
  }
}
const v1Design = gameV1.data.card_set_snapshot.designs.find(item => item.fruit_type === 'strawberry' && item.fruit_count === 1)
if (v1Design?.label !== '버전1 딸기' || v1Design?.front_asset_path !== `${cardSet.id}/missing-v1.png`) throw new Error('게임 카드 디자인 스냅샷 실패')

await rpc(host, 'unpublish_card_set', { p_card_set_id: cardSet.id })
const editV2 = await host.from('card_designs').update({ quantity: 1, label: '버전2 딸기', front_asset_path: null }).eq('id', firstDesign.data.id)
if (editV2.error) throw editV2.error
await rpc(host, 'publish_card_set', { p_card_set_id: cardSet.id })
const preserved = await admin.from('games').select('card_set_version,card_set_snapshot').eq('id', gameId).single()
if (preserved.data.card_set_version !== 1 || preserved.data.card_set_snapshot.designs.find(item => item.fruit_type === 'strawberry' && item.fruit_count === 1)?.label !== '버전1 딸기') throw new Error('진행 중 게임 버전이 변경됨')

const eliminatePlayer = await admin.from('game_players').update({ eliminated_at: new Date().toISOString() }).eq('game_id', gameId).eq('user_id', users.get(identities[1].email).id)
if (eliminatePlayer.error) throw eliminatePlayer.error
const finished = await admin.from('games').update({ finished_at: new Date().toISOString(), state: { phase: 'finished', round: 1, winnerId: users.get(identities[0].email).id } }).eq('id', gameId).select('id,finished_at').single()
if (finished.error || !finished.data.finished_at) throw finished.error ?? new Error('테스트 게임 종료 상태 저장 실패')
await rpc(host, 'request_game_rematch', { p_game_id: gameId })
const rematch = await rpc(player, 'request_game_rematch', { p_game_id: gameId })
if (!rematch.ready || !rematch.gameId) throw new Error('재경기 생성 실패')
const rematchGame = await admin.from('games').select('card_set_id,card_set_version,card_set_snapshot').eq('id', rematch.gameId).single()
const rematchCards = await admin.from('game_cards').select('id', { count: 'exact', head: true }).eq('game_id', rematch.gameId)
if (rematchGame.data.card_set_id !== cardSet.id || rematchGame.data.card_set_version !== 1 || rematchCards.count !== 58) throw new Error('재경기가 원래 카드 버전을 유지하지 못함')

await admin.from('rooms').delete().eq('id', room.id)
await admin.from('card_sets').delete().eq('id', cardSet.id)
console.log('verified selected published card set, snapshot-driven deck, shared appearance data, v1 preservation after v2 publish, missing-image fallback metadata, and rematch version pinning')
