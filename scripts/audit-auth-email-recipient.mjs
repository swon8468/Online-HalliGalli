import { readFile } from 'node:fs/promises'
import { createClient } from '@supabase/supabase-js'

const environment = process.argv[2] ?? 'development'
const requestedEmail = process.argv[3]?.trim().toLowerCase()
if (!['development', 'production'].includes(environment) || !requestedEmail?.includes('@')) {
  throw new Error('사용법: node scripts/audit-auth-email-recipient.mjs <development|production> <email>')
}

const parseEnv = source => Object.fromEntries(source.split(/\r?\n/).flatMap(line => {
  const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/)
  return match ? [[match[1], match[2].replace(/^(['"])(.*)\1$/, '$2')]] : []
}))

const env = parseEnv(await readFile(`.env.${environment}`, 'utf8'))
const url = env.VITE_SUPABASE_URL
const accessToken = process.env.SUPABASE_ACCESS_TOKEN || env.SUPABASE_ACCESS_TOKEN
if (!url || !accessToken) throw new Error('Supabase URL과 access token이 필요합니다.')

const projectRef = new URL(url).hostname.split('.')[0]
const keysResponse = await fetch(`https://api.supabase.com/v1/projects/${projectRef}/api-keys?reveal=true`, {
  headers: { Authorization: `Bearer ${accessToken}` },
})
if (!keysResponse.ok) throw new Error(`Supabase API 키 조회 실패 (${keysResponse.status})`)
const serviceEntry = (await keysResponse.json()).find(key => key.name === 'service_role')
const serviceRole = serviceEntry?.api_key ?? serviceEntry?.value
if (!serviceRole) throw new Error('service_role 키를 찾지 못했습니다.')

const admin = createClient(url, serviceRole, { auth: { persistSession: false, autoRefreshToken: false } })
let matchedUser = null
for (let page = 1; page <= 10 && !matchedUser; page += 1) {
  const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 1000 })
  if (error) throw error
  matchedUser = data.users.find(user => user.email?.toLowerCase() === requestedEmail) ?? null
  if (data.users.length < 1000) break
}

const [name, domain] = requestedEmail.split('@')
const maskedEmail = `${name.slice(0, 2)}${'*'.repeat(Math.max(2, name.length - 2))}@${domain}`
console.log(JSON.stringify({
  environment,
  email: maskedEmail,
  accountExists: Boolean(matchedUser),
  emailConfirmed: Boolean(matchedUser?.email_confirmed_at),
  banned: Boolean(matchedUser?.banned_until && new Date(matchedUser.banned_until) > new Date()),
}, null, 2))
