import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { createClient } from '@supabase/supabase-js'

const action = process.argv[2] ?? 'join'
const parseEnv = source => Object.fromEntries(source.split(/\r?\n/).flatMap(line => { const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/); return match ? [[match[1], match[2].replace(/^(['"])(.*)\1$/, '$2')]] : [] }))
const env = parseEnv(await readFile('.env.development', 'utf8'))
const url = env.VITE_SUPABASE_URL
const response = await fetch(`https://api.supabase.com/v1/projects/${new URL(url).hostname.split('.')[0]}/api-keys?reveal=true`, { headers: { Authorization: `Bearer ${env.SUPABASE_ACCESS_TOKEN}` } })
if (!response.ok) throw new Error('개발 프로젝트 키 조회 실패')
const service = (await response.json()).find(key => key.name === 'service_role')?.api_key
const admin = createClient(url, service, { auth: { persistSession: false, autoRefreshToken: false } })
const listed = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 })
if (listed.error) throw listed.error
const host = listed.data.users.find(user => user.email === 'lobby1@swonport.kr')
let player = listed.data.users.find(user => user.email === 'lobby2@swonport.kr')
const space = (await admin.from('spaces').select('id').eq('slug', 'automation-organization').single()).data
if (!host || !space) throw new Error('브라우저 테스트 계정 또는 스페이스가 없습니다.')

if (action === 'cleanup') {
  const rooms = await admin.from('rooms').select('id').eq('host_id', host.id).eq('space_id', space.id)
  if (rooms.data?.length) await admin.from('rooms').delete().in('id', rooms.data.map(room => room.id))
  await admin.from('space_members').delete().eq('space_id', space.id).in('user_id', [host.id, player?.id].filter(Boolean))
  console.log('browser custom-card fixture cleaned')
} else {
  const password = `Browser-${createHash('sha256').update(env.SUPABASE_ACCESS_TOKEN).digest('hex').slice(0, 18)}!`
  if (player) {
    const updated = await admin.auth.admin.updateUserById(player.id, { password, email_confirm: true, ban_duration: 'none', user_metadata: { nickname: '대기방2' } })
    if (updated.error) throw updated.error
  } else {
    const created = await admin.auth.admin.createUser({ email: 'lobby2@swonport.kr', password, email_confirm: true, user_metadata: { nickname: '대기방2' } })
    if (created.error || !created.data.user) throw created.error ?? new Error('대기방2 생성 실패')
    player = created.data.user
  }
  await admin.from('profiles').update({ nickname: '대기방2', deleted_at: null, suspended_until: null }).eq('id', player.id)
  await admin.from('space_members').upsert({ space_id: space.id, user_id: player.id, role: 'member' }, { onConflict: 'space_id,user_id' })
  const room = (await admin.from('rooms').select('id,code').eq('host_id', host.id).eq('space_id', space.id).eq('status', 'waiting').order('created_at', { ascending: false }).limit(1).single()).data
  if (!room) throw new Error('대기 중인 브라우저 테스트 방이 없습니다.')
  const client = createClient(url, env.VITE_SUPABASE_ANON_KEY, { auth: { persistSession: false, autoRefreshToken: false } })
  const signed = await client.auth.signInWithPassword({ email: 'lobby2@swonport.kr', password })
  if (signed.error) throw signed.error
  const joined = await client.rpc('join_private_room', { p_code: room.code })
  if (joined.error) throw joined.error
  const ready = await client.rpc('set_room_ready', { p_room_id: room.id, p_ready: true })
  if (ready.error) throw ready.error
  console.log('browser custom-card player joined and ready')
}
