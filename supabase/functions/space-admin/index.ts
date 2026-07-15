import { createClient, type SupabaseClient, type User } from 'npm:@supabase/supabase-js@2.95.0'
import { diagnosticBody, diagnosticHeaders, logEdgeFailure } from '../_shared/diagnostics.ts'

type SpaceRole = 'member' | 'manager' | 'owner'
type SpaceStatus = 'draft' | 'active' | 'suspended' | 'archived'
type AccountInput = { email?: string; nickname?: string; password?: string; role?: 'member' | 'manager'; externalId?: string }
type SpaceRecord = Record<string, unknown> & {
  id: string; name: string; slug: string; status: SpaceStatus; join_code: string; join_enabled: boolean
  allowed_email_domains: string[]; created_at: string
}
type Action =
  | 'check_slug' | 'create_space' | 'snapshot' | 'members_page' | 'rooms_page' | 'games_page' | 'cards_page' | 'audit_page'
  | 'update_space' | 'rotate_join_code' | 'add_existing' | 'update_member' | 'remove_member' | 'transfer_owner'
  | 'create_account' | 'bulk_create_accounts' | 'update_account' | 'reset_password' | 'suspend_account'
  | 'reactivate_account' | 'delete_account' | 'bulk_update_members' | 'close_room'

type Payload = AccountInput & {
  action?: Action
  requestId?: string
  spaceId?: string
  slug?: string
  name?: string
  description?: string
  status?: SpaceStatus
  joinEnabled?: boolean
  joinPolicy?: 'code' | 'invite_only' | 'closed'
  joinCodeExpiresAt?: string | null
  emailDomains?: string[]
  managerMode?: 'none' | 'create' | 'existing'
  managerEmail?: string
  managerNickname?: string
  managerPassword?: string
  targetUserId?: string
  targetRoomId?: string
  reason?: string
  accounts?: AccountInput[]
  page?: number
  pageSize?: number
  search?: string
  roleFilter?: SpaceRole | 'all'
  statusFilter?: string
  kindFilter?: 'managed' | 'existing' | 'all'
  sort?: string
  force?: boolean
  items?: Array<{ userId?: string; operation?: 'role' | 'remove' | 'suspend'; role?: 'member' | 'manager' }>
}

class ApiError extends Error {
  constructor(public code: string, public status = 400) { super(code) }
}

const origins = (Deno.env.get('ALLOWED_ORIGINS') ?? 'https://develop.haligali.swonport.kr,https://haligali.swonport.kr,https://develop.admin.haligali.swonport.kr,https://admin.haligali.swonport.kr')
  .split(',').map(value => value.trim()).filter(Boolean)
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const sensitiveActions = new Set<Action>([
  'create_space', 'update_space', 'rotate_join_code', 'add_existing', 'update_member', 'remove_member', 'transfer_owner',
  'create_account', 'bulk_create_accounts', 'update_account', 'reset_password', 'suspend_account', 'reactivate_account',
  'delete_account', 'bulk_update_members', 'close_room',
])
const actionReasons: Partial<Record<Action, string>> = {
  create_space: '스페이스 생성', update_space: '스페이스 설정 변경', rotate_join_code: '가입 코드 재발급',
  add_existing: '기존 계정 연결', update_member: '멤버 역할 변경', remove_member: '스페이스 멤버 제외',
  transfer_owner: '스페이스 소유권 이전', create_account: '스페이스 관리 계정 생성',
  bulk_create_accounts: '스페이스 계정 일괄 생성', update_account: '스페이스 계정 정보 변경',
  reset_password: '스페이스 계정 비밀번호 재발급', suspend_account: '스페이스 계정 정지',
  reactivate_account: '스페이스 계정 재활성화', delete_account: '스페이스 관리 계정 삭제',
  bulk_update_members: '스페이스 멤버 일괄 작업', close_room: '스페이스 방 종료',
}

function isAllowedOrigin(origin: string) { return origins.includes(origin) || /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin) }
function headers(request: Request) {
  const origin = request.headers.get('Origin') ?? ''
  return {
    ...(isAllowedOrigin(origin) ? { 'Access-Control-Allow-Origin': origin } : {}),
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Vary': 'Origin', ...diagnosticHeaders(request),
  }
}
function response(request: Request, body: unknown, status = 200) { return Response.json(diagnosticBody(request, body), { status, headers: headers(request) }) }
function validSlug(value: string) { return /^[a-z0-9][a-z0-9-]{2,48}$/.test(value) }
function normalizeDomain(value: string) {
  const domain = value.trim().toLowerCase()
  return /^@[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/.test(domain) ? domain : null
}
function validEmail(value: string) {
  const normalized = value.trim().toLowerCase(), parts = normalized.split('@')
  return parts.length === 2 && Boolean(parts[0]) && !/\s/.test(parts[0]) && normalizeDomain(`@${parts[1]}`) === `@${parts[1]}`
}
function emailMatchesDomains(email: string, domains: string[]) { return !domains.length || domains.includes(`@${email.trim().toLowerCase().split('@')[1]}`) }
function randomJoinCode() { return crypto.randomUUID().replaceAll('-', '').slice(0, 8).toUpperCase() }
function randomPassword() { return `Hg-${crypto.randomUUID().replaceAll('-', '').slice(0, 18)}!` }
function pageValues(payload: Payload) {
  const page = Math.max(1, Math.min(100_000, Math.trunc(payload.page ?? 1)))
  const pageSize = Math.max(1, Math.min(50, Math.trunc(payload.pageSize ?? 25)))
  return { page, pageSize, from: (page - 1) * pageSize, to: page * pageSize - 1 }
}
function check(error: { message?: string } | null, code: string) { if (error) throw new ApiError(code, 500) }
function uniqueDomains(values: unknown) {
  if (!Array.isArray(values)) return []
  const domains = [...new Set(values.flatMap(value => typeof value === 'string' ? [normalizeDomain(value)] : []).filter((value): value is string => Boolean(value)))]
  if (domains.length > 10 || domains.length !== values.length) throw new ApiError('invalid_email_domain')
  return domains
}
async function sha256(value: string) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))
  return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('')
}
async function findUserByEmail(admin: SupabaseClient, email: string): Promise<User | null> {
  const normalized = email.trim().toLowerCase()
  if (!validEmail(normalized)) return null
  const registry = await admin.from('identity_registry').select('user_id').eq('email_hash', await sha256(normalized)).maybeSingle()
  check(registry.error, 'identity_lookup_failed')
  if (!registry.data?.user_id) return null
  const result = await admin.auth.admin.getUserById(registry.data.user_id)
  if (result.error) throw new ApiError('identity_lookup_failed', 500)
  return result.data.user
}

