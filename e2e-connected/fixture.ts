import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { createClient } from '@supabase/supabase-js'

const e2eEnvironment = process.env.E2E_ENVIRONMENT === 'production' ? 'production' : 'development'

export const accounts = e2eEnvironment === 'production'
  ? [
      { email: 'e2e-browser-prod-host@swonport.kr', nickname: '운영E2E방장', role: 'super_admin' },
      { email: 'e2e-browser-prod-guest@swonport.kr', nickname: '운영E2E참가자', role: 'player' },
    ]
  : [
      { email: 'e2e-browser-host@swonport.kr', nickname: 'E2E방장', role: 'super_admin' },
      { email: 'e2e-browser-guest@swonport.kr', nickname: 'E2E참가자', role: 'player' },
    ]

export const spaceManagerAccount = e2eEnvironment === 'production'
  ? { email: 'e2e-space-manager-prod@swonport.kr', nickname: '운영스페이스관리자' }
  : { email: 'e2e-space-manager@swonport.kr', nickname: '스페이스관리자' }

const fixtureEmails = new Set([...accounts.map(account => account.email), spaceManagerAccount.email])

function parseEnv(source: string) {
  return Object.fromEntries(source.split(/\r?\n/).flatMap(line => {
    const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/)
    return match ? [[match[1], match[2].replace(/^(['"])(.*)\1$/, '$2')]] : []
  }))
}

let connectedEnvironmentPromise: ReturnType<typeof loadConnectedEnvironment> | null = null

async function loadConnectedEnvironment() {
  const fileEnv = parseEnv(await readFile(`.env.${e2eEnvironment}`, 'utf8'))
  const url = process.env.TEST_SUPABASE_URL || fileEnv.VITE_SUPABASE_URL
  const anon = process.env.TEST_SUPABASE_ANON_KEY || fileEnv.VITE_SUPABASE_ANON_KEY
  const accessToken = process.env.SUPABASE_ACCESS_TOKEN || fileEnv.SUPABASE_ACCESS_TOKEN
  if (!url || !anon || !accessToken) throw new Error(`연결형 E2E에는 ${e2eEnvironment} Supabase URL, anon key, access token이 필요합니다.`)
  const password = process.env.TEST_USER_PASSWORD || `Browser-${createHash('sha256').update(accessToken).digest('hex').slice(0, 18)}!`
  const projectRef = new URL(url).hostname.split('.')[0]
  if (e2eEnvironment === 'production' && process.env.PRODUCTION_E2E_CONFIRMATION !== `production:${projectRef}`) {
    throw new Error(`운영 E2E 확인값이 필요합니다: PRODUCTION_E2E_CONFIRMATION=production:${projectRef}`)
  }
  let response: Response | null = null
  let lastError: unknown
  for (let attempt = 0; attempt < 4; attempt += 1) {
    try {
      response = await fetch(`https://api.supabase.com/v1/projects/${projectRef}/api-keys?reveal=true`, { headers: { Authorization: `Bearer ${accessToken}` } })
      if (response.ok || response.status < 500) break
      lastError = new Error(`${e2eEnvironment} 프로젝트 키 조회 실패 (${response.status})`)
    } catch (error) { lastError = error }
    await new Promise(resolve => setTimeout(resolve, Math.min(500 * (2 ** attempt), 4_000)))
  }
  if (!response) throw lastError ?? new Error(`${e2eEnvironment} 프로젝트 키 조회 실패`)
  if (!response.ok) throw new Error(`${e2eEnvironment} 프로젝트 키 조회 실패 (${response.status})`)
  const serviceKey = (await response.json()).find((key: { name?: string }) => key.name === 'service_role') as { api_key?: string; value?: string } | undefined
  const service = serviceKey?.api_key ?? serviceKey?.value
  if (!service) throw new Error(`${e2eEnvironment} service role 키를 찾지 못했습니다.`)
  return { url, anon, password, admin: createClient(url, service, { auth: { persistSession: false, autoRefreshToken: false } }) }
}

export function connectedEnvironment() {
  connectedEnvironmentPromise ??= loadConnectedEnvironment().catch(error => {
    connectedEnvironmentPromise = null
    throw error
  })
  return connectedEnvironmentPromise
}

export async function clearConnectedSessions() {
  const { admin } = await connectedEnvironment()
  const listed = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 })
  if (listed.error) throw listed.error
  const ids = listed.data.users.filter(user => accounts.some(account => account.email === user.email)).map(user => user.id)
  if (!ids.length) return
  const queues = await admin.from('matchmaking_queue').delete().in('user_id', ids)
  if (queues.error) throw queues.error
  const rooms = await admin.from('rooms').delete().in('host_id', ids)
  if (rooms.error) throw rooms.error
}

async function deleteTestUser(admin: Awaited<ReturnType<typeof connectedEnvironment>>['admin'], userId: string) {
  let lastError: unknown
  const maxAttempts = 7
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    try {
      const removed = await admin.auth.admin.deleteUser(userId)
      if (!removed.error) return
      lastError = removed.error
    } catch (error) { lastError = error }

    await new Promise(resolve => setTimeout(resolve, Math.min(500 * (2 ** attempt), 5_000)))

    // A retryable transport error can happen after Auth accepted the deletion.
    // Confirm absence before sending another destructive request.
    try {
      const lookup = await admin.auth.admin.getUserById(userId)
      if (lookup.error && lookup.error.status === 404) return
    } catch {
      // The Auth endpoint is still unavailable; the next bounded retry handles it.
    }
  }
  throw lastError ?? new Error('연결형 E2E 계정을 삭제하지 못했습니다.')
}

export async function removeConnectedFixtures() {
  const { admin } = await connectedEnvironment()
  const listed = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 })
  if (listed.error) throw listed.error
  const users = listed.data.users.filter(user => Boolean(user.email && fixtureEmails.has(user.email)))
  if (users.length) {
    const ids = users.map(user => user.id)
    const spaces = await admin.from('spaces').select('id').in('created_by', ids)
    if (spaces.error) throw spaces.error
    const spaceIds = spaces.data.map(space => space.id)
    // actor_id is RESTRICT, so every audit row authored by the fixture admin
    // must be removed. Do not combine this with target filters (that would use
    // AND and leave unrelated fixture audit rows behind).
    const removedActorAudit = await admin.from('moderation_actions').delete().in('actor_id', ids)
    if (removedActorAudit.error) throw removedActorAudit.error
    if (spaceIds.length) {
      const removedSpaceAudit = await admin.from('moderation_actions').delete().in('target_space_id', spaceIds)
      if (removedSpaceAudit.error) throw removedSpaceAudit.error
    }
    const rooms = await admin.from('rooms').select('id').in('host_id', ids)
    if (rooms.error) throw rooms.error
    if (rooms.data.length) {
      const removedRooms = await admin.from('rooms').delete().in('id', rooms.data.map(room => room.id))
      if (removedRooms.error) throw removedRooms.error
    }
    const removedCardSets = await admin.from('card_sets').delete().in('created_by', ids).eq('is_platform_default', false)
    if (removedCardSets.error) throw removedCardSets.error
    if (spaceIds.length) {
      const removedSpaces = await admin.from('spaces').delete().in('id', spaceIds)
      if (removedSpaces.error) throw removedSpaces.error
    }
    for (const user of users) {
      await deleteTestUser(admin, user.id)
    }
  }
}

export async function assertConnectedFixturesRemoved() {
  const { admin } = await connectedEnvironment()
  const listed = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 })
  if (listed.error) throw listed.error
  const leftovers = listed.data.users.filter(user => Boolean(user.email && fixtureEmails.has(user.email)))
  if (leftovers.length) throw new Error(`연결형 E2E 계정 ${leftovers.length}개가 정리되지 않았습니다.`)
}
