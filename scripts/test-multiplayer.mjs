import { createHash, randomUUID } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import { createClient } from '@supabase/supabase-js'

const parseEnv = source => Object.fromEntries(source.split(/\r?\n/).flatMap(line => {
  const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/)
  return match ? [[match[1], match[2].replace(/^(['"])(.*)\1$/, '$2')]] : []
}))
const env = parseEnv(await readFile('.env.development', 'utf8'))
const password = process.env.TEST_USER_PASSWORD ?? `Multi-${createHash('sha256').update(env.SUPABASE_ACCESS_TOKEN).digest('hex').slice(0, 18)}!`
const localEnv = process.env.TEST_LOCAL === '1'
  ? parseEnv(execFileSync('npx', ['supabase', 'status', '-o', 'env'], { encoding: 'utf8' }))
  : {}
const testUrl = process.env.TEST_SUPABASE_URL || localEnv.API_URL || env.VITE_SUPABASE_URL
const testAnonKey = process.env.TEST_SUPABASE_ANON_KEY || localEnv.ANON_KEY || env.VITE_SUPABASE_ANON_KEY
let serviceRoleKey = process.env.TEST_SUPABASE_SERVICE_ROLE_KEY || localEnv.SERVICE_ROLE_KEY || ''
if (!serviceRoleKey) {
  const projectRef = new URL(testUrl).hostname.split('.')[0]
  const response = await fetch(`https://api.supabase.com/v1/projects/${projectRef}/api-keys?reveal=true`, {
    headers: { Authorization: `Bearer ${env.SUPABASE_ACCESS_TOKEN}` },
  })
  if (!response.ok) throw new Error(`개발 프로젝트 API 키 조회 실패 (${response.status})`)
  const keys = await response.json()
  const serviceRole = keys.find(key => key.name === 'service_role')
  serviceRoleKey = serviceRole?.api_key ?? serviceRole?.value
}
if (!testUrl || !testAnonKey || !serviceRoleKey) throw new Error('테스트 Supabase 설정이 필요합니다.')

const admin = createClient(testUrl, serviceRoleKey, { auth: { persistSession: false, autoRefreshToken: false } })
const makeClient = () => createClient(testUrl, testAnonKey, { auth: { persistSession: false, autoRefreshToken: false } })
const accounts = Array.from({ length: 6 }, (_, index) => ({
  email: `multi${index + 1}@swonport.kr`,
  nickname: index === 5 ? '아주긴닉네임테스트플레이어육번' : `멀티${index + 1}`,
}))

if (process.env.TEST_CREATE_USERS === '1' || !process.env.TEST_USER_PASSWORD) {
  const listed = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 })
  if (listed.error) throw listed.error
  for (const account of accounts) {
    const existing = listed.data.users.find(user => user.email?.toLowerCase() === account.email)
    const result = existing
      ? await admin.auth.admin.updateUserById(existing.id, { password, email_confirm: true, user_metadata: { nickname: account.nickname } })
      : await admin.auth.admin.createUser({ email: account.email, password, email_confirm: true, user_metadata: { nickname: account.nickname } })
    if (result.error) throw result.error
  }
}

const clients = []
const userIds = []
for (const account of accounts) {
  const client = makeClient()
  const signed = await client.auth.signInWithPassword({ email: account.email, password })
  if (signed.error) throw signed.error
  clients.push(client)
  userIds.push(signed.data.user.id)
}
const clientById = new Map(userIds.map((id, index) => [id, clients[index]]))

const rpc = async (client, name, parameters) => {
  const result = await client.rpc(name, parameters)
  if (result.error) throw result.error
  return result.data
}
const loadGame = async gameId => {
  const [game, players] = await Promise.all([
    admin.from('games').select('state,current_turn,version,finished_at').eq('id', gameId).single(),
    admin.from('game_players').select('user_id,seat,card_count,eliminated_at,abandoned_at,wrong_rings,cards_paid,correct_rings,cards_won').eq('game_id', gameId).order('seat'),
  ])
  if (game.error || players.error) throw game.error ?? players.error
  return { game: game.data, players: players.data }
}
const createGame = async playerCount => {
  const created = await rpc(clients[0], 'create_private_room', { p_max_players: playerCount })
  const room = Array.isArray(created) ? created[0] : created
  for (let index = 1; index < playerCount; index += 1) {
    await rpc(clients[index], 'join_private_room', { p_code: room.code })
    await rpc(clients[index], 'set_room_ready', { p_room_id: room.id, p_ready: true })
  }
  const gameId = await rpc(clients[0], 'start_room_game', { p_room_id: room.id })
  return { room, gameId }
}

for (const playerCount of [3, 4, 5, 6]) {
  const { gameId } = await createGame(playerCount)
  let view = await loadGame(gameId)
  const counts = view.players.map(player => player.card_count)
  if (view.players.length !== playerCount || counts.reduce((sum, count) => sum + count, 0) !== 56 || Math.max(...counts) - Math.min(...counts) > 1) {
    throw new Error(`${playerCount}인 카드 분배 실패: ${counts.join('/')}`)
  }
  const expectedTurns = [...view.players.map(player => player.user_id), ...view.players.map(player => player.user_id)]
  const actualTurns = []
  for (let turn = 0; turn < playerCount * 2; turn += 1) {
    view = await loadGame(gameId)
    actualTurns.push(view.game.current_turn)
    await rpc(clientById.get(view.game.current_turn), 'reveal_game_card', { p_game_id: gameId, p_action_id: randomUUID() })
  }
  if (actualTurns.some((id, index) => id !== expectedTurns[index])) {
    throw new Error(`${playerCount}인 턴 순환 실패`)
  }
  view = await loadGame(gameId)
  if (view.game.state.table.length !== playerCount) throw new Error(`${playerCount}인 공개 카드 집계 실패`)
}

// A current player with exactly one penalty card per opponent is eliminated by
// a wrong bell. The server must immediately hand the turn to the next player.
const penaltyFixture = await createGame(3)
let penaltyView = await loadGame(penaltyFixture.gameId)
const penaltyActor = penaltyView.players[0]
const penaltyRecipients = penaltyView.players.slice(1)
const actorCards = await admin.from('game_cards').select('id').eq('game_id', penaltyFixture.gameId).eq('holder_id', penaltyActor.user_id).eq('zone', 'draw').order('pile_order')
if (actorCards.error) throw actorCards.error
const penaltyRecipientPile = await admin.from('game_cards').select('pile_order').eq('game_id', penaltyFixture.gameId).eq('holder_id', penaltyRecipients[0].user_id).eq('zone', 'draw').order('pile_order', { ascending: false }).limit(1).maybeSingle()
if (penaltyRecipientPile.error) throw penaltyRecipientPile.error
for (const [index, card] of actorCards.data.slice(2).entries()) {
  const moved = await admin.from('game_cards').update({ holder_id: penaltyRecipients[0].user_id, pile_order: (penaltyRecipientPile.data?.pile_order ?? 0) + index + 1 }).eq('id', card.id)
  if (moved.error) throw moved.error
}
const setActorCount = await admin.from('game_players').update({ card_count: 2 }).eq('game_id', penaltyFixture.gameId).eq('user_id', penaltyActor.user_id)
const setPenaltyState = await admin.from('games').update({
  current_turn: penaltyActor.user_id,
  state: { ...penaltyView.game.state, bellActive: false, table: [], fruitTotals: { strawberry: 0, banana: 0, lime: 0, plum: 0 } },
}).eq('id', penaltyFixture.gameId)
if (setActorCount.error || setPenaltyState.error) throw setActorCount.error ?? setPenaltyState.error
const penaltyCardsBefore = await admin.from('game_cards').select('holder_id').eq('game_id', penaltyFixture.gameId).eq('zone', 'draw')
if (penaltyCardsBefore.error) throw penaltyCardsBefore.error
const penaltyCountsBefore = new Map(penaltyCardsBefore.data.map(card => card.holder_id).map((holderId, _, cards) => [
  holderId,
  cards.filter(cardHolderId => cardHolderId === holderId).length,
]))
const wrongRing = await rpc(clientById.get(penaltyActor.user_id), 'attempt_ring', { p_game_id: penaltyFixture.gameId, p_action_id: randomUUID() })
if (wrongRing.correct !== false) throw new Error('3인 오답 종 판정 실패')
penaltyView = await loadGame(penaltyFixture.gameId)
const eliminatedActor = penaltyView.players.find(player => player.user_id === penaltyActor.user_id)
if (!eliminatedActor?.eliminated_at || eliminatedActor.card_count !== 0 || penaltyView.game.current_turn !== penaltyRecipients[0].user_id) {
  throw new Error('오답 탈락 후 다음 턴 이동 실패')
}
if (penaltyRecipients.some(recipient => penaltyView.players.find(player => player.user_id === recipient.user_id)?.card_count !== (penaltyCountsBefore.get(recipient.user_id) ?? 0) + 1)) {
  throw new Error(`3인 오답 카드 분배 실패: before=${JSON.stringify(Object.fromEntries(penaltyCountsBefore))}, after=${penaltyView.players.map(player => `${player.seat}:${player.card_count}`).join('/')}`)
}
const eliminatedRing = await clientById.get(penaltyActor.user_id).rpc('attempt_ring', { p_game_id: penaltyFixture.gameId, p_action_id: randomUUID() })
if (!eliminatedRing.error?.message.includes('player eliminated')) throw new Error('탈락 플레이어 종 입력 차단 실패')
await rpc(clientById.get(penaltyRecipients[0].user_id), 'reveal_game_card', { p_game_id: penaltyFixture.gameId, p_action_id: randomUUID() })

// A middle seat with no cards is skipped, including when that seat belongs to
// a normal participant while the room host remains active.
const skipFixture = await createGame(6)
let skipView = await loadGame(skipFixture.gameId)
const beforeMiddle = skipView.players[1]
const middle = skipView.players[2]
const afterMiddle = skipView.players[3]
const middleCards = await admin.from('game_cards').select('id').eq('game_id', skipFixture.gameId).eq('holder_id', middle.user_id)
if (middleCards.error) throw middleCards.error
const afterMiddlePile = await admin.from('game_cards').select('pile_order').eq('game_id', skipFixture.gameId).eq('holder_id', afterMiddle.user_id).eq('zone', 'draw').order('pile_order', { ascending: false }).limit(1).maybeSingle()
if (afterMiddlePile.error) throw afterMiddlePile.error
for (const [index, card] of middleCards.data.entries()) {
  const moved = await admin.from('game_cards').update({ holder_id: afterMiddle.user_id, zone: 'draw', pile_order: (afterMiddlePile.data?.pile_order ?? 0) + index + 1 }).eq('id', card.id)
  if (moved.error) throw moved.error
}
const eliminateMiddle = await admin.from('game_players').update({ card_count: 0, eliminated_at: new Date().toISOString() }).eq('game_id', skipFixture.gameId).eq('user_id', middle.user_id)
const forceBeforeMiddle = await admin.from('games').update({ current_turn: beforeMiddle.user_id }).eq('id', skipFixture.gameId)
if (eliminateMiddle.error || forceBeforeMiddle.error) throw eliminateMiddle.error ?? forceBeforeMiddle.error
await rpc(clientById.get(beforeMiddle.user_id), 'reveal_game_card', { p_game_id: skipFixture.gameId, p_action_id: randomUUID() })
skipView = await loadGame(skipFixture.gameId)
if (skipView.game.current_turn !== afterMiddle.user_id) throw new Error('6인 중간 탈락 플레이어 턴 건너뛰기 실패')
const eliminatedReveal = await clientById.get(middle.user_id).rpc('reveal_game_card', { p_game_id: skipFixture.gameId, p_action_id: randomUUID() })
if (!eliminatedReveal.error?.message.includes('player eliminated')) throw new Error('탈락 플레이어 카드 공개 차단 실패')

// Four visible top cards form an exact five. All clients ring concurrently;
// exactly one receives every face-up card.
const bellFixture = await createGame(4)
let bellView = await loadGame(bellFixture.gameId)
for (let turn = 0; turn < 3; turn += 1) {
  bellView = await loadGame(bellFixture.gameId)
  await rpc(clientById.get(bellView.game.current_turn), 'reveal_game_card', { p_game_id: bellFixture.gameId, p_action_id: randomUUID() })
}
bellView = await loadGame(bellFixture.gameId)
const nextUser = bellView.game.current_turn
const topCards = await admin.from('game_cards').select('id,holder_id,pile_order').eq('game_id', bellFixture.gameId).eq('zone', 'face_up').order('pile_order')
const nextDraw = await admin.from('game_cards').select('id').eq('game_id', bellFixture.gameId).eq('holder_id', nextUser).eq('zone', 'draw').order('pile_order').limit(1).single()
if (topCards.error || nextDraw.error || topCards.data.length !== 3) throw topCards.error ?? nextDraw.error ?? new Error('4인 공개 카드 준비 실패')
const exactValues = [
  { fruit: 'strawberry', fruit_count: 2 },
  { fruit: 'strawberry', fruit_count: 3 },
  { fruit: 'banana', fruit_count: 1 },
]
for (let index = 0; index < topCards.data.length; index += 1) {
  const updated = await admin.from('game_cards').update(exactValues[index]).eq('id', topCards.data[index].id)
  if (updated.error) throw updated.error
}
const setNextCard = await admin.from('game_cards').update({ fruit: 'lime', fruit_count: 1 }).eq('id', nextDraw.data.id)
if (setNextCard.error) throw setNextCard.error
await rpc(clientById.get(nextUser), 'reveal_game_card', { p_game_id: bellFixture.gameId, p_action_id: randomUUID() })
bellView = await loadGame(bellFixture.gameId)
if (!bellView.game.state.bellActive || bellView.game.state.table.length !== 4 || bellView.game.state.fruitTotals.strawberry !== 5) {
  throw new Error('4인 공개 카드 합계 5 서버 판정 실패')
}
const simultaneous = await Promise.all(bellView.players.map(player => clientById.get(player.user_id).rpc('attempt_ring', {
  p_game_id: bellFixture.gameId,
  p_action_id: randomUUID(),
})))
if (simultaneous.some(result => result.error)) throw simultaneous.find(result => result.error).error
const accepted = simultaneous.filter(result => result.data?.accepted && result.data?.correct)
const rejected = simultaneous.filter(result => result.data?.accepted === false && result.data?.reason === 'already_rung')
if (accepted.length !== 1 || rejected.length !== 3) throw new Error('4인 동시 종 단일 승자 판정 실패')
const remainingFaceCards = await admin.from('game_cards').select('id', { count: 'exact', head: true }).eq('game_id', bellFixture.gameId).eq('zone', 'face_up')
if (remainingFaceCards.error || remainingFaceCards.count !== 0) throw remainingFaceCards.error ?? new Error('여러 플레이어 공개 카드 획득 실패')

console.log('verified multiplayer games for 3, 4, 5, and 6 players')
console.log('distribution, turn cycles, permanent elimination, skipped seats, multi-card exact-five, penalties, and simultaneous bell passed')
