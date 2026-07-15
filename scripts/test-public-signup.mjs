import { randomBytes } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { createClient } from '@supabase/supabase-js'

const environment = process.argv[2] ?? 'development'
const email = process.argv[3]?.trim().toLowerCase()
if (!['development', 'production'].includes(environment) || !email?.includes('@')) {
  throw new Error('사용법: node scripts/test-public-signup.mjs <development|production> <email>')
}
if (process.env.AUTH_SIGNUP_SMOKE_CONFIRMATION !== `${environment}:${email}`) {
  throw new Error(`가입 메일 전송 확인값이 필요합니다: AUTH_SIGNUP_SMOKE_CONFIRMATION=${environment}:${email}`)
}

const parseEnv = source => Object.fromEntries(source.split(/\r?\n/).flatMap(line => {
  const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/)
  return match ? [[match[1], match[2].replace(/^(['"])(.*)\1$/, '$2')]] : []
}))
const env = parseEnv(await readFile(`.env.${environment}`, 'utf8'))
const url = env.VITE_SUPABASE_URL
const anon = env.VITE_SUPABASE_ANON_KEY
const accessToken = process.env.SUPABASE_ACCESS_TOKEN || env.SUPABASE_ACCESS_TOKEN
if (!url || !anon || !accessToken) throw new Error('Supabase URL, anon key와 access token이 필요합니다.')

const projectRef = new URL(url).hostname.split('.')[0]
const keysResponse = await fetch(`https://api.supabase.com/v1/projects/${projectRef}/api-keys?reveal=true`, {
  headers: { Authorization: `Bearer ${accessToken}` },
})
if (!keysResponse.ok) throw new Error(`Supabase API 키 조회 실패 (${keysResponse.status})`)
const keys = await keysResponse.json()
const service = keys.find(key => key.name === 'service_role')?.api_key ?? keys.find(key => key.name === 'service_role')?.value
if (!service) throw new Error('service_role 키를 찾지 못했습니다.')

const admin = createClient(url, service, { auth: { persistSession: false, autoRefreshToken: false } })
const client = createClient(url, anon, { auth: { persistSession: false, autoRefreshToken: false } })
const password = `Signup-${randomBytes(18).toString('base64url')}!`
let createdUser = null
let signupError = null

try {
  const result = await client.auth.signUp({ email, password, options: { data: { nickname: '가입메일검증' } } })
  createdUser = result.data.user
  signupError = result.error
  if (signupError) throw signupError
  if (!createdUser) throw new Error('가입 요청이 사용자를 반환하지 않았습니다.')

  const [profile, registry] = await Promise.all([
    admin.from('profiles').select('id').eq('id', createdUser.id).maybeSingle(),
    admin.from('identity_registry').select('user_id').eq('user_id', createdUser.id).maybeSingle(),
  ])
  if (profile.error || !profile.data || registry.error || !registry.data) {
    throw profile.error ?? registry.error ?? new Error('가입 트리거 데이터가 생성되지 않았습니다.')
  }

  const [name, domain] = email.split('@')
  console.log(JSON.stringify({
    environment,
    recipient: `${name.slice(0, 2)}${'*'.repeat(Math.max(2, name.length - 2))}@${domain}`,
    signupAccepted: true,
    verificationRequired: !result.data.session,
    profileCreated: true,
    identityRegistryCreated: true,
  }, null, 2))
} finally {
  if (!createdUser) {
    const listed = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 })
    if (!listed.error) createdUser = listed.data.users.find(user => user.email?.toLowerCase() === email) ?? null
  }
  if (createdUser) {
    const removed = await admin.auth.admin.deleteUser(createdUser.id)
    if (removed.error && !signupError) throw removed.error
  }
}
