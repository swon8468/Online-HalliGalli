import { readFile } from 'node:fs/promises'
import { createClient } from '@supabase/supabase-js'

const environment = process.argv[2] ?? 'development'
const email = process.argv[3]?.trim().toLowerCase()
if (!['development', 'production'].includes(environment) || !email?.includes('@')) {
  throw new Error('사용법: node scripts/send-auth-email-smoke.mjs <development|production> <email>')
}

const expectedConfirmation = `${environment}:${email}`
if (process.env.AUTH_EMAIL_SMOKE_CONFIRMATION !== expectedConfirmation) {
  throw new Error(`메일 전송 확인값이 필요합니다: AUTH_EMAIL_SMOKE_CONFIRMATION=${expectedConfirmation}`)
}

const parseEnv = source => Object.fromEntries(source.split(/\r?\n/).flatMap(line => {
  const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/)
  return match ? [[match[1], match[2].replace(/^(['"])(.*)\1$/, '$2')]] : []
}))

const env = parseEnv(await readFile(`.env.${environment}`, 'utf8'))
const url = env.VITE_SUPABASE_URL
const anonKey = env.VITE_SUPABASE_ANON_KEY
const publicUrl = env.VITE_PUBLIC_APP_URL?.replace(/\/$/, '')
if (!url || !anonKey || !publicUrl) throw new Error('Supabase URL, anon key와 public app URL이 필요합니다.')

const client = createClient(url, anonKey, { auth: { persistSession: false, autoRefreshToken: false } })
const { error } = await client.auth.resetPasswordForEmail(email, {
  redirectTo: `${publicUrl}/recover?type=recovery`,
})
if (error) throw error

const [name, domain] = email.split('@')
console.log(JSON.stringify({
  environment,
  recipient: `${name.slice(0, 2)}${'*'.repeat(Math.max(2, name.length - 2))}@${domain}`,
  requestAccepted: true,
}, null, 2))
