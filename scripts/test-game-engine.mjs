import { readFile } from 'node:fs/promises'
import { createClient } from '@supabase/supabase-js'

const parseEnv = source => Object.fromEntries(source.split(/\r?\n/).flatMap(line => {
  const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/)
  return match ? [[match[1], match[2].replace(/^(['"])(.*)\1$/, '$2')]] : []
}))
const env = parseEnv(await readFile('.env.development', 'utf8'))
const password = process.env.TEST_USER_PASSWORD
if (!password) throw new Error('TEST_USER_PASSWORD가 필요합니다.')

const makeClient = () => createClient(env.VITE_SUPABASE_URL, env.VITE_SUPABASE_ANON_KEY, { auth: { persistSession: false, autoRefreshToken: false } })
const user1 = makeClient()
const user2 = makeClient()
const first = await user1.auth.signInWithPassword({ email: 'user1@swonport.kr', password })
const second = await user2.auth.signInWithPassword({ email: 'user2@swonport.kr', password })
if (first.error || second.error) throw first.error ?? second.error
const user1Id = first.data.user.id
const user2Id = second.data.user.id
const clients = new Map([[user1Id, user1], [user2Id, user2]])

const created = await user1.rpc('create_private_room', { p_max_players: 2 })
if (created.error) throw created.error
const room = Array.isArray(created.data) ? created.data[0] : created.data
const joined = await user2.rpc('join_private_room', { p_code: room.code })
if (joined.error) throw joined.error
const started = await user1.rpc('start_room_game', { p_room_id: room.id })
if (started.error) throw started.error
const gameId = started.data

const loadView = async () => {
  const [gameResult, playersResult] = await Promise.all([
    user1.from('games').select('state,current_turn,version').eq('id', gameId).single(),
    user1.from('game_players').select('user_id,card_count').eq('game_id', gameId).order('seat'),
  ])
  if (gameResult.error || playersResult.error) throw gameResult.error ?? playersResult.error
  return { game: gameResult.data, players: playersResult.data }
}

let view = await loadView()
if (view.players.length !== 2 || view.players.some(player => player.card_count !== 28)) throw new Error('56장 균등 분배 검증 실패')
const hiddenCards = await user1.from('game_cards').select('fruit').eq('game_id', gameId)
if (hiddenCards.error || hiddenCards.data.length !== 0) throw new Error('비공개 덱 노출 방지 검증 실패')

const turnClient = clients.get(view.game.current_turn)
const wrongClient = view.game.current_turn === user1Id ? user2 : user1
const rejected = await wrongClient.rpc('reveal_game_card', { p_game_id: gameId })
if (!rejected.error?.message.includes('not your turn')) throw new Error('턴 제한 검증 실패')
const firstReveal = await turnClient.rpc('reveal_game_card', { p_game_id: gameId })
if (firstReveal.error || firstReveal.data.table.length !== 1) throw firstReveal.error ?? new Error('첫 카드 공개 실패')

view = await loadView()
while (view.game.state.bellActive && view.game.state.phase === 'playing') {
  const client = clients.get(view.game.current_turn)
  const result = await client.rpc('reveal_game_card', { p_game_id: gameId })
  if (result.error) throw result.error
  view = await loadView()
}
const beforeWrong = new Map(view.players.map(player => [player.user_id, player.card_count]))
const penaltyUserId = view.game.current_turn === user1Id ? user2Id : user1Id
const penaltyClient = clients.get(penaltyUserId)
const wrongRing = await penaltyClient.rpc('attempt_ring', { p_game_id: gameId })
if (wrongRing.error || !wrongRing.data.accepted || wrongRing.data.correct !== false) throw wrongRing.error ?? new Error('오답 종 판정 실패')
const repeatedRing = await penaltyClient.rpc('attempt_ring', { p_game_id: gameId })
if (repeatedRing.error || repeatedRing.data.accepted !== false || repeatedRing.data.reason !== 'already_rung') throw repeatedRing.error ?? new Error('종 반복 잠금 검증 실패')
view = await loadView()
const penaltyAfter = view.players.find(player => player.user_id === penaltyUserId)?.card_count
if (penaltyAfter !== beforeWrong.get(penaltyUserId) - 1) throw new Error('오답 카드 지급 검증 실패')

let revealCount = 0
while (!view.game.state.bellActive && view.game.state.phase === 'playing' && revealCount < 56) {
  const client = clients.get(view.game.current_turn)
  const result = await client.rpc('reveal_game_card', { p_game_id: gameId })
  if (result.error) throw result.error
  revealCount += 1
  view = await loadView()
}
if (!view.game.state.bellActive) throw new Error('56회 안에 정답 패턴을 만들지 못했습니다.')
const faceUpCount = view.game.state.table.length
const winnerClient = user1
const correctRing = await winnerClient.rpc('attempt_ring', { p_game_id: gameId })
if (correctRing.error || !correctRing.data.correct || correctRing.data.state.table.length !== 0) throw correctRing.error ?? new Error('정답 종 판정 실패')

view = await loadView()
console.log(`verified game engine: room ${room.code}, game ${gameId}`)
console.log(`turn rejection, reveal, wrong penalty, bell lock, exact-five reward (${faceUpCount} face-up cards) passed`)
console.log(`card counts: ${view.players.map(player => player.card_count).join(' / ')}`)