Deno.serve(async request => {
  const origin = request.headers.get('Origin') ?? ''
  if (origin && !isAllowedOrigin(origin)) return response(request, { error: 'origin_not_allowed' }, 403)
  if (request.method === 'OPTIONS') return response(request, { ok: true })
  if (request.method !== 'POST') return response(request, { error: 'method_not_allowed' }, 405)

  let admin: SupabaseClient | null = null
  let claimedRequestId: string | null = null
  try {
    const authorization = request.headers.get('Authorization')
    if (!authorization) throw new ApiError('unauthorized', 401)
    const url = Deno.env.get('SUPABASE_URL')!
    const caller = createClient(url, Deno.env.get('SUPABASE_ANON_KEY')!, { global: { headers: { Authorization: authorization } }, auth: { persistSession: false } })
    const authResult = await caller.auth.getUser()
    const user = authResult.data.user
    if (!user) throw new ApiError('unauthorized', 401)
    const activeRequest = await caller.rpc('enforce_active_profile_request')
    if (activeRequest.error) throw new ApiError(activeRequest.error.message.includes('session_invalidated') ? 'session_invalidated' : 'forbidden', 403)
    admin = createClient(url, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false, autoRefreshToken: false } })
    const payload = await request.json().catch(() => ({})) as Payload
    if (!payload.action) throw new ApiError('invalid_request')
    const action = payload.action
    const actorResult = await admin.from('profiles').select('id,nickname,platform_role,suspended_until,deleted_at').eq('id', user.id).maybeSingle()
    check(actorResult.error, 'load_actor')
    const actor = actorResult.data
    if (!actor || actor.deleted_at || (actor.suspended_until && new Date(actor.suspended_until) > new Date())) throw new ApiError('forbidden', 403)
    const isPlatformAdmin = ['admin', 'super_admin'].includes(actor.platform_role)
    const isSupport = actor.platform_role === 'support'

    async function claim(spaceId: string | null) {
      if (!sensitiveActions.has(action)) return
      if (!payload.requestId || !uuidPattern.test(payload.requestId)) throw new ApiError('action_id_required')
      const existing = await admin!.from('space_action_claims').select('status').eq('request_id', payload.requestId).maybeSingle()
      check(existing.error, 'action_claim_lookup_failed')
      if (existing.data) throw new ApiError(existing.data.status === 'started' ? 'action_in_progress' : 'action_already_processed', 409)
      const since = new Date(Date.now() - 60_000).toISOString()
      const recent = await admin!.from('space_action_claims').select('request_id', { count: 'exact', head: true }).eq('actor_id', user.id).eq('action', action).gte('created_at', since)
      check(recent.error, 'action_rate_lookup_failed')
      const limit = action === 'create_space' ? 10 : ['bulk_create_accounts', 'reset_password', 'delete_account'].includes(action) ? 5 : 20
      if ((recent.count ?? 0) >= limit) throw new ApiError('space_action_rate_limited', 429)
      const inserted = await admin!.from('space_action_claims').insert({ request_id: payload.requestId, actor_id: user.id, space_id: spaceId, action })
      if (inserted.error) throw new ApiError('action_already_processed', 409)
      claimedRequestId = payload.requestId
    }
    async function finishClaim(status: 'completed' | 'failed') {
      if (!claimedRequestId) return
      await admin!.from('space_action_claims').update({ status, completed_at: new Date().toISOString() }).eq('request_id', claimedRequestId)
    }
    async function success(body: Record<string, unknown> = {}) { await finishClaim('completed'); return response(request, { ok: true, ...body }) }
    async function audit(spaceId: string, auditAction: string, metadata: Record<string, unknown> = {}) {
      const written = await admin!.from('moderation_actions').insert({
        actor_id: user.id, target_space_id: spaceId, action: auditAction,
        reason: actionReasons[action] ?? '스페이스 관리자 작업', metadata,
      })
      check(written.error, 'write_audit')
    }

    if (action === 'check_slug') {
      if (!isPlatformAdmin) throw new ApiError('platform_admin_required', 403)
      const slug = payload.slug?.trim().toLowerCase() ?? ''
      if (!validSlug(slug)) throw new ApiError('invalid_space_slug')
      const [space, alias] = await Promise.all([
        admin.from('spaces').select('id').eq('slug', slug).maybeSingle(),
        admin.from('space_slug_aliases').select('space_id').eq('slug', slug).maybeSingle(),
      ])
      check(space.error ?? alias.error, 'slug_lookup_failed')
      return response(request, { ok: true, available: !space.data && !alias.data })
    }

    if (action === 'create_space') {
      if (!isPlatformAdmin) throw new ApiError('platform_admin_required', 403)
      await claim(null)
      const name = payload.name?.trim() ?? '', slug = payload.slug?.trim().toLowerCase() ?? ''
      if (name.length < 2 || name.length > 80 || !validSlug(slug)) throw new ApiError('invalid_space')
      const domains = uniqueDomains(payload.emailDomains ?? (payload.emailDomain ? [payload.emailDomain] : []))
      const managerMode = payload.managerMode ?? (payload.managerEmail ? 'create' : 'none')
      if (!['none', 'create', 'existing'].includes(managerMode)) throw new ApiError('invalid_manager_mode')
      const existingSlug = await Promise.all([
        admin.from('spaces').select('id').eq('slug', slug).maybeSingle(),
        admin.from('space_slug_aliases').select('space_id').eq('slug', slug).maybeSingle(),
      ])
      if (existingSlug.some(result => result.error)) throw new ApiError('slug_lookup_failed', 500)
      if (existingSlug.some(result => result.data)) throw new ApiError('space_slug_exists', 409)

      let manager: User | null = null, managerCreated = false, managerPassword: string | null = null
      if (managerMode !== 'none') {
        const email = payload.managerEmail?.trim().toLowerCase() ?? ''
        if (!validEmail(email) || !emailMatchesDomains(email, domains)) throw new ApiError('manager_email_domain_mismatch')
        manager = await findUserByEmail(admin, email)
        if (managerMode === 'existing' && !manager) throw new ApiError('user_not_found', 404)
        if (managerMode === 'create' && manager) throw new ApiError('space_manager_email_exists', 409)
        if (!manager) {
          const nickname = payload.managerNickname?.trim() ?? ''
          managerPassword = payload.managerPassword?.trim() || randomPassword()
          if (nickname.length < 2 || nickname.length > 12) throw new ApiError('invalid_manager_nickname')
          if (managerPassword.length < 12) throw new ApiError('weak_manager_password')
          const created = await admin.auth.admin.createUser({ email, password: managerPassword, email_confirm: true, user_metadata: { nickname }, app_metadata: { platform_role: 'player' } })
          if (created.error || !created.data.user) throw new ApiError('space_manager_creation_failed')
          manager = created.data.user; managerCreated = true
        }
      }

      let createdSpace: { id: string; slug: string; join_code: string } | null = null
      try {
        for (let attempt = 0; attempt < 10 && !createdSpace; attempt += 1) {
          const inserted = await admin.from('spaces').insert({
            name, slug, description: payload.description?.trim() || null, status: 'active', created_by: user.id,
            join_code: randomJoinCode(), join_enabled: payload.joinEnabled ?? true, join_policy: payload.joinPolicy ?? 'code',
            join_code_expires_at: payload.joinCodeExpiresAt || null, allowed_email_domain: domains[0] ?? null, allowed_email_domains: domains,
          }).select('id,slug,join_code').single()
          if (!inserted.error) createdSpace = inserted.data
          else if (!inserted.error.message.includes('spaces_join_code_key')) throw new ApiError(inserted.error.message.includes('spaces_slug_key') ? 'space_slug_exists' : 'space_creation_failed', inserted.error.message.includes('spaces_slug_key') ? 409 : 500)
        }
        if (!createdSpace) throw new ApiError('join_code_allocation_failed', 500)
        const memberships = [{ space_id: createdSpace.id, user_id: user.id, role: 'owner', invited_by: user.id }]
        if (manager) memberships.push({ space_id: createdSpace.id, user_id: manager.id, role: 'manager', invited_by: user.id })
        check((await admin.from('space_members').insert(memberships)).error, 'add_space_owners')
        const accountRows = [{
          space_id: createdSpace.id, user_id: user.id, account_kind: 'existing', status: 'active', created_by: user.id,
          must_change_password: false, last_managed_by: null, last_managed_at: null,
        }]
        if (manager) accountRows.push({
          space_id: createdSpace.id, user_id: manager.id, account_kind: managerCreated ? 'managed' : 'existing', status: 'active', created_by: user.id,
          must_change_password: managerCreated, last_managed_by: user.id, last_managed_at: new Date().toISOString(),
        })
        check((await admin.from('space_managed_accounts').upsert(accountRows, { onConflict: 'space_id,user_id' })).error, 'track_space_accounts')
        await audit(createdSpace.id, 'create_space', { manager_mode: managerMode, allowed_domain_count: domains.length })
        return await success({
          space: createdSpace,
          manager: manager ? { userId: manager.id, email: manager.email, nickname: payload.managerNickname?.trim() || null, role: 'manager', password: managerCreated ? managerPassword : null, created: managerCreated } : null,
        })
      } catch (error) {
        if (createdSpace) await admin.from('spaces').delete().eq('id', createdSpace.id)
        if (managerCreated && manager) await admin.auth.admin.deleteUser(manager.id)
        throw error
      }
    }

    let space: SpaceRecord | null = null
    if (payload.spaceId) {
      const loaded = await admin.from('spaces').select('*').eq('id', payload.spaceId).maybeSingle(); check(loaded.error, 'load_space'); space = loaded.data
    } else if (payload.slug) {
      const slug = payload.slug.trim().toLowerCase()
      const direct = await admin.from('spaces').select('*').eq('slug', slug).maybeSingle(); check(direct.error, 'load_space')
      space = direct.data
      if (!space) {
        const alias = await admin.from('space_slug_aliases').select('space_id').eq('slug', slug).maybeSingle(); check(alias.error, 'load_space_alias')
        if (alias.data) { const loaded = await admin.from('spaces').select('*').eq('id', alias.data.space_id).maybeSingle(); check(loaded.error, 'load_space'); space = loaded.data }
      }
    }
    if (!space) throw new ApiError('space_not_found', 404)
    const membership = await admin.from('space_members').select('role').eq('space_id', space.id).eq('user_id', user.id).maybeSingle()
    check(membership.error, 'load_actor_membership')
    const actorSpaceRole = membership.data?.role as SpaceRole | undefined
    const canView = isPlatformAdmin || isSupport || actorSpaceRole === 'owner' || actorSpaceRole === 'manager'
    const canManage = isPlatformAdmin || actorSpaceRole === 'owner' || actorSpaceRole === 'manager'
    const canOwn = isPlatformAdmin || actorSpaceRole === 'owner'
    const actorView = { id: user.id, platformRole: actor.platform_role, spaceRole: actorSpaceRole ?? null, canView, canManage, canOwn, piiMasked: isSupport && !isPlatformAdmin }
    if (!canView) {
      await admin.from('moderation_actions').insert({ actor_id: user.id, target_space_id: space.id, action: 'space_access_denied', reason: '관리 API 접근 거부', metadata: { requested_action: action } })
      throw new ApiError('space_manager_required', 403)
    }

    async function metrics() {
      const [members, rooms, activeRooms, games, finishedGames, cardSets, auditRows] = await Promise.all([
        admin!.from('space_members').select('user_id', { count: 'exact', head: true }).eq('space_id', space!.id),
        admin!.from('rooms').select('id', { count: 'exact', head: true }).eq('space_id', space!.id),
        admin!.from('rooms').select('id', { count: 'exact', head: true }).eq('space_id', space!.id).in('status', ['waiting', 'playing']),
        admin!.from('games').select('id,rooms!inner(space_id)', { count: 'exact', head: true }).eq('rooms.space_id', space!.id),
        admin!.from('games').select('id,rooms!inner(space_id)', { count: 'exact', head: true }).eq('rooms.space_id', space!.id).not('finished_at', 'is', null),
        admin!.from('card_sets').select('id', { count: 'exact', head: true }).eq('space_id', space!.id),
        admin!.from('moderation_actions').select('id', { count: 'exact', head: true }).eq('target_space_id', space!.id),
      ])
      const failure = [members, rooms, activeRooms, games, finishedGames, cardSets, auditRows].find(result => result.error)
      if (failure?.error) throw new ApiError('metrics_query_failed', 500)
      return { members: members.count ?? 0, rooms: rooms.count ?? 0, activeRooms: activeRooms.count ?? 0, games: games.count ?? 0, finishedGames: finishedGames.count ?? 0, cardSets: cardSets.count ?? 0, audit: auditRows.count ?? 0 }
    }

    if (action === 'snapshot') {
      const visibleSpace = actorView.piiMasked ? { ...space, join_code: null } : space
      return response(request, { ok: true, actor: actorView, data: { space: visibleSpace, metrics: await metrics() } })
    }

    if (action === 'members_page') {
      const { page, pageSize, from, to } = pageValues(payload)
      let memberQuery = admin.from('space_member_directory').select('*', { count: 'exact' }).eq('space_id', space.id)
      if (payload.roleFilter && payload.roleFilter !== 'all') memberQuery = memberQuery.eq('role', payload.roleFilter)
      if (payload.kindFilter && payload.kindFilter !== 'all') memberQuery = memberQuery.eq('account_kind', payload.kindFilter)
      if (payload.statusFilter === 'suspended') memberQuery = memberQuery.or(`account_status.eq.suspended,suspended_until.gt.${new Date().toISOString()}`)
      if (payload.statusFilter === 'active') memberQuery = memberQuery.eq('account_status', 'active').or(`suspended_until.is.null,suspended_until.lte.${new Date().toISOString()}`).is('deleted_at', null)
      if (payload.statusFilter === 'deleted') memberQuery = memberQuery.not('deleted_at', 'is', null)
      if (payload.search?.trim()) {
        const search = payload.search.trim()
        if (search.includes('@')) {
          const found = await findUserByEmail(admin, search)
          memberQuery = found ? memberQuery.eq('user_id', found.id) : memberQuery.eq('user_id', '00000000-0000-0000-0000-000000000000')
        } else {
          const safeSearch = search.replaceAll(',', '').replaceAll('%', '\\%')
          memberQuery = memberQuery.or(`student_or_employee_id.ilike.%${safeSearch}%,nickname.ilike.%${safeSearch}%`)
        }
      }
      memberQuery = payload.sort === 'oldest' ? memberQuery.order('joined_at', { ascending: true }) : memberQuery.order('joined_at', { ascending: false })
      const members = await memberQuery.range(from, to)
      check(members.error, 'load_members')
      const ids = (members.data ?? []).map(item => item.user_id)
      const identityMap = new Map<string, { email: string | null; phone: string | null; lastSignInAt: string | null }>()
      if (!actorView.piiMasked) {
        await Promise.all(ids.map(async id => {
          const loaded = await admin!.auth.admin.getUserById(id)
          if (!loaded.error && loaded.data.user) identityMap.set(id, { email: loaded.data.user.email ?? null, phone: loaded.data.user.phone ?? null, lastSignInAt: loaded.data.user.last_sign_in_at ?? null })
        }))
      }
      const rows = (members.data ?? []).map(member => {
        const identity = identityMap.get(member.user_id) ?? { email: null, phone: null, lastSignInAt: null }
        return { userId: member.user_id, nickname: member.nickname ?? '알 수 없음', friendTag: member.friend_tag ?? '-', email: identity.email, phone: identity.phone, lastSignInAt: identity.lastSignInAt, role: member.role, externalId: member.student_or_employee_id, joinedAt: member.joined_at, suspended: Boolean(member.suspended_until && new Date(member.suspended_until) > new Date()), deleted: Boolean(member.deleted_at), accountKind: member.account_kind, accountStatus: member.account_status, mustChangePassword: member.must_change_password, managedAt: member.managed_at, lastManagedAt: member.last_managed_at }
      })
      return response(request, { ok: true, actor: actorView, data: { items: rows, page, pageSize, total: members.count ?? 0 } })
    }

    if (action === 'rooms_page') {
      const { page, pageSize, from, to } = pageValues(payload)
      let query = admin.from('rooms').select('id,code,kind,status,host_id,max_players,card_set_id,created_at,updated_at', { count: 'exact' }).eq('space_id', space.id)
      if (payload.statusFilter && payload.statusFilter !== 'all') query = query.eq('status', payload.statusFilter)
      if (payload.search?.trim()) query = query.ilike('code', `%${payload.search.trim().replaceAll('%', '')}%`)
      const rooms = await query.order('updated_at', { ascending: false }).range(from, to)
      check(rooms.error, 'load_rooms')
      const ids = (rooms.data ?? []).map(item => item.id), hostIds = [...new Set((rooms.data ?? []).map(item => item.host_id))]
      const [members, games, hosts] = await Promise.all([
        ids.length ? admin.from('room_members').select('room_id,user_id,left_at,kicked_at').in('room_id', ids) : Promise.resolve({ data: [], error: null }),
        ids.length ? admin.from('games').select('id,room_id,started_at,finished_at,version').in('room_id', ids).order('started_at', { ascending: false }) : Promise.resolve({ data: [], error: null }),
        hostIds.length ? admin.from('profiles').select('id,nickname').in('id', hostIds) : Promise.resolve({ data: [], error: null }),
      ])
      const failure = [members, games, hosts].find(result => result.error); if (failure?.error) throw new ApiError('room_details_failed', 500)
      const hostMap = new Map((hosts.data ?? []).map(item => [item.id, item.nickname]))
      return response(request, { ok: true, actor: actorView, data: { items: (rooms.data ?? []).map(room => ({ ...room, host_nickname: hostMap.get(room.host_id) ?? '알 수 없음', participant_count: (members.data ?? []).filter(item => item.room_id === room.id && !item.left_at && !item.kicked_at).length, latest_game: (games.data ?? []).find(game => game.room_id === room.id) ?? null })), page, pageSize, total: rooms.count ?? 0 } })
    }

    if (action === 'games_page') {
      const { page, pageSize, from, to } = pageValues(payload)
      let query = admin.from('games').select('id,room_id,started_at,finished_at,version,state,rooms!inner(space_id,code,status)', { count: 'exact' }).eq('rooms.space_id', space.id)
      if (payload.statusFilter === 'finished') query = query.not('finished_at', 'is', null)
      if (payload.statusFilter === 'active') query = query.is('finished_at', null)
      const games = await query.order('started_at', { ascending: false }).range(from, to)
      check(games.error, 'load_games')
      return response(request, { ok: true, actor: actorView, data: { items: games.data ?? [], page, pageSize, total: games.count ?? 0 } })
    }

    if (action === 'cards_page') {
      const { page, pageSize, from, to } = pageValues(payload)
      let query = admin.from('card_sets').select('id,name,status,version,is_platform_default,space_id,updated_at', { count: 'exact' }).or(`space_id.eq.${space.id},is_platform_default.eq.true`)
      if (payload.search?.trim()) query = query.ilike('name', `%${payload.search.trim().replaceAll('%', '')}%`)
      const cards = await query.order('updated_at', { ascending: false }).range(from, to)
      check(cards.error, 'load_card_sets')
      return response(request, { ok: true, actor: actorView, data: { items: cards.data ?? [], page, pageSize, total: cards.count ?? 0 } })
    }

    if (action === 'audit_page') {
      const { page, pageSize, from, to } = pageValues(payload)
      let query = admin.from('moderation_actions').select('id,actor_id,action,reason,metadata,created_at,profiles:profiles!moderation_actions_actor_id_fkey(nickname)', { count: 'exact' }).eq('target_space_id', space.id)
      if (payload.search?.trim()) query = query.ilike('action', `%${payload.search.trim().replaceAll('%', '')}%`)
      const events = await query.order('created_at', { ascending: false }).range(from, to)
      check(events.error, 'load_audit')
      return response(request, { ok: true, actor: actorView, data: { items: events.data ?? [], page, pageSize, total: events.count ?? 0 } })
    }

    if (!canManage) throw new ApiError('space_manager_required', 403)
    if (space.status === 'archived' && !['update_space'].includes(action)) throw new ApiError('space_archived', 409)

    async function targetContext(targetUserId: string) {
      const [membershipResult, accountResult] = await Promise.all([
        admin!.from('space_members').select('user_id,role,student_or_employee_id,invited_by,joined_at').eq('space_id', space!.id).eq('user_id', targetUserId).maybeSingle(),
        admin!.from('space_managed_accounts').select('*').eq('space_id', space!.id).eq('user_id', targetUserId).maybeSingle(),
      ])
      check(membershipResult.error ?? accountResult.error, 'load_target')
      if (!membershipResult.data) throw new ApiError('member_not_found', 404)
      const targetRole = membershipResult.data.role as SpaceRole
      if (targetRole === 'owner') throw new ApiError('cannot_modify_owner', 409)
      if (targetUserId === user.id) throw new ApiError('cannot_modify_self', 409)
      if (targetRole === 'manager' && !canOwn) throw new ApiError('space_owner_required', 403)
      return { membership: membershipResult.data, account: accountResult.data ?? { account_kind: 'existing', status: 'active', must_change_password: false } }
    }
    async function activeSession(targetUserId: string) {
      const rooms = await admin!.from('room_members').select('room_id,rooms!inner(space_id,status)').eq('user_id', targetUserId).is('left_at', null).is('kicked_at', null).eq('rooms.space_id', space!.id).in('rooms.status', ['waiting', 'playing'])
      check(rooms.error, 'load_active_sessions')
      return rooms.data ?? []
    }

    await claim(space.id)

    if (action === 'update_space') {
      const next: Record<string, unknown> = { updated_at: new Date().toISOString() }
      if (payload.name !== undefined) { const name = payload.name.trim(); if (name.length < 2 || name.length > 80) throw new ApiError('invalid_space_name'); next.name = name }
      if (payload.description !== undefined) next.description = payload.description.trim() || null
      const ownerFieldsRequested = payload.slug !== undefined || payload.status !== undefined || payload.joinEnabled !== undefined || payload.joinPolicy !== undefined || payload.joinCodeExpiresAt !== undefined || payload.emailDomains !== undefined
      if (ownerFieldsRequested && !canOwn) throw new ApiError('space_owner_required', 403)
      if (payload.slug !== undefined) {
        const slug = payload.slug.trim().toLowerCase(); if (!validSlug(slug)) throw new ApiError('invalid_space_slug')
        if (slug !== space.slug) {
          const [direct, alias] = await Promise.all([admin.from('spaces').select('id').eq('slug', slug).maybeSingle(), admin.from('space_slug_aliases').select('space_id').eq('slug', slug).maybeSingle()])
          if (direct.data || alias.data) throw new ApiError('space_slug_exists', 409)
          check((await admin.from('space_slug_aliases').insert({ slug: space.slug, space_id: space.id })).error, 'store_slug_alias')
          next.slug = slug
        }
      }
      if (payload.status !== undefined) { next.status = payload.status; next.archived_at = payload.status === 'archived' ? new Date().toISOString() : null }
      if (payload.joinEnabled !== undefined) next.join_enabled = payload.joinEnabled
      if (payload.joinPolicy !== undefined) next.join_policy = payload.joinPolicy
      if (payload.joinCodeExpiresAt !== undefined) next.join_code_expires_at = payload.joinCodeExpiresAt
      if (payload.emailDomains !== undefined) { const domains = uniqueDomains(payload.emailDomains); next.allowed_email_domains = domains; next.allowed_email_domain = domains[0] ?? null }
      check((await admin.from('spaces').update(next).eq('id', space.id)).error, 'update_space')
      await audit(space.id, payload.status === 'archived' ? 'archive_space' : payload.status === 'active' && space.status === 'archived' ? 'restore_space' : 'update_space', { fields: Object.keys(next).filter(key => key !== 'updated_at') })
      return await success()
    }

    if (action === 'rotate_join_code') {
      if (!canOwn) throw new ApiError('space_owner_required', 403)
      let joinCode = ''
      for (let attempt = 0; attempt < 10 && !joinCode; attempt += 1) {
        const candidate = randomJoinCode(), update = await admin.from('spaces').update({ join_code: candidate, join_code_expires_at: payload.joinCodeExpiresAt ?? null, updated_at: new Date().toISOString() }).eq('id', space.id)
        if (!update.error) joinCode = candidate
        else if (!update.error.message.includes('spaces_join_code_key')) throw new ApiError('join_code_rotation_failed', 500)
      }
      if (!joinCode) throw new ApiError('join_code_allocation_failed', 500)
      await audit(space.id, 'update_space', { rotated_join_code: true, expires: Boolean(payload.joinCodeExpiresAt) })
      return await success({ joinCode })
    }

    if (action === 'add_existing') {
      const email = payload.email?.trim().toLowerCase() ?? ''
      if (!validEmail(email)) throw new ApiError('email_required')
      const domains = space.allowed_email_domains ?? []
      if (!emailMatchesDomains(email, domains)) throw new ApiError('space_email_domain_required', 403)
      const target = await findUserByEmail(admin, email)
      if (!target) throw new ApiError('user_not_found', 404)
      const role: SpaceRole = payload.role === 'manager' ? 'manager' : 'member'
      if (role === 'manager' && !canOwn) throw new ApiError('space_owner_required', 403)
      check((await admin.from('space_members').upsert({ space_id: space.id, user_id: target.id, role, invited_by: user.id, student_or_employee_id: payload.externalId?.trim() || null }, { onConflict: 'space_id,user_id' })).error, 'add_member')
      check((await admin.from('space_managed_accounts').upsert({ space_id: space.id, user_id: target.id, account_kind: 'existing', status: 'active', created_by: user.id, updated_at: new Date().toISOString() }, { onConflict: 'space_id,user_id' })).error, 'track_existing_account')
      await audit(space.id, 'add_space_member', { target_user_id: target.id, role, account_kind: 'existing' })
      return await success({ userId: target.id })
    }

    if (action === 'transfer_owner') {
      if (!canOwn || !payload.targetUserId) throw new ApiError(!payload.targetUserId ? 'target_required' : 'space_owner_required', !payload.targetUserId ? 400 : 403)
      await targetContext(payload.targetUserId)
      const transferred = await caller.rpc('transfer_space_ownership', { p_space_id: space.id, p_target_user_id: payload.targetUserId })
      if (transferred.error) throw new ApiError(transferred.error.message.includes('space_owner_required') ? 'space_owner_required' : 'ownership_transfer_failed', transferred.error.message.includes('space_owner_required') ? 403 : 500)
      await audit(space.id, 'transfer_space_owner', { target_user_id: payload.targetUserId })
      return await success()
    }

    if (action === 'update_member') {
      if (!payload.targetUserId) throw new ApiError('target_required')
      const target = await targetContext(payload.targetUserId)
      const role: SpaceRole = payload.role === 'manager' ? 'manager' : 'member'
      if ((role === 'manager' || target.membership.role === 'manager') && !canOwn) throw new ApiError('space_owner_required', 403)
      check((await admin.from('space_members').update({ role }).eq('space_id', space.id).eq('user_id', payload.targetUserId)).error, 'update_member')
      await audit(space.id, 'change_space_role', { target_user_id: payload.targetUserId, from: target.membership.role, to: role })
      return await success()
    }

    if (action === 'remove_member') {
      if (!payload.targetUserId) throw new ApiError('target_required')
      await targetContext(payload.targetUserId)
      const sessions = await activeSession(payload.targetUserId)
      if (sessions.some(item => (Array.isArray(item.rooms) ? item.rooms[0] : item.rooms)?.status === 'playing')) throw new ApiError('member_active_game', 409)
      if (sessions.length && !payload.force) throw new ApiError('member_active_session', 409)
      if (sessions.length) {
        check((await admin.from('room_members').update({ left_at: new Date().toISOString(), disconnected_at: new Date().toISOString(), seat: null, is_ready: false }).eq('user_id', payload.targetUserId).in('room_id', sessions.map(item => item.room_id))).error, 'revoke_room_sessions')
      }
      await admin.from('matchmaking_queue').delete().eq('user_id', payload.targetUserId)
      await admin.from('game_invites').update({ status: 'cancelled', updated_at: new Date().toISOString() }).eq('receiver_id', payload.targetUserId).eq('status', 'pending')
      check((await admin.from('space_members').delete().eq('space_id', space.id).eq('user_id', payload.targetUserId)).error, 'remove_member')
      await audit(space.id, 'remove_space_member', { target_user_id: payload.targetUserId, revoked_waiting_sessions: sessions.length })
      return await success()
    }

    async function createManaged(input: AccountInput) {
      const email = input.email?.trim().toLowerCase() ?? '', nickname = input.nickname?.trim() ?? ''
      if (!validEmail(email) || nickname.length < 2 || nickname.length > 12) throw new ApiError('invalid_account')
      if (!emailMatchesDomains(email, space.allowed_email_domains ?? [])) throw new ApiError('space_email_domain_required', 403)
      const role: SpaceRole = input.role === 'manager' ? 'manager' : 'member'
      if (role === 'manager' && !canOwn) throw new ApiError('space_owner_required', 403)
      if (await findUserByEmail(admin!, email)) throw new ApiError('account_already_exists', 409)
      const password = input.password?.trim() || randomPassword()
      if (password.length < 12) throw new ApiError('weak_password')
      const created = await admin!.auth.admin.createUser({ email, password, email_confirm: true, user_metadata: { nickname }, app_metadata: { platform_role: 'player' } })
      if (created.error || !created.data.user) throw new ApiError('account_creation_failed', 500)
      const target = created.data.user
      try {
        check((await admin!.from('space_members').insert({ space_id: space.id, user_id: target.id, role, invited_by: user.id, student_or_employee_id: input.externalId?.trim() || null })).error, 'attach_member')
        check((await admin!.from('space_managed_accounts').insert({ space_id: space.id, user_id: target.id, account_kind: 'managed', status: 'active', must_change_password: true, created_by: user.id, last_managed_by: user.id, last_managed_at: new Date().toISOString() })).error, 'track_managed_account')
        return { userId: target.id, email, nickname, role, password, created: true }
      } catch (error) { await admin!.auth.admin.deleteUser(target.id); throw error }
    }

    if (action === 'create_account') {
      const account = await createManaged(payload)
      await audit(space.id, 'add_space_member', { target_user_id: account.userId, role: account.role, account_kind: 'managed' })
      return await success({ account })
    }

    if (action === 'bulk_create_accounts') {
      if (!Array.isArray(payload.accounts) || payload.accounts.length < 1 || payload.accounts.length > 100) throw new ApiError('invalid_bulk_size')
      const seen = new Set<string>(), failures: Array<{ row: number; error: string }> = []
      for (const [index, input] of payload.accounts.entries()) {
        const email = input.email?.trim().toLowerCase() ?? '', nickname = input.nickname?.trim() ?? ''
        let error = ''
        if (!validEmail(email) || nickname.length < 2 || nickname.length > 12) error = 'invalid_account'
        else if (!emailMatchesDomains(email, space.allowed_email_domains ?? [])) error = 'space_email_domain_required'
        else if (seen.has(email)) error = 'duplicate_bulk_email'
        else if (input.role === 'manager' && !canOwn) error = 'space_owner_required'
        else if (input.password?.trim() && input.password.trim().length < 12) error = 'weak_password'
        else if (await findUserByEmail(admin, email)) error = 'account_already_exists'
        seen.add(email); if (error) failures.push({ row: index + 1, error })
      }
      if (failures.length) throw new ApiError(`bulk_validation_failed:${JSON.stringify(failures)}`)
      const results: Awaited<ReturnType<typeof createManaged>>[] = []
      try {
        for (const input of payload.accounts) results.push(await createManaged(input))
      } catch {
        for (const result of results.reverse()) await admin.auth.admin.deleteUser(result.userId)
        throw new ApiError('bulk_operation_failed', 500)
      }
      await audit(space.id, 'bulk_create_space_members', { requested: payload.accounts.length, created: results.length })
      return await success({ accounts: results, failures: [], policy: 'atomic' })
    }

    if (['update_account', 'reset_password', 'suspend_account', 'reactivate_account', 'delete_account'].includes(action)) {
      if (!payload.targetUserId) throw new ApiError('target_required')
      const target = await targetContext(payload.targetUserId)
      if (target.account.account_kind !== 'managed') throw new ApiError('existing_account_protected', 409)
      if (action === 'update_account') {
        const updates: Record<string, unknown> = {}
        if (payload.nickname !== undefined) { const nickname = payload.nickname.trim(); if (nickname.length < 2 || nickname.length > 12) throw new ApiError('invalid_account'); updates.nickname = nickname }
        if (Object.keys(updates).length) check((await admin.from('profiles').update(updates).eq('id', payload.targetUserId)).error, 'update_managed_profile')
        if (payload.externalId !== undefined) check((await admin.from('space_members').update({ student_or_employee_id: payload.externalId.trim() || null }).eq('space_id', space.id).eq('user_id', payload.targetUserId)).error, 'update_external_id')
        check((await admin.from('space_managed_accounts').update({ last_managed_by: user.id, last_managed_at: new Date().toISOString(), updated_at: new Date().toISOString() }).eq('space_id', space.id).eq('user_id', payload.targetUserId)).error, 'track_account_update')
        await audit(space.id, 'space_account_update', { target_user_id: payload.targetUserId, fields: [...Object.keys(updates), ...(payload.externalId !== undefined ? ['external_id'] : [])] })
        return await success()
      }
      if (action === 'reset_password') {
        const password = randomPassword(), invalidAfter = new Date(Math.floor(Date.now() / 1000) * 1000).toISOString()
        const updated = await admin.auth.admin.updateUserById(payload.targetUserId, { password })
        if (updated.error) throw new ApiError('password_reset_failed', 500)
        check((await admin.from('profiles').update({ session_invalid_after: invalidAfter }).eq('id', payload.targetUserId)).error, 'invalidate_sessions')
        check((await admin.from('space_managed_accounts').update({ must_change_password: true, last_managed_by: user.id, last_managed_at: new Date().toISOString(), updated_at: new Date().toISOString() }).eq('space_id', space.id).eq('user_id', payload.targetUserId)).error, 'track_password_reset')
        await audit(space.id, 'space_account_reset', { target_user_id: payload.targetUserId })
        return await success({ credential: { password } })
      }
      if (action === 'suspend_account') {
        const suspendedUntil = new Date(Date.now() + 100 * 365.25 * 24 * 60 * 60 * 1000).toISOString()
        const authUpdate = await admin.auth.admin.updateUserById(payload.targetUserId, { ban_duration: '876000h' })
        if (authUpdate.error) throw new ApiError('account_suspend_failed', 500)
        check((await admin.from('profiles').update({ suspended_until: suspendedUntil, suspension_reason: '스페이스 관리 계정 정지', session_invalid_after: new Date(Math.floor(Date.now() / 1000) * 1000).toISOString() }).eq('id', payload.targetUserId)).error, 'suspend_profile')
        check((await admin.from('space_managed_accounts').update({ status: 'suspended', last_managed_by: user.id, last_managed_at: new Date().toISOString(), updated_at: new Date().toISOString() }).eq('space_id', space.id).eq('user_id', payload.targetUserId)).error, 'track_suspend')
        await audit(space.id, 'space_account_suspend', { target_user_id: payload.targetUserId })
        return await success()
      }
      if (action === 'reactivate_account') {
        const authUpdate = await admin.auth.admin.updateUserById(payload.targetUserId, { ban_duration: 'none' })
        if (authUpdate.error) throw new ApiError('account_reactivate_failed', 500)
        check((await admin.from('profiles').update({ suspended_until: null, suspension_reason: null }).eq('id', payload.targetUserId)).error, 'reactivate_profile')
        check((await admin.from('space_managed_accounts').update({ status: 'active', last_managed_by: user.id, last_managed_at: new Date().toISOString(), updated_at: new Date().toISOString() }).eq('space_id', space.id).eq('user_id', payload.targetUserId)).error, 'track_reactivation')
        await audit(space.id, 'space_account_reactivate', { target_user_id: payload.targetUserId })
        return await success()
      }
      const sessions = await activeSession(payload.targetUserId)
      if (sessions.length) throw new ApiError('managed_account_active_session', 409)
      const otherSpaces = await admin.from('space_members').select('space_id', { count: 'exact', head: true }).eq('user_id', payload.targetUserId).neq('space_id', space.id)
      check(otherSpaces.error, 'account_safety_check_failed')
      if ((otherSpaces.count ?? 0) > 0) throw new ApiError('managed_account_has_other_spaces', 409)
      const [friendships, requests, invites] = await Promise.all([
        admin.from('friendships').select('user_low', { count: 'exact', head: true }).or(`user_low.eq.${payload.targetUserId},user_high.eq.${payload.targetUserId}`),
        admin.from('friend_requests').select('id', { count: 'exact', head: true }).or(`sender_id.eq.${payload.targetUserId},receiver_id.eq.${payload.targetUserId}`),
        admin.from('game_invites').select('id', { count: 'exact', head: true }).or(`sender_id.eq.${payload.targetUserId},receiver_id.eq.${payload.targetUserId}`),
      ])
      if ([friendships, requests, invites].some(result => result.error)) throw new ApiError('account_safety_check_failed', 500)
      if ((friendships.count ?? 0) + (requests.count ?? 0) + (invites.count ?? 0) > 0) throw new ApiError('managed_account_has_platform_relationships', 409)
      await audit(space.id, 'space_account_delete', { deleted_managed_user_id: payload.targetUserId })
      const removed = await admin.auth.admin.deleteUser(payload.targetUserId)
      if (removed.error) throw new ApiError('managed_account_delete_failed', 500)
      return await success()
    }

    if (action === 'bulk_update_members') {
      if (!Array.isArray(payload.items) || payload.items.length < 1 || payload.items.length > 100) throw new ApiError('invalid_bulk_size')
      const results: Array<{ userId: string; ok: boolean; error?: string }> = []
      for (const item of payload.items) {
        if (!item.userId || !item.operation) { results.push({ userId: item.userId ?? '', ok: false, error: 'invalid_bulk_item' }); continue }
        try {
          const target = await targetContext(item.userId)
          if (item.operation === 'role') {
            const role = item.role === 'manager' ? 'manager' : 'member'
            if ((role === 'manager' || target.membership.role === 'manager') && !canOwn) throw new ApiError('space_owner_required')
            check((await admin.from('space_members').update({ role }).eq('space_id', space.id).eq('user_id', item.userId)).error, 'update_member')
          } else if (item.operation === 'remove') {
            if ((await activeSession(item.userId)).length) throw new ApiError('member_active_session')
            check((await admin.from('space_members').delete().eq('space_id', space.id).eq('user_id', item.userId)).error, 'remove_member')
          } else {
            if (target.account.account_kind !== 'managed') throw new ApiError('existing_account_protected')
            const suspendedUntil = new Date(Date.now() + 100 * 365.25 * 24 * 60 * 60 * 1000).toISOString()
            const authUpdate = await admin.auth.admin.updateUserById(item.userId, { ban_duration: '876000h' }); if (authUpdate.error) throw new ApiError('account_suspend_failed')
            check((await admin.from('profiles').update({ suspended_until: suspendedUntil, suspension_reason: '스페이스 일괄 계정 정지' }).eq('id', item.userId)).error, 'suspend_profile')
            check((await admin.from('space_managed_accounts').update({ status: 'suspended', last_managed_by: user.id, last_managed_at: new Date().toISOString() }).eq('space_id', space.id).eq('user_id', item.userId)).error, 'track_suspend')
          }
          results.push({ userId: item.userId, ok: true })
        } catch (error) { results.push({ userId: item.userId, ok: false, error: error instanceof ApiError ? error.code : 'bulk_item_failed' }) }
      }
      await audit(space.id, 'bulk_update_space_members', { requested: payload.items.length, succeeded: results.filter(item => item.ok).length, failed: results.filter(item => !item.ok).length, policy: 'partial' })
      return await success({ results, policy: 'partial' })
    }

    if (action === 'close_room') {
      if (!payload.targetRoomId) throw new ApiError('target_required')
      const room = await admin.from('rooms').select('id,status').eq('id', payload.targetRoomId).eq('space_id', space.id).maybeSingle()
      check(room.error, 'load_room')
      if (!room.data) throw new ApiError('room_not_found', 404)
      if (room.data.status === 'playing' && !canOwn) throw new ApiError('space_owner_required', 403)
      if (!['waiting', 'playing'].includes(room.data.status)) throw new ApiError('room_not_active', 409)
      check((await admin.from('rooms').update({ status: 'closed', updated_at: new Date().toISOString() }).eq('id', room.data.id)).error, 'close_room')
      await audit(space.id, 'close_space_room', { room_id: room.data.id, previous_status: room.data.status })
      return await success()
    }

    throw new ApiError('unsupported_action')
  } catch (error) {
    if (admin && claimedRequestId) await admin.from('space_action_claims').update({ status: 'failed', completed_at: new Date().toISOString() }).eq('request_id', claimedRequestId)
    const apiError = error instanceof ApiError ? error : new ApiError('space_operation_failed', 500)
    logEdgeFailure(`space-admin:${apiError.code}`, request, apiError)
    const details = apiError.code.startsWith('bulk_validation_failed:') ? JSON.parse(apiError.code.slice(apiError.code.indexOf(':') + 1)) : undefined
    return response(request, { error: details ? 'bulk_validation_failed' : apiError.code, ...(details ? { failures: details } : {}) }, apiError.status)
  }
})
