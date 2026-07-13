import { createHash, randomUUID } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import { createClient } from '@supabase/supabase-js'

const parseEnv = source => Object.fromEntries(source.split(/\r?\n/).flatMap(line => {
  const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/)
  return match ? [[match[1], match[2].replace(/^(['"])(.*)\1$/, '$2')]] : []
}))
const env = parseEnv(await readFile('.env.development', 'utf8'))
const password = process.env.TEST_USER_PASSWORD ?? `Completion-${createHash('sha256').update(env.SUPABASE_ACCESS_TOKEN).digest('hex').slice(0, 18)}!`
const localEnv = process.env.TEST_LOCAL === '1'
  ? parseEnv(execFileSync('npx', ['supabase', 'status', '-o', 'env'], { encoding: 'utf8' }))
  : {}
const testUrl = process.env.TEST_SUPABASE_URL || localEnv.API_URL || env.VITE_SUPABASE_URL
const testAnonKey = process.env.TEST_SUPABASE_ANON_KEY || localEnv.ANON_KEY || env.VITE_SUPABASE_ANON_KEY
let serviceRoleKey = process.env.TEST_SUPABASE_SERVICE_ROLE_KEY || localEnv.SERVICE_ROLE_KEY || ''

const makeClient = () => createClient(testUrl, testAnonKey, {
  auth: { persistSession: false, autoRefreshToken: false },
})
if (!serviceRoleKey) {
  const accessToken = env.SUPABASE_ACCESS_TOKEN
  if (!accessToken) throw new Error('개발 환경 SUPABASE_ACCESS_TOKEN이 필요합니다.')
  const projectRef = new URL(testUrl).hostname.split('.')[0]
  const keysResponse = await fetch(`https://api.supabase.com/v1/projects/${projectRef}/api-keys?reveal=true`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  })
  if (!keysResponse.ok) throw new Error(`개발 프로젝트 API 키 조회 실패 (${keysResponse.status})`)
  const keys = await keysResponse.json()
  const serviceRole = keys.find(key => key.name === 'service_role')
  serviceRoleKey = serviceRole?.api_key ?? serviceRole?.value
  if (!serviceRoleKey) throw new Error('개발 프로젝트 service_role 키를 찾지 못했습니다.')
}
const admin = createClient(testUrl, serviceRoleKey, {
  auth: { persistSession: false, autoRefreshToken: false },
})

if (process.env.TEST_CREATE_USERS === '1' || !process.env.TEST_USER_PASSWORD) {
  const accounts = [
    { email: 'user1@swonport.kr', nickname: '사용자1' },
    { email: 'user2@swonport.kr', nickname: '사용자2' },
  ]
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

const user1 = makeClient()
const user2 = makeClient()
const first = await user1.auth.signInWithPassword({ email: 'user1@swonport.kr', password })
const second = await user2.auth.signInWithPassword({ email: 'user2@swonport.kr', password })
if (first.error || second.error) throw first.error ?? second.error
const user1Id = first.data.user.id
const user2Id = second.data.user.id

const createGame = async () => {
  const created = await user1.rpc('create_private_room', { p_max_players: 2 })
  if (created.error) throw created.error
  const room = Array.isArray(created.data) ? created.data[0] : created.data
  const joined = await user2.rpc('join_private_room', { p_code: room.code })
  if (joined.error) throw joined.error
  const ready = await user2.rpc('set_room_ready', { p_room_id: room.id, p_ready: true })
  if (ready.error) throw ready.error
  const started = await user1.rpc('start_room_game', { p_room_id: room.id })
  if (started.error) throw started.error
  return { room, gameId: started.data }
}

const loadGame = async gameId => {
  const result = await admin.from('games').select('state,current_turn,version,finished_at').eq('id', gameId).single()
  if (result.error) throw result.error
  return result.data
}

const { room, gameId } = await createGame()
let game = await loadGame(gameId)
const turnClient = game.current_turn === user1Id ? user1 : user2
const actionId = randomUUID()
const firstReveal = await turnClient.rpc('reveal_game_card', { p_game_id: gameId, p_action_id: actionId })
if (firstReveal.error) throw firstReveal.error
const duplicateReveal = await turnClient.rpc('reveal_game_card', { p_game_id: gameId, p_action_id: actionId })
if (duplicateReveal.error) throw duplicateReveal.error
game = await loadGame(gameId)
if (game.version !== 1) throw new Error(`멱등 공개 실패: version=${game.version}`)

// Even with different action IDs, two near-simultaneous requests from the
// current player may advance the turn only once.
const nextTurnClient = game.current_turn === user1Id ? user1 : user2
const racingReveals = await Promise.all([
  nextTurnClient.rpc('reveal_game_card', { p_game_id: gameId, p_action_id: randomUUID() }),
  nextTurnClient.rpc('reveal_game_card', { p_game_id: gameId, p_action_id: randomUUID() }),
])
if (racingReveals.filter(result => !result.error).length !== 1 || racingReveals.filter(result => result.error).length !== 1) {
  throw new Error('느린 네트워크 중복 턴 방지 실패')
}
game = await loadGame(gameId)
if (game.version !== 2) throw new Error(`경쟁 공개 후 version 오류: ${game.version}`)

const cards = await admin.from('game_cards').select('id').eq('game_id', gameId).order('id')
if (cards.error || cards.data.length !== 56) throw cards.error ?? new Error('테스트 덱 조회 실패')

// Two clients race for the same exact-five bell window. The row lock and
// round-version marker must accept exactly one request.
const exactFiveA = await admin.from('game_cards').update({ holder_id: user1Id, zone: 'face_up', pile_order: 100, fruit: 'strawberry', fruit_count: 2 }).eq('id', cards.data[0].id)
const exactFiveB = await admin.from('game_cards').update({ holder_id: user2Id, zone: 'face_up', pile_order: 101, fruit: 'strawberry', fruit_count: 3 }).eq('id', cards.data[1].id)
const bellWindow = await admin.from('games').update({ state: { phase: 'playing', bellActive: true }, version: 2 }).eq('id', gameId)
if (exactFiveA.error || exactFiveB.error || bellWindow.error) throw exactFiveA.error ?? exactFiveB.error ?? bellWindow.error
const simultaneous = await Promise.all([
  user1.rpc('attempt_ring', { p_game_id: gameId, p_action_id: randomUUID() }),
  user2.rpc('attempt_ring', { p_game_id: gameId, p_action_id: randomUUID() }),
])
if (simultaneous.some(result => result.error)) throw simultaneous.find(result => result.error).error
const acceptedRings = simultaneous.filter(result => result.data?.accepted && result.data?.correct)
const rejectedRings = simultaneous.filter(result => result.data?.accepted === false && result.data?.reason === 'already_rung')
if (acceptedRings.length !== 1 || rejectedRings.length !== 1) throw new Error('동시 종 서버 단일 승자 판정 실패')

// A repeated wrong-ring action ID must charge the penalty only once.
const wrongWindow = await admin.from('games').update({ state: { phase: 'playing', bellActive: false }, version: 4 }).eq('id', gameId)
if (wrongWindow.error) throw wrongWindow.error
const wrongActionId = randomUUID()
const wrongFirst = await user1.rpc('attempt_ring', { p_game_id: gameId, p_action_id: wrongActionId })
const wrongDuplicate = await user1.rpc('attempt_ring', { p_game_id: gameId, p_action_id: wrongActionId })
if (wrongFirst.error || wrongDuplicate.error) throw wrongFirst.error ?? wrongDuplicate.error
if (wrongFirst.data?.correct !== false || wrongDuplicate.data?.duplicate !== true) throw new Error('오답 종 멱등 판정 실패')
const wrongStats = await admin.from('game_players').select('wrong_rings').eq('game_id', gameId).eq('user_id', user1Id).single()
if (wrongStats.error || wrongStats.data.wrong_rings !== 1) throw wrongStats.error ?? new Error('오답 종 벌칙이 중복 적용됨')

// Force a deterministic last-card boundary with service-role test setup:
// one player owns exactly one drawable card and the other owns the remaining 55.
const resetCards = await admin.from('game_cards').update({ holder_id: user2Id, zone: 'draw' }).eq('game_id', gameId)
if (resetCards.error) throw resetCards.error
const lastCard = await admin.from('game_cards').update({ holder_id: user1Id, zone: 'draw', pile_order: 1 }).eq('id', cards.data[0].id)
if (lastCard.error) throw lastCard.error
const forceTurn = await admin.from('games').update({ current_turn: user1Id, version: 10 }).eq('id', gameId)
if (forceTurn.error) throw forceTurn.error

const finalRevealAction = randomUUID()
const finalReveal = await user1.rpc('reveal_game_card', { p_game_id: gameId, p_action_id: finalRevealAction })
if (finalReveal.error) throw finalReveal.error
game = await loadGame(gameId)
if (!game.finished_at || game.state.phase !== 'finished' || game.state.winnerId !== user2Id) {
  throw new Error('마지막 카드 종료 및 승자 판정 실패')
}
const results = game.state.playerResults
if (!Array.isArray(results) || results.length !== 2 || results.find(row => row.userId === user2Id)?.rank !== 1) {
  throw new Error('최종 순위/통계 스냅샷 실패')
}
const repeatedFinalReveal = await user1.rpc('reveal_game_card', { p_game_id: gameId, p_action_id: finalRevealAction })
if (repeatedFinalReveal.error || repeatedFinalReveal.data?.phase !== 'finished') {
  throw repeatedFinalReveal.error ?? new Error('종료 액션 멱등 재전송 실패')
}

const firstVote = await user1.rpc('request_game_rematch', { p_game_id: gameId })
if (firstVote.error || firstVote.data.ready !== false) throw firstVote.error ?? new Error('첫 재경기 투표 실패')
if (firstVote.data.state?.rematchRequestedCount !== 1 || firstVote.data.state?.playerResults?.find(row => row.userId === user1Id)?.rematchRequested !== true) {
  throw new Error('재경기 요청 스냅샷 즉시 반영 실패')
}
const secondVote = await user2.rpc('request_game_rematch', { p_game_id: gameId })
if (secondVote.error || secondVote.data.ready !== true || !secondVote.data.gameId) throw secondVote.error ?? new Error('재경기 생성 실패')
const rematchId = secondVote.data.gameId
const rematch = await loadGame(rematchId)
if (rematch.state.phase !== 'playing') throw new Error('재경기 시작 상태 실패')

const abandon = await user1.rpc('abandon_game', { p_game_id: rematchId, p_action_id: randomUUID() })
if (abandon.error || abandon.data.phase !== 'finished' || abandon.data.winnerId !== user2Id) {
  throw abandon.error ?? new Error('기권 종료 판정 실패')
}

const lobbyFixture = await createGame()
const lobbyAbandon = await user1.rpc('abandon_game', { p_game_id: lobbyFixture.gameId, p_action_id: randomUUID() })
if (lobbyAbandon.error || lobbyAbandon.data.phase !== 'finished') throw lobbyAbandon.error ?? new Error('대기방 복귀용 게임 종료 실패')
const returned = await user2.rpc('return_finished_game_to_room', { p_game_id: lobbyFixture.gameId })
if (returned.error || returned.data.status !== 'waiting') throw returned.error ?? new Error('기존 대기방 복귀 실패')
const readyAgain = await user2.rpc('set_room_ready', { p_room_id: lobbyFixture.room.id, p_ready: true })
if (readyAgain.error) throw readyAgain.error
const restarted = await user1.rpc('start_room_game', { p_room_id: lobbyFixture.room.id })
if (restarted.error || !restarted.data) throw restarted.error ?? new Error('복귀한 대기방 재시작 실패')

console.log(`verified game completion: room ${room.code}`)
console.log('idempotent reveal/ring, simultaneous bell, last-card finish, ranking, rematch, lobby return, and forfeit passed')
