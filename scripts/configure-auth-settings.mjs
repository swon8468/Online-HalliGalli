import { readFile } from 'node:fs/promises'

const environment = process.argv[2] ?? 'production'
const mode = process.argv[3] ?? 'preview'
const smtpSourceEnvironment = process.argv[4]

if (!['development', 'production'].includes(environment) || !['preview', 'apply'].includes(mode)) {
  throw new Error('사용법: node scripts/configure-auth-settings.mjs <development|production> <preview|apply> [smtp-source-environment]')
}
if (smtpSourceEnvironment && !['development', 'production'].includes(smtpSourceEnvironment)) {
  throw new Error('SMTP 원본 환경은 development 또는 production이어야 합니다.')
}

const parseEnv = source => Object.fromEntries(source.split(/\r?\n/).flatMap(line => {
  const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/)
  return match ? [[match[1], match[2].replace(/^(['"])(.*)\1$/, '$2')]] : []
}))

const readEnvironment = async name => parseEnv(await readFile(`.env.${name}`, 'utf8'))
const targetEnv = await readEnvironment(environment)
const accessToken = process.env.SUPABASE_ACCESS_TOKEN || targetEnv.SUPABASE_ACCESS_TOKEN
const supabaseUrl = targetEnv.VITE_SUPABASE_URL
const publicUrl = targetEnv.VITE_PUBLIC_APP_URL?.replace(/\/$/, '')

if (!accessToken || !supabaseUrl || !publicUrl) {
  throw new Error(`${environment} Supabase URL, access token, public app URL이 필요합니다.`)
}

const projectRef = new URL(supabaseUrl).hostname.split('.')[0]
const endpoint = `https://api.supabase.com/v1/projects/${projectRef}/config/auth`
const requestConfig = async (url, token) => {
  const response = await fetch(url, { headers: { Authorization: `Bearer ${token}` } })
  if (!response.ok) throw new Error(`Auth 설정 조회 실패 (${response.status})`)
  return response.json()
}

const current = await requestConfig(endpoint, accessToken)
const recoveryRedirect = `${publicUrl}/recover**`
const currentRedirects = String(current.uri_allow_list ?? '').split(',').map(value => value.trim()).filter(Boolean)
const desiredRedirects = Array.from(new Set([...currentRedirects, recoveryRedirect]))

const payload = {
  site_url: publicUrl,
  uri_allow_list: desiredRedirects.join(','),
  password_min_length: Math.max(8, Number(current.password_min_length) || 0),
}

let smtpSource = null
if (smtpSourceEnvironment) {
  const sourceEnv = await readEnvironment(smtpSourceEnvironment)
  const sourceUrl = sourceEnv.VITE_SUPABASE_URL
  const sourceToken = process.env.SUPABASE_ACCESS_TOKEN || sourceEnv.SUPABASE_ACCESS_TOKEN || accessToken
  if (!sourceUrl || !sourceToken) throw new Error('SMTP 원본 Supabase 설정이 필요합니다.')
  const sourceRef = new URL(sourceUrl).hostname.split('.')[0]
  smtpSource = await requestConfig(`https://api.supabase.com/v1/projects/${sourceRef}/config/auth`, sourceToken)
  const requiredSmtp = ['smtp_admin_email', 'smtp_host', 'smtp_port', 'smtp_user']
  if (!requiredSmtp.every(key => smtpSource[key] !== undefined && smtpSource[key] !== null && String(smtpSource[key]).length > 0)) {
    throw new Error('SMTP 원본 환경에 복사 가능한 공개 설정이 없습니다.')
  }
  const smtpPassword = process.env.AUTH_SMTP_PASSWORD
  if (mode === 'apply' && !smtpPassword) {
    throw new Error('보호된 SMTP 비밀번호는 프로젝트 설정 조회값으로 복사할 수 없습니다. AUTH_SMTP_PASSWORD에 실제 SMTP 비밀번호를 제공해 주세요.')
  }
  Object.assign(payload, {
    external_email_enabled: true,
    mailer_autoconfirm: false,
    mailer_secure_email_change_enabled: true,
    smtp_admin_email: smtpSource.smtp_admin_email,
    smtp_host: smtpSource.smtp_host,
    smtp_port: smtpSource.smtp_port,
    smtp_user: smtpSource.smtp_user,
    ...(smtpPassword ? { smtp_pass: smtpPassword } : {}),
    smtp_sender_name: smtpSource.smtp_sender_name || 'Halli Galli',
    ...(smtpSource.smtp_max_frequency ? { smtp_max_frequency: smtpSource.smtp_max_frequency } : {}),
  })
}

if (mode === 'apply') {
  const expectedConfirmation = `${environment}:${projectRef}`
  if (process.env.AUTH_CONFIG_APPLY_CONFIRMATION !== expectedConfirmation) {
    throw new Error(`적용 확인값이 필요합니다: AUTH_CONFIG_APPLY_CONFIRMATION=${expectedConfirmation}`)
  }
  const response = await fetch(endpoint, {
    method: 'PATCH',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
  if (!response.ok) throw new Error(`Auth 설정 적용 실패 (${response.status})`)
}

console.log(JSON.stringify({
  environment,
  mode,
  projectConfigured: true,
  applied: mode === 'apply',
  changes: {
    siteUrl: current.site_url?.replace(/\/$/, '') === publicUrl ? 'already_configured' : 'update',
    recoveryRedirect: currentRedirects.includes(recoveryRedirect) ? 'already_configured' : 'add',
    passwordMinimum: Number(current.password_min_length) >= 8 ? 'already_configured' : 'update',
    smtp: smtpSource
      ? (process.env.AUTH_SMTP_PASSWORD
          ? (current.smtp_host && current.smtp_admin_email ? 'replace_from_verified_source' : 'copy_from_verified_source')
          : 'actual_password_required_for_apply')
      : 'unchanged',
  },
}, null, 2))
