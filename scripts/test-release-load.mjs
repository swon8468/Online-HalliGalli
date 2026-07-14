import { createHash, randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { performance } from 'node:perf_hooks'
import { createClient } from '@supabase/supabase-js'

const parseEnv = source => Object.fromEntries(source.split(/\r?\n/).flatMap(line => {
  const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/)
  return match ? [[match[1], match[2].replace(/^(['"])(.*)\1$/, '$2')]] : []
}))

const fileEnv = parseEnv(await readFile('.env.development', 'utf8'))
const url = process.env.TEST_SUPABASE_URL || fileEnv.VITE_SUPABASE_URL
const anon = process.env.TEST_SUPABASE_ANON_KEY || fileEnv.VITE_SUPABASE_ANON_KEY
const accessToken = process.env.SUPABASE_ACCESS_TOKEN || fileEnv.SUPABASE_ACCESS_TOKEN
if (!url || !anon || !accessToken) throw new Error('개발 Supabase 설정이 필요합니다.')

const projectRef = new URL(url).hostname.split('.')[0]
const keyResponse = await fetch(`https://api.supabase.com/v1/projects/${projectRef}/api-keys?reveal=true`, {
  headers: { Authorization: `Bearer ${accessToken}` },
})
if (!keyResponse.ok) throw new Error(`개발 프로젝트 키 조회 실패 (${keyResponse.status})`)
const serviceEntry = (await keyResponse.json()).find(key => key.name === 'service_role')
const service = serviceEntry?.api_key ?? serviceEntry?.value
if (!service) throw new Error('개발 service role 키를 찾지 못했습니다.')

const admin = createClient(url, service, { auth: { persistSession: false, autoRefreshToken: false } })
const makeClient = () => createClient(url, anon, { auth: { persistSession: false, autoRefreshToken: false } })
const password = `Load-${createHash('sha256').update(accessToken).digest('hex').slice(0, 18)}!`
const runId = `${Date.now().toString(36)}-${randomUUID().slice(0, 8)}`
const accounts = Array.from({ length: 6 }, (_, index) => ({
  email: `release-load-${runId}-${index + 1}@swonport.kr`,
  nickname: `부하${index + 1}`,
}))
const createdUserIds = []
const roomIds = []
const durations = []
const clients = []
const realtimeChannels = []
const realtimeSignals = Array.from({ length: 7 }, () => 0)

const measured = async (name, operation) => {
  const start = performance.now()
  try {
    return await operation()
  } finally {
    durations.push({ name, milliseconds: performance.now() - start })
  }
}

const rpc = async (client, name, parameters) => {
  const result = await measured(name, () => client.rpc(name, parameters))
  if (result.error) throw result.error
  return result.data
}

const waitUntil = async (predicate, message, timeoutMs = 10_000) => {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (predicate()) return
    await new Promise(resolve => setTimeout(resolve, 50))
  }
  throw new Error(message)
}

const subscribeToGameUpdates = async (client, clientIndex, gameId, filtered = true) => {
  const gameChanges = {
    event: 'UPDATE',
    schema: 'public',
    table: 'games',
    ...(filtered ? { filter: `id=eq.${gameId}` } : {}),
  }
  const playerChanges = {
    event: 'UPDATE',
    schema: 'public',
    table: 'game_players',
    ...(filtered ? { filter: `game_id=eq.${gameId}` } : {}),
  }
  const channel = client
    .channel(`release-load:${runId}:${clientIndex}:${randomUUID()}`, {
      config: { broadcast: { replication_ready: true } },
    })
    .on('postgres_changes', gameChanges, () => { realtimeSignals[clientIndex] += 1 })
    .on('postgres_changes', playerChanges, () => { realtimeSignals[clientIndex] += 1 })
  realtimeChannels[clientIndex] = channel

  await new Promise((resolve, reject) => {
    let joined = false
    let replicationReady = false
    const timer = setTimeout(() => reject(new Error(`Realtime 준비 시간 초과 (client ${clientIndex + 1})`)), 15_000)
    const finishIfReady = () => {
      if (!joined || !replicationReady) return
      clearTimeout(timer)
      resolve()
    }
    channel.on('system', {}, payload => {
      if (payload.status === 'ok') {
        replicationReady = true
        finishIfReady()
      } else if (payload.status === 'error') {
        clearTimeout(timer)
        reject(new Error(`Realtime replication 준비 실패 (client ${clientIndex + 1})`))
      }
    })
    channel.subscribe(status => {
      if (status === 'SUBSCRIBED') {
        joined = true
        finishIfReady()
      } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
        clearTimeout(timer)
        reject(new Error(`Realtime 구독 실패: ${status} (client ${clientIndex + 1})`))
      }
    })
  })
}

const waitForRealtimeSignal = (clientIndex, previousCount, context) => waitUntil(
  () => realtimeSignals[clientIndex] > previousCount,
  `client ${clientIndex + 1}이 ${context} Realtime 업데이트를 받지 못했습니다.`,
)

async function deleteUserWithRetry(userId) {
  let lastError
  for (let attempt = 0; attempt < 6; attempt += 1) {
    try {
      const removed = await admin.auth.admin.deleteUser(userId)
      if (!removed.error) return
      lastError = removed.error
    } catch (error) {
      lastError = error
    }
    await new Promise(resolve => setTimeout(resolve, Math.min(400 * (2 ** attempt), 4_000)))
  }
  throw lastError ?? new Error('부하 테스트 계정 정리 실패')
}

try {
  const userIds = []
  for (const account of accounts) {
    const created = await admin.auth.admin.createUser({
      email: account.email,
      password,
      email_confirm: true,
      user_metadata: { nickname: account.nickname },
    })
    if (created.error || !created.data.user) throw created.error ?? new Error('부하 테스트 계정 생성 실패')
    createdUserIds.push(created.data.user.id)
    userIds.push(created.data.user.id)

    const client = makeClient()
    const signed = await measured('sign_in', () => client.auth.signInWithPassword({ email: account.email, password }))
    if (signed.error) throw signed.error
    clients.push(client)
  }

  const createdRoom = await rpc(clients[0], 'create_private_room', { p_max_players: 6 })
  const room = Array.isArray(createdRoom) ? createdRoom[0] : createdRoom
  roomIds.push(room.id)

  const joined = await Promise.all(clients.slice(1).map(client => rpc(client, 'join_private_room', { p_code: room.code })))
  if (joined.length !== 5) throw new Error('6인 병렬 방 참여 실패')
  await Promise.all(clients.slice(1).map(client => rpc(client, 'set_room_ready', { p_room_id: room.id, p_ready: true })))
  const gameId = await rpc(clients[0], 'start_room_game', { p_room_id: room.id })

  await Promise.all(clients.map((client, index) => subscribeToGameUpdates(client, index, gameId)))
  await subscribeToGameUpdates(admin, 6, gameId, false)

  const gameBefore = await admin.from('games').select('current_turn,version').eq('id', gameId).single()
  if (gameBefore.error) throw gameBefore.error
  const turnIndex = userIds.indexOf(gameBefore.data.current_turn)
  if (turnIndex < 0) throw new Error('현재 턴 사용자를 찾지 못했습니다.')
  const signalsBeforeDuplicate = [...realtimeSignals]

  const duplicateActionId = randomUUID()
  const duplicateReveals = await Promise.all(Array.from({ length: 12 }, () => measured(
    'duplicate_reveal',
    () => clients[turnIndex].rpc('reveal_game_card', { p_game_id: gameId, p_action_id: duplicateActionId }),
  )))
  if (duplicateReveals.some(result => result.error)) throw duplicateReveals.find(result => result.error).error

  const afterDuplicate = await admin.from('games').select('current_turn,version').eq('id', gameId).single()
  if (afterDuplicate.error || afterDuplicate.data.version !== gameBefore.data.version + 1) {
    throw afterDuplicate.error ?? new Error(`동일 액션 12회 멱등 처리 실패 (version=${afterDuplicate.data?.version})`)
  }
  await waitForRealtimeSignal(6, signalsBeforeDuplicate[6], 'service-role 진단')
  await Promise.all(clients.map((_, index) => waitForRealtimeSignal(index, signalsBeforeDuplicate[index], '중복 액션 이후')))

  // Recreate one websocket subscription before the next action. This catches
  // stale channels and verifies that a returning browser receives fresh state.
  await clients[5].removeChannel(realtimeChannels[5])
  realtimeSignals[5] = 0
  await subscribeToGameUpdates(clients[5], 5, gameId)

  const nextTurnIndex = userIds.indexOf(afterDuplicate.data.current_turn)
  const competingReveals = await Promise.all(Array.from({ length: 6 }, () => measured(
    'competing_reveal',
    () => clients[nextTurnIndex].rpc('reveal_game_card', { p_game_id: gameId, p_action_id: randomUUID() }),
  )))
  const competingSuccesses = competingReveals.filter(result => !result.error)
  if (competingSuccesses.length !== 1) throw new Error(`서로 다른 동시 턴 요청이 ${competingSuccesses.length}건 승인됐습니다.`)

  const afterCompetition = await admin.from('games').select('version').eq('id', gameId).single()
  if (afterCompetition.error || afterCompetition.data.version !== afterDuplicate.data.version + 1) {
    throw afterCompetition.error ?? new Error('동시 턴 요청 후 게임 버전 정합성 실패')
  }
  await waitForRealtimeSignal(5, 0, '재구독 이후')

  // Keep the six-player game active for several more rounds. Exact-five states
  // are collected immediately so subsequent turns exercise both reveal and
  // ring transitions without depending on a particular shuffled deck.
  const stabilityActions = 24
  const signalsBeforeStability = [...realtimeSignals]
  for (let action = 0; action < stabilityActions; action += 1) {
    const current = await admin.from('games').select('current_turn,state').eq('id', gameId).single()
    if (current.error) throw current.error
    if (current.data.state?.phase !== 'playing') throw new Error(`반복 액션 ${action + 1} 전에 게임이 종료됐습니다.`)
    if (current.data.state?.bellActive) {
      await rpc(clients[0], 'attempt_ring', { p_game_id: gameId, p_action_id: randomUUID() })
    } else {
      const actorIndex = userIds.indexOf(current.data.current_turn)
      if (actorIndex < 0) throw new Error('반복 액션의 현재 턴 사용자를 찾지 못했습니다.')
      await rpc(clients[actorIndex], 'reveal_game_card', { p_game_id: gameId, p_action_id: randomUUID() })
    }
  }

  const finalGame = await admin.from('games').select('version,state').eq('id', gameId).single()
  if (finalGame.error) throw finalGame.error
  await Promise.all(clients.map((_, index) => waitForRealtimeSignal(index, signalsBeforeStability[index], '반복 액션 이후')))

  const sorted = durations.map(item => item.milliseconds).sort((a, b) => a - b)
  const p95 = sorted[Math.max(0, Math.ceil(sorted.length * 0.95) - 1)]
  const maximum = sorted.at(-1) ?? 0
  if (maximum > 10_000) throw new Error(`개발 Supabase 단일 요청이 10초를 초과했습니다. (${Math.round(maximum)}ms)`)

  console.log(JSON.stringify({
    verified: '6-player parallel join/ready, 12 idempotent duplicates, 6 competing turns',
    realtime: `6 subscribers caught up through version ${finalGame.data.version}; client 6 resubscribed successfully`,
    stabilityActions,
    realtimeSignalsPerClient: realtimeSignals.slice(0, 6),
    adminRealtimeSignals: realtimeSignals[6],
    samples: durations.length,
    p95Milliseconds: Math.round(p95),
    maxMilliseconds: Math.round(maximum),
  }))
} finally {
  await Promise.all(realtimeChannels.map((channel, index) => (
    channel ? (index === 6 ? admin : clients[index]).removeChannel(channel) : Promise.resolve()
  )))
  if (createdUserIds.length) {
    const queues = await admin.from('matchmaking_queue').delete().in('user_id', createdUserIds)
    if (queues.error) throw queues.error
  }
  if (roomIds.length) {
    const rooms = await admin.from('rooms').delete().in('id', roomIds)
    if (rooms.error) throw rooms.error
  }
  for (const userId of createdUserIds.reverse()) await deleteUserWithRetry(userId)

  const listed = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 })
  if (listed.error) throw listed.error
  const leftovers = listed.data.users.filter(user => user.email?.startsWith(`release-load-${runId}-`))
  if (leftovers.length) throw new Error(`부하 테스트 계정 ${leftovers.length}개가 남았습니다.`)
}
