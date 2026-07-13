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
const accessToken = process.env.SUPABASE_ACCESS_TOKEN || env.SUPABASE_ACCESS_TOKEN
if (!url || !anon || !accessToken) throw new Error('개발 Supabase 설정이 필요합니다.')

const keysResponse = await fetch(`https://api.supabase.com/v1/projects/${new URL(url).hostname.split('.')[0]}/api-keys?reveal=true`, {
  headers: { Authorization: `Bearer ${accessToken}` },
})
if (!keysResponse.ok) throw new Error(`개발 프로젝트 키 조회 실패 (${keysResponse.status})`)
const serviceEntry = (await keysResponse.json()).find(key => key.name === 'service_role')
const service = serviceEntry?.api_key ?? serviceEntry?.value
if (!service) throw new Error('개발 service role 키를 찾지 못했습니다.')

const admin = createClient(url, service, { auth: { persistSession: false, autoRefreshToken: false } })
const password = process.env.TEST_USER_PASSWORD || `Push-${createHash('sha256').update(accessToken).digest('hex').slice(0, 18)}!`
const accounts = [0, 1].map(index => ({ email: `push-e2e-${index + 1}@swonport.kr`, nickname: `푸시검증${index + 1}` }))
const createdIds = []

try {
  const listed = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 })
  if (listed.error) throw listed.error
  for (const account of accounts) {
    const existing = listed.data.users.find(user => user.email === account.email)
    if (existing) await admin.auth.admin.deleteUser(existing.id)
    const created = await admin.auth.admin.createUser({ email: account.email, password, email_confirm: true, user_metadata: { nickname: account.nickname } })
    if (created.error || !created.data.user) throw created.error ?? new Error('푸시 테스트 계정 생성 실패')
    createdIds.push(created.data.user.id)
  }

  const clients = []
  for (const account of accounts) {
    const client = createClient(url, anon, { auth: { persistSession: false, autoRefreshToken: false } })
    const signed = await client.auth.signInWithPassword({ email: account.email, password })
    if (signed.error) throw signed.error
    clients.push(client)
  }

  const endpoint = `https://push.test.invalid/subscription/${randomUUID()}`
  const payload = { p_endpoint: endpoint, p_p256dh: 'p'.repeat(64), p_auth: 'a'.repeat(24), p_user_agent: 'release-candidate-integration' }
  const first = await clients[0].rpc('register_push_subscription', payload)
  if (first.error) throw first.error
  const second = await clients[1].rpc('register_push_subscription', payload)
  if (second.error) throw second.error
  const claimed = await admin.from('push_subscriptions').select('user_id').eq('endpoint', endpoint).single()
  if (claimed.error || claimed.data.user_id !== createdIds[1]) throw claimed.error ?? new Error('공유 기기 endpoint 재할당 실패')

  const anonymous = createClient(url, anon, { auth: { persistSession: false, autoRefreshToken: false } })
  const rejected = await anonymous.rpc('register_push_subscription', payload)
  if (!rejected.error) throw new Error('비인증 푸시 등록이 차단되지 않았습니다.')
  const oldOwnerDelete = await clients[0].from('push_subscriptions').delete().eq('endpoint', endpoint)
  if (oldOwnerDelete.error) throw oldOwnerDelete.error
  const preserved = await admin.from('push_subscriptions').select('id').eq('endpoint', endpoint).maybeSingle()
  if (preserved.error || !preserved.data) throw preserved.error ?? new Error('이전 사용자가 현재 구독을 삭제했습니다.')
  const currentOwnerDelete = await clients[1].from('push_subscriptions').delete().eq('endpoint', endpoint)
  if (currentOwnerDelete.error) throw currentOwnerDelete.error
  const removed = await admin.from('push_subscriptions').select('id').eq('endpoint', endpoint).maybeSingle()
  if (removed.error || removed.data) throw removed.error ?? new Error('현재 사용자의 구독 해제가 반영되지 않았습니다.')

  console.log('verified authenticated push registration, shared-device endpoint reassignment, RLS ownership, and cleanup')
} finally {
  for (const id of createdIds) await admin.auth.admin.deleteUser(id)
}
