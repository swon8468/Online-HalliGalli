import { readFile } from 'node:fs/promises'

const environment = process.argv[2] ?? 'development'
if (!['development', 'production'].includes(environment)) {
  throw new Error('사용법: node scripts/audit-supabase-auth.mjs <development|production>')
}

const parseEnv = source => Object.fromEntries(source.split(/\r?\n/).flatMap(line => {
  const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/)
  return match ? [[match[1], match[2].replace(/^(['"])(.*)\1$/, '$2')]] : []
}))

const env = parseEnv(await readFile(`.env.${environment}`, 'utf8'))
const url = env.VITE_SUPABASE_URL
const accessToken = process.env.SUPABASE_ACCESS_TOKEN || env.SUPABASE_ACCESS_TOKEN
const publicUrl = env.VITE_PUBLIC_APP_URL?.replace(/\/$/, '')
if (!url || !accessToken || !publicUrl) {
  throw new Error(`${environment} Supabase URL, access token, public app URL이 필요합니다.`)
}

const projectRef = new URL(url).hostname.split('.')[0]
const response = await fetch(`https://api.supabase.com/v1/projects/${projectRef}/config/auth`, {
  headers: { Authorization: `Bearer ${accessToken}` },
})
if (!response.ok) throw new Error(`Auth 설정 조회 실패 (${response.status})`)
const config = await response.json()
const redirectUrls = String(config.uri_allow_list ?? '').split(',').map(value => value.trim()).filter(Boolean)
const smtpConfigured = Boolean(config.smtp_host && config.smtp_admin_email)
const expectedPhone = env.VITE_PHONE_AUTH_ENABLED === 'true'
const checks = [
  {
    id: 'site_url',
    status: config.site_url?.replace(/\/$/, '') === publicUrl ? 'pass' : 'error',
    actual: config.site_url ? 'configured' : 'missing',
  },
  {
    id: 'redirect_allowlist',
    status: redirectUrls.some(value => value === publicUrl || value.startsWith(`${publicUrl}/`)) ? 'pass' : 'error',
    actual: `${redirectUrls.length} entries`,
  },
  {
    id: 'password_min_length',
    status: Number(config.password_min_length) >= 8 ? 'pass' : 'error',
    actual: Number(config.password_min_length) || 0,
  },
  {
    id: 'leaked_password_protection',
    status: config.password_hibp_enabled ? 'pass' : 'warning',
    actual: Boolean(config.password_hibp_enabled),
    note: config.password_hibp_enabled ? undefined : 'Supabase Pro 이상에서 활성화할 수 있습니다.',
  },
  {
    id: 'custom_smtp',
    status: smtpConfigured ? 'pass' : environment === 'production' ? 'error' : 'warning',
    actual: smtpConfigured,
    note: smtpConfigured ? undefined : '기본 메일러는 공개 서비스용이 아닙니다.',
  },
  {
    id: 'phone_provider_matches_client',
    status: Boolean(config.external_phone_enabled) === expectedPhone ? 'pass' : 'error',
    actual: { server: Boolean(config.external_phone_enabled), client: expectedPhone },
  },
]

const result = {
  environment,
  ok: !checks.some(check => check.status === 'error'),
  counts: {
    pass: checks.filter(check => check.status === 'pass').length,
    warning: checks.filter(check => check.status === 'warning').length,
    error: checks.filter(check => check.status === 'error').length,
  },
  checks,
}
console.log(JSON.stringify(result, null, 2))
if (!result.ok) process.exitCode = 1
