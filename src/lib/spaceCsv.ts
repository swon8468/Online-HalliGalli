import type { CreatedCredential, SpaceAccountInput } from './spaces'

export interface CsvPreviewRow extends SpaceAccountInput {
  row: number
  included: boolean
  errors: string[]
}

export const SPACE_CSV_TEMPLATE = serializeCsv([['email', 'nickname', 'role', 'external_id'], ['member@example.org', '홍길동', 'member', 'A-001']])

function parseCells(source: string) {
  const rows: string[][] = []
  let row: string[] = [], cell = '', quoted = false
  const text = source.replace(/^\uFEFF/, '')
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index]
    if (quoted) {
      if (character === '"' && text[index + 1] === '"') { cell += '"'; index += 1 }
      else if (character === '"') quoted = false
      else cell += character
      continue
    }
    if (character === '"' && cell.length === 0) quoted = true
    else if (character === ',') { row.push(cell); cell = '' }
    else if (character === '\n') { row.push(cell); rows.push(row); row = []; cell = '' }
    else if (character !== '\r') cell += character
  }
  if (quoted) throw new Error('따옴표가 닫히지 않은 CSV입니다.')
  if (cell.length || row.length) { row.push(cell); rows.push(row) }
  return rows.filter(values => values.some(value => value.trim()))
}

const aliases: Record<string, string> = {
  email: 'email', 이메일: 'email', nickname: 'nickname', name: 'nickname', 닉네임: 'nickname', 이름: 'nickname',
  role: 'role', 역할: 'role', externalid: 'externalId', external_id: 'externalId', 사번: 'externalId', 학번: 'externalId',
  password: 'password', 비밀번호: 'password',
}

function validEmail(value: string) { return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value) }

export function parseSpaceAccountsCsv(source: string, allowedDomains: string[]): CsvPreviewRow[] {
  const values = parseCells(source)
  if (!values.length) return []
  if (values.length - 1 > 100) throw new Error('CSV는 한 번에 최대 100행까지 등록할 수 있습니다.')
  const headers = values[0].map(value => aliases[value.trim().toLowerCase().replaceAll(' ', '')] ?? '')
  if (!headers.includes('email') || !headers.includes('nickname')) throw new Error('CSV 첫 행에 email과 nickname 열이 필요합니다.')
  const rows = values.slice(1).map((cells, index) => {
    const record: Record<string, string> = {}
    headers.forEach((header, position) => { if (header) record[header] = cells[position]?.trim() ?? '' })
    const email = (record.email ?? '').toLowerCase(), nickname = record.nickname ?? ''
    const role: 'member' | 'manager' = record.role === 'manager' || record.role === '관리자' ? 'manager' : 'member'
    return { row: index + 2, email, nickname, role, externalId: record.externalId || undefined, password: record.password || undefined, included: true, errors: [] }
  })
  return validateSpaceAccountRows(rows, allowedDomains)
}

export function validateSpaceAccountRows(rows: CsvPreviewRow[], allowedDomains: string[]) {
  const seen = new Set<string>()
  return rows.map(row => {
    const email = row.email.trim().toLowerCase(), errors: string[] = []
    if (!validEmail(email)) errors.push('이메일 형식 오류')
    if (row.nickname.trim().length < 2 || row.nickname.trim().length > 12) errors.push('표시 이름은 2~12자')
    if (allowedDomains.length && !allowedDomains.some(domain => email.endsWith(domain))) errors.push('허용 도메인 불일치')
    if (seen.has(email)) errors.push('파일 내 이메일 중복')
    if (row.password && row.password.length < 12) errors.push('비밀번호는 12자 이상')
    seen.add(email)
    return { ...row, email, nickname: row.nickname.trim(), included: errors.length ? false : row.included, errors }
  })
}

function escapeCell(value: unknown) {
  const text = String(value ?? '')
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text
}

export function serializeCsv(rows: Array<Array<unknown>>) { return `\uFEFF${rows.map(row => row.map(escapeCell).join(',')).join('\r\n')}\r\n` }

export function credentialsCsv(credentials: CreatedCredential[]) {
  return serializeCsv([
    ['email', 'nickname', 'role', 'temporary_password'],
    ...credentials.map(item => [item.email, item.nickname ?? '', item.role ?? 'member', item.password ?? '']),
  ])
}

export function downloadTextFile(filename: string, contents: string, type = 'text/csv;charset=utf-8') {
  const url = URL.createObjectURL(new Blob([contents], { type }))
  const anchor = document.createElement('a')
  anchor.href = url; anchor.download = filename; anchor.click()
  window.setTimeout(() => URL.revokeObjectURL(url), 0)
}
