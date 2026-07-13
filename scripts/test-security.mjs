import { createHash, randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { createClient } from '@supabase/supabase-js'

const parseEnv = source => Object.fromEntries(source.split(/\r?\n/).flatMap(line => {
  const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/)
  return match ? [[match[1], match[2].replace(/^(['"])(.*)\1$/, '$2')]] : []
}))
const env = parseEnv(await readFile('.env.development', 'utf8'))
const url = env.VITE_SUPABASE_URL
const anon = env.VITE_SUPABASE_ANON_KEY
if (!url || !anon || !env.SUPABASE_ACCESS_TOKEN) throw new Error('개발 Supabase 설정이 필요합니다.')

const projectRef = new URL(url).hostname.split('.')[0]
const keyResponse = await fetch(`https://api.supabase.com/v1/projects/${projectRef}/api-keys?reveal=true`, {
  headers: { Authorization: `Bearer ${env.SUPABASE_ACCESS_TOKEN}` },
})
if (!keyResponse.ok) throw new Error(`개발 프로젝트 키 조회 실패 (${keyResponse.status})`)
const service = (await keyResponse.json()).find(key => key.name === 'service_role')?.api_key
if (!service) throw new Error('service role 키를 찾지 못했습니다.')

const admin = createClient(url, service, { auth: { persistSession: false, autoRefreshToken: false } })
const player = createClient(url, anon, { auth: { persistSession: false, autoRefreshToken: false } })
const password = `Admin-${createHash('sha256').update(env.SUPABASE_ACCESS_TOKEN).digest('hex').slice(0, 18)}!`
const signed = await player.auth.signInWithPassword({ email: 'admin-player-test@swonport.kr', password })
if (signed.error || !signed.data.user) throw signed.error ?? new Error('보안 테스트 사용자 로그인이 필요합니다. test-admin을 먼저 실행해 주세요.')

const evilOrigin = 'https://attacker.invalid'
const rejectedOrigin = await fetch(`${url}/functions/v1/admin-actions`, {
  method: 'OPTIONS',
  headers: { Origin: evilOrigin, apikey: anon, 'Access-Control-Request-Method': 'POST' },
})
const rejectedBody = await rejectedOrigin.json().catch(() => null)
if (rejectedOrigin.status !== 403 || rejectedBody?.error !== 'origin_not_allowed' || rejectedOrigin.headers.has('access-control-allow-origin')) {
  throw new Error('허용되지 않은 관리자 API Origin이 차단되지 않았습니다.')
}
const localOrigin = 'http://127.0.0.1:43129'
const allowedOrigin = await fetch(`${url}/functions/v1/admin-actions`, {
  method: 'OPTIONS',
  headers: { Origin: localOrigin, apikey: anon, 'Access-Control-Request-Method': 'POST' },
})
if (!allowedOrigin.ok || allowedOrigin.headers.get('access-control-allow-origin') !== localOrigin) throw new Error('개발 Origin 허용 검증 실패')

const bootstrap = await player.rpc('complete_platform_bootstrap', { p_user_id: signed.data.user.id })
if (!bootstrap.error) throw new Error('일반 사용자가 최초 슈퍼 관리자 RPC를 호출했습니다.')

const target = await admin.from('profiles').select('id,nickname').neq('id', signed.data.user.id).limit(1).single()
if (target.error) throw target.error
const forgedNickname = `위조${String(Date.now()).slice(-6)}`
const forgedUpdate = await player.from('profiles').update({ nickname: forgedNickname }).eq('id', target.data.id).select('id')
if (forgedUpdate.error || forgedUpdate.data.length !== 0) throw forgedUpdate.error ?? new Error('다른 사용자 프로필 위조가 허용되었습니다.')
const unchanged = await admin.from('profiles').select('nickname').eq('id', target.data.id).single()
if (unchanged.error || unchanged.data.nickname !== target.data.nickname) throw unchanged.error ?? new Error('다른 사용자 프로필이 변경되었습니다.')

const existingGame = await admin.from('game_players').select('game_id,user_id').limit(1).maybeSingle()
if (existingGame.error || !existingGame.data) throw existingGame.error ?? new Error('게임 보안 테스트용 데이터가 없습니다.')
const directEvent = await player.from('game_events').insert({
  game_id: existingGame.data.game_id,
  user_id: signed.data.user.id,
  event_type: 'ring',
  action_id: randomUUID(),
  payload: { security_test: true },
})
if (!directEvent.error) throw new Error('클라이언트의 game_events 직접 쓰기가 허용되었습니다.')

const actionId = randomUUID()
const firstEvent = await admin.from('game_events').insert({
  game_id: existingGame.data.game_id,
  user_id: existingGame.data.user_id,
  event_type: 'security_rate_test',
  action_id: actionId,
  payload: { security_test: true },
})
if (firstEvent.error) throw firstEvent.error
await admin.from('game_events').delete().eq('action_id', actionId)

const triggerAction = randomUUID()
const firstRing = await admin.from('game_events').insert({
  game_id: existingGame.data.game_id,
  user_id: existingGame.data.user_id,
  event_type: 'ring',
  action_id: triggerAction,
  payload: { security_test: true },
})
if (firstRing.error) throw firstRing.error
const secondAction = randomUUID()
const secondRing = await admin.from('game_events').insert({
  game_id: existingGame.data.game_id,
  user_id: existingGame.data.user_id,
  event_type: 'ring',
  action_id: secondAction,
  payload: { security_test: true },
})
await admin.from('game_events').delete().in('action_id', [triggerAction, secondAction])
if (!secondRing.error || !secondRing.error.message.includes('game_action_rate_limited')) throw new Error('게임 액션 서버 rate limit 검증 실패')

console.log('verified strict admin CORS, bootstrap RPC denial, cross-user profile isolation, direct game-event denial, and server game-action rate limiting')
