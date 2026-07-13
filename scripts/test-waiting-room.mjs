import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { createClient } from '@supabase/supabase-js'

const parseEnv = source => Object.fromEntries(source.split(/\r?\n/).flatMap(line => { const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/); return match ? [[match[1], match[2].replace(/^(['"])(.*)\1$/, '$2')]] : [] }))
const env = parseEnv(await readFile('.env.development', 'utf8'))
const password = process.env.TEST_USER_PASSWORD ?? `Waiting-${createHash('sha256').update(env.SUPABASE_ACCESS_TOKEN).digest('hex').slice(0, 18)}!`
const local = process.env.TEST_LOCAL === '1' ? parseEnv(execFileSync('npx', ['supabase', 'status', '-o', 'env'], { encoding: 'utf8' })) : {}
const url = local.API_URL || env.VITE_SUPABASE_URL, anon = local.ANON_KEY || env.VITE_SUPABASE_ANON_KEY
let service = local.SERVICE_ROLE_KEY || ''
if (!service) {
  const response = await fetch(`https://api.supabase.com/v1/projects/${new URL(url).hostname.split('.')[0]}/api-keys?reveal=true`, { headers: { Authorization: `Bearer ${env.SUPABASE_ACCESS_TOKEN}` } })
  const keys = await response.json(); service = keys.find(key => key.name === 'service_role')?.api_key
}
const admin = createClient(url, service, { auth: { persistSession: false, autoRefreshToken: false } })
const accounts = Array.from({ length: 3 }, (_, index) => ({ email: `lobby${index + 1}@swonport.kr`, nickname: `대기방${index + 1}` }))
const listed = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 })
if (listed.error) throw listed.error
for (const account of accounts) {
  const existing = listed.data.users.find(user => user.email === account.email)
  const result = existing ? await admin.auth.admin.updateUserById(existing.id, { password, email_confirm: true, ban_duration: 'none', user_metadata: { nickname: account.nickname } }) : await admin.auth.admin.createUser({ email: account.email, password, email_confirm: true, user_metadata: { nickname: account.nickname } })
  if (result.error) throw result.error
  await admin.from('profiles').update({ deleted_at: null, suspended_until: null, suspension_reason: null }).eq('id', result.data.user.id)
}
const clients = [], ids = []
for (const account of accounts) { const client = createClient(url, anon, { auth: { persistSession: false, autoRefreshToken: false } }); const signed = await client.auth.signInWithPassword({ email: account.email, password }); if (signed.error) throw signed.error; clients.push(client); ids.push(signed.data.user.id) }
const rpc = async (client, name, args) => { const result = await client.rpc(name, args); if (result.error) throw result.error; return result.data }
const expectError = async (promise, expected) => { try { await promise } catch (error) { if (String(error.message).includes(expected)) return; throw error } throw new Error(`예상 오류 없음: ${expected}`) }
const existingRooms = await admin.from('rooms').select('id').in('host_id', ids)
if (existingRooms.data?.length) await admin.from('rooms').delete().in('id', existingRooms.data.map(room => room.id))

const room = await rpc(clients[0], 'create_private_room', { p_max_players: 4 })
await rpc(clients[1], 'join_private_room', { p_code: room.code })
await rpc(clients[2], 'join_private_room', { p_code: room.code })
let members = await admin.from('room_members').select('user_id,role,is_ready').eq('room_id', room.id).is('left_at', null).is('kicked_at', null)
if (members.error || !members.data.find(member => member.role === 'host')?.is_ready || members.data.filter(member => member.role === 'player').some(member => member.is_ready)) throw members.error ?? new Error('초기 준비 상태 실패')
await expectError(rpc(clients[1], 'update_room_capacity', { p_room_id: room.id, p_max_players: 5 }), 'host_only')
await expectError(rpc(clients[0], 'update_room_capacity', { p_room_id: room.id, p_max_players: 2 }), 'capacity_below_members')
await rpc(clients[0], 'update_room_capacity', { p_room_id: room.id, p_max_players: 6 })
await rpc(clients[0], 'transfer_room_host', { p_room_id: room.id, p_user_id: ids[1] })
const transferred = await admin.from('rooms').select('host_id,max_players').eq('id', room.id).single()
if (transferred.error || transferred.data.host_id !== ids[1] || transferred.data.max_players !== 6) throw transferred.error ?? new Error('방장 위임/인원 변경 실패')
await rpc(clients[1], 'kick_room_member', { p_room_id: room.id, p_user_id: ids[2], p_reason: '자동 테스트 강퇴' })
const removal = await rpc(clients[2], 'get_my_room_removal', { p_room_id: room.id })
if (!removal.kicked || removal.reason !== '자동 테스트 강퇴') throw new Error('강퇴 사유 조회 실패')
await expectError(rpc(clients[2], 'join_private_room', { p_code: room.code }), 'kicked_users_cannot_rejoin')
await rpc(clients[1], 'close_waiting_room', { p_room_id: room.id })
if ((await admin.from('rooms').select('status').eq('id', room.id).single()).data?.status !== 'closed') throw new Error('방 닫기 실패')
await expectError(rpc(clients[2], 'join_private_room', { p_code: room.code }), 'room_closed')

const readyRoom = await rpc(clients[0], 'create_private_room', { p_max_players: 2 })
await rpc(clients[1], 'join_private_room', { p_code: readyRoom.code })
await expectError(rpc(clients[0], 'start_room_game', { p_room_id: readyRoom.id }), 'players_not_ready')
await rpc(clients[1], 'set_room_ready', { p_room_id: readyRoom.id, p_ready: true })
const gameId = await rpc(clients[0], 'start_room_game', { p_room_id: readyRoom.id })
if (!gameId) throw new Error('준비 완료 후 게임 시작 실패')
await expectError(rpc(clients[2], 'join_private_room', { p_code: readyRoom.code }), 'room_started')

const handoffRoom = await rpc(clients[0], 'create_private_room', { p_max_players: 2 })
await rpc(clients[1], 'join_private_room', { p_code: handoffRoom.code })
await rpc(clients[0], 'leave_room', { p_room_id: handoffRoom.id })
if ((await admin.from('rooms').select('host_id').eq('id', handoffRoom.id).single()).data?.host_id !== ids[1]) throw new Error('퇴장 시 자동 방장 위임 실패')

await admin.from('rooms').delete().in('id', [room.id, readyRoom.id, handoffRoom.id])
console.log('verified ready gating, capacity controls, explicit/automatic host transfer, kick reason, rejoin prevention, close confirmation backend, and game start')
