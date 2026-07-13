import { readFile } from 'node:fs/promises'
import { createClient } from '@supabase/supabase-js'

const parseEnv = source => Object.fromEntries(source.split(/\r?\n/).flatMap(line => {
  const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/)
  return match ? [[match[1], match[2].replace(/^(['"])(.*)\1$/, '$2')]] : []
}))
const env = parseEnv(await readFile('.env.development', 'utf8'))
const password = process.env.TEST_USER_PASSWORD
const roomCode = process.env.TEST_ROOM_CODE?.toUpperCase()
if (!password || !roomCode) throw new Error('TEST_USER_PASSWORD와 TEST_ROOM_CODE가 필요합니다.')

const client = createClient(env.VITE_SUPABASE_URL, env.VITE_SUPABASE_ANON_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
})
const { error: signInError } = await client.auth.signInWithPassword({ email: 'user1@swonport.kr', password })
if (signInError) throw signInError

const { data: room, error: roomError } = await client.from('rooms').select('id,code,status').eq('code', roomCode).single()
if (roomError) throw new Error(`방 조회 실패: ${roomError.message || roomError.code}`)
const { count: memberCount, error: membersError } = await client.from('room_members').select('*', { count: 'exact', head: true }).eq('room_id', room.id).is('kicked_at', null)
if (membersError) throw new Error(`방 참가자 조회 실패: ${membersError.message || membersError.code}`)
const { data: game, error: gameError } = await client.from('games').select('id').eq('room_id', room.id).single()
if (gameError) throw new Error(`게임 조회 실패: ${gameError.message || gameError.code}`)
const { count: playerCount, error: playersError } = await client.from('game_players').select('*', { count: 'exact', head: true }).eq('game_id', game.id)
if (playersError) throw new Error(`게임 참가자 조회 실패: ${playersError.message || playersError.code}`)

if (room.status !== 'playing' || memberCount !== 2 || playerCount !== 2) {
  throw new Error(`검증 실패: status=${room.status}, members=${memberCount}, gamePlayers=${playerCount}`)
}
console.log(`verified room ${room.code}: playing, ${memberCount} members, ${playerCount} game players, game ${game.id}`)
