import { readFile } from 'node:fs/promises'
import { createClient } from '@supabase/supabase-js'

function parseEnv(source) {
  return Object.fromEntries(source.split(/\r?\n/).flatMap(line => {
    const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/)
    if (!match) return []
    return [[match[1], match[2].replace(/^(['"])(.*)\1$/, '$2')]]
  }))
}

const env = parseEnv(await readFile('.env.development', 'utf8'))
const password = process.env.TEST_USER_PASSWORD
const roomCode = process.env.TEST_ROOM_CODE?.toUpperCase()
if (!password || !roomCode) throw new Error('TEST_USER_PASSWORD와 TEST_ROOM_CODE가 필요합니다.')

const client = createClient(env.VITE_SUPABASE_URL, env.VITE_SUPABASE_ANON_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
})
const { error: signInError } = await client.auth.signInWithPassword({ email: 'user2@swonport.kr', password })
if (signInError) throw signInError

const { data: roomData, error: joinError } = await client.rpc('join_private_room', { p_code: roomCode })
if (joinError) throw joinError
const room = Array.isArray(roomData) ? roomData[0] : roomData

const { data: members, error: membersError } = await client
  .from('room_members')
  .select('seat,profiles(nickname)')
  .eq('room_id', room.id)
  .is('kicked_at', null)
  .order('seat')
if (membersError) throw membersError

const nicknames = members.map(member => {
  const profile = Array.isArray(member.profiles) ? member.profiles[0] : member.profiles
  return profile?.nickname
})
console.log(`joined room ${room.code}: ${members.length} players (${nicknames.join(', ')})`)
