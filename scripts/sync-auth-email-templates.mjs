import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import path from 'node:path'

const environment = process.argv[2] ?? 'development'
const mode = process.argv[3] ?? 'preview'
if (!['development', 'production'].includes(environment) || !['preview', 'apply'].includes(mode)) {
  throw new Error('사용법: node scripts/sync-auth-email-templates.mjs <development|production> <preview|apply>')
}

const parseEnv = source => Object.fromEntries(source.split(/\r?\n/).flatMap(line => {
  const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/)
  return match ? [[match[1], match[2].replace(/^(['"])(.*)\1$/, '$2')]] : []
}))

const readEnv = async () => {
  try { return parseEnv(await readFile(`.env.${environment}`, 'utf8')) }
  catch { return {} }
}

const templateDirectory = path.resolve('supabase/templates')
const manifest = JSON.parse(await readFile(path.join(templateDirectory, 'manifest.json'), 'utf8'))
if (!Array.isArray(manifest) || manifest.length === 0) throw new Error('인증 메일 템플릿 manifest가 비어 있습니다.')

const templates = await Promise.all(manifest.map(async entry => {
  const content = await readFile(path.join(templateDirectory, entry.file), 'utf8')
  const errors = []
  if (!entry.subject?.trim()) errors.push('subject_missing')
  if (!entry.subjectKey?.startsWith('mailer_subjects_')) errors.push('invalid_subject_key')
  if (!entry.contentKey?.startsWith('mailer_templates_')) errors.push('invalid_content_key')
  if (!content.includes('<html lang="ko">')) errors.push('korean_document_missing')
  for (const placeholder of entry.requiredPlaceholders ?? []) {
    if (!content.includes(placeholder)) errors.push(`placeholder_missing:${placeholder}`)
  }
  if (/<script\b/i.test(content)) errors.push('script_not_allowed')
  if (/(?:src|href)=["']https?:\/\//i.test(content)) errors.push('external_resource_not_allowed')
  if (/tracking|pixel|utm_/i.test(content)) errors.push('tracking_not_allowed')
  return {
    ...entry,
    content,
    bytes: Buffer.byteLength(content),
    hash: createHash('sha256').update(content).digest('hex').slice(0, 12),
    errors,
  }
}))

const validationErrors = templates.flatMap(template => template.errors.map(error => `${template.id}:${error}`))
if (validationErrors.length > 0) throw new Error(`인증 메일 템플릿 검증 실패: ${validationErrors.join(', ')}`)

const env = await readEnv()
const supabaseUrl = env.VITE_SUPABASE_URL
const accessToken = process.env.SUPABASE_ACCESS_TOKEN || env.SUPABASE_ACCESS_TOKEN
const projectRef = supabaseUrl && !supabaseUrl.includes('your-') ? new URL(supabaseUrl).hostname.split('.')[0] : ''
const endpoint = projectRef ? `https://api.supabase.com/v1/projects/${projectRef}/config/auth` : ''
let remoteConfig = null
let remoteCheck = endpoint && accessToken ? 'pending' : 'not_configured'

if (endpoint && accessToken) {
  try {
    const response = await fetch(endpoint, { headers: { Authorization: `Bearer ${accessToken}` } })
    if (!response.ok) throw new Error(`Auth 설정 조회 실패 (${response.status})`)
    remoteConfig = await response.json()
    remoteCheck = 'completed'
  } catch (error) {
    if (mode === 'apply') throw error
    remoteCheck = 'unavailable'
  }
}

const payload = Object.fromEntries(templates.flatMap(template => [
  [template.subjectKey, template.subject],
  [template.contentKey, template.content],
]))

const safeResponseError = async response => {
  try {
    const body = await response.json()
    const message = [body?.message, body?.error, body?.code].find(value => typeof value === 'string')
    return message ? message.replace(/[\r\n]+/g, ' ').slice(0, 240) : 'details_unavailable'
  } catch {
    return 'details_unavailable'
  }
}

const status = templates.map(template => ({
  id: template.id,
  bytes: template.bytes,
  hash: template.hash,
  remote: remoteConfig ? (remoteConfig[template.subjectKey] === template.subject && remoteConfig[template.contentKey] === template.content ? 'in_sync' : 'different') : 'not_checked',
}))

if (mode === 'apply') {
  if (!endpoint || !accessToken) throw new Error('적용하려면 실제 Supabase URL과 SUPABASE_ACCESS_TOKEN이 필요합니다.')
  if (!remoteConfig?.smtp_host || !remoteConfig?.smtp_admin_email) {
    throw new Error('무료 프로젝트의 기본 메일러에는 커스텀 템플릿을 적용할 수 없습니다. 개발 Supabase에 Custom SMTP를 먼저 설정해 주세요.')
  }
  const expectedConfirmation = `${environment}:${projectRef}`
  if (process.env.AUTH_TEMPLATE_APPLY_CONFIRMATION !== expectedConfirmation) {
    throw new Error(`적용 확인값이 필요합니다: AUTH_TEMPLATE_APPLY_CONFIRMATION=${expectedConfirmation}`)
  }
  const response = await fetch(endpoint, {
    method: 'PATCH',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
  if (!response.ok) throw new Error(`Auth 메일 템플릿 적용 실패 (${response.status}: ${await safeResponseError(response)})`)
}

console.log(JSON.stringify({
  environment,
  mode,
  projectConfigured: Boolean(projectRef),
  remoteChecked: Boolean(remoteConfig),
  remoteCheck,
  customSmtpConfigured: Boolean(remoteConfig?.smtp_host && remoteConfig?.smtp_admin_email),
  applied: mode === 'apply',
  templates: status,
}, null, 2))
