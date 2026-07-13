import { readFile } from 'node:fs/promises'
import { createClient } from '@supabase/supabase-js'

function parseEnv(source) {
  return Object.fromEntries(source.split(/\r?\n/).flatMap(line => {
    const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/)
    if (!match) return []
    const value = match[2].replace(/^(['"])(.*)\1$/, '$2')
    return [[match[1], value]]
  }))
}

const env = parseEnv(await readFile('.env.development', 'utf8'))
const password = process.env.TEST_USER_PASSWORD
if (!password || password.length < 8) throw new Error('TEST_USER_PASSWORD를 8자 이상으로 설정해 주세요.')

const url = env.VITE_SUPABASE_URL
const anonKey = env.VITE_SUPABASE_ANON_KEY
const accessToken = env.SUPABASE_ACCESS_TOKEN
if (!url || !anonKey || !accessToken) throw new Error('개발 환경의 Supabase URL, anon key, access token이 필요합니다.')

const projectRef = new URL(url).hostname.split('.')[0]
const response = await fetch(`https://api.supabase.com/v1/projects/${projectRef}/api-keys?reveal=true`, {
  headers: { Authorization: `Bearer ${accessToken}` },
})
if (!response.ok) throw new Error(`Supabase API 키 조회 실패 (${response.status})`)

const apiKeys = await response.json()
const serviceRole = apiKeys.find(key => key.name === 'service_role')
const serviceRoleKey = serviceRole?.api_key ?? serviceRole?.value
if (!serviceRoleKey) throw new Error('개발 프로젝트의 service_role 키를 찾지 못했습니다.')

const admin = createClient(url, serviceRoleKey, { auth: { persistSession: false, autoRefreshToken: false } })
const accounts = [
  { email: 'user1@swonport.kr', nickname: '사용자1' },
  { email: 'user2@swonport.kr', nickname: '사용자2' },
]

const { data: listed, error: listError } = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 })
if (listError) throw listError

for (const account of accounts) {
  const existing = listed.users.find(user => user.email?.toLowerCase() === account.email)
  const result = existing
    ? await admin.auth.admin.updateUserById(existing.id, { password, email_confirm: true, user_metadata: { nickname: account.nickname } })
    : await admin.auth.admin.createUser({ email: account.email, password, email_confirm: true, user_metadata: { nickname: account.nickname } })
  if (result.error || !result.data.user) throw result.error ?? new Error(`${account.email} 계정 생성 실패`)

  const { error: profileError } = await admin.from('profiles').update({ nickname: account.nickname }).eq('id', result.data.user.id)
  if (profileError) throw profileError

  const verifier = createClient(url, anonKey, { auth: { persistSession: false, autoRefreshToken: false } })
  const { data: signedIn, error: signInError } = await verifier.auth.signInWithPassword({ email: account.email, password })
  if (signInError || !signedIn.user) throw signInError ?? new Error(`${account.email} 로그인 검증 실패`)
  console.log(`verified: ${account.nickname} <${account.email}>`)
}

console.log('development test accounts are ready')
