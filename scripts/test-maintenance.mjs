import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { createClient } from '@supabase/supabase-js'

const parseEnv = source => Object.fromEntries(source.split(/\r?\n/).flatMap(line => { const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/); return match ? [[match[1], match[2].replace(/^(['"])(.*)\1$/, '$2')]] : [] }))
const env = parseEnv(await readFile('.env.development', 'utf8'))
const url = env.VITE_SUPABASE_URL, anon = env.VITE_SUPABASE_ANON_KEY, accessToken = process.env.SUPABASE_ACCESS_TOKEN || env.SUPABASE_ACCESS_TOKEN
if (!url || !anon || !accessToken) throw new Error('개발 Supabase 설정이 필요합니다.')
const keysResponse = await fetch(`https://api.supabase.com/v1/projects/${new URL(url).hostname.split('.')[0]}/api-keys?reveal=true`, { headers: { Authorization: `Bearer ${accessToken}` } })
if (!keysResponse.ok) throw new Error('개발 프로젝트 키 조회 실패')
const serviceEntry = (await keysResponse.json()).find(key => key.name === 'service_role')
const service = serviceEntry?.api_key ?? serviceEntry?.value
const admin = createClient(url, service, { auth: { persistSession: false, autoRefreshToken: false } })
const password = process.env.TEST_USER_PASSWORD || `Maintenance-${createHash('sha256').update(accessToken).digest('hex').slice(0, 18)}!`
const accounts = [
  { email: 'maintenance-admin@swonport.kr', nickname: '정리관리자', role: 'admin' },
  { email: 'maintenance-player@swonport.kr', nickname: '정리사용자', role: 'player' },
]
const createdIds = []

try {
  const listed = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 })
  if (listed.error) throw listed.error
  const clients = []
  for (const account of accounts) {
    const existing = listed.data.users.find(user => user.email === account.email)
    if (existing) await admin.auth.admin.deleteUser(existing.id)
    const created = await admin.auth.admin.createUser({ email: account.email, password, email_confirm: true, user_metadata: { nickname: account.nickname }, app_metadata: { platform_role: account.role } })
    if (created.error || !created.data.user) throw created.error ?? new Error('유지보수 테스트 계정 생성 실패')
    createdIds.push(created.data.user.id)
    await admin.from('profiles').update({ platform_role: account.role }).eq('id', created.data.user.id)
    const client = createClient(url, anon, { auth: { persistSession: false, autoRefreshToken: false } })
    const signed = await client.auth.signInWithPassword({ email: account.email, password })
    if (signed.error) throw signed.error
    clients.push(client)
  }

  const preview = await clients[0].rpc('run_release_maintenance', { p_execute: false, p_confirmation: null })
  if (preview.error || preview.data?.executed !== false || !preview.data?.safeCleanup || !preview.data?.reviewOnly) throw preview.error ?? new Error('유지보수 dry-run 실패')
  const denied = await clients[1].rpc('get_release_maintenance_preview')
  if (!denied.error) throw new Error('일반 사용자의 유지보수 미리보기가 허용됐습니다.')
  const confirmation = await clients[0].rpc('run_release_maintenance', { p_execute: true, p_confirmation: 'WRONG' })
  if (!confirmation.error || !confirmation.error.message.includes('maintenance_confirmation_required')) throw new Error('유지보수 확인 문구가 강제되지 않았습니다.')
  console.log(JSON.stringify({ verified: 'maintenance dry-run, role restriction, explicit confirmation', preview: preview.data }))
} finally {
  for (const id of createdIds) await admin.auth.admin.deleteUser(id)
}
