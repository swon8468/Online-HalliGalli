import { createClient } from 'npm:@supabase/supabase-js@2.95.0'
import { diagnosticBody, diagnosticHeaders, logEdgeFailure, safeErrorCode } from '../_shared/diagnostics.ts'

type SpaceRole = 'member' | 'manager' | 'owner'
type Action = 'snapshot' | 'create_space' | 'update_space' | 'rotate_join_code' | 'add_existing' | 'update_member' | 'remove_member' | 'create_account' | 'bulk_create_accounts'
type AccountInput = { email?: string; nickname?: string; password?: string; role?: 'member' | 'manager'; externalId?: string }
type Payload = AccountInput & {
  action?: Action
  spaceId?: string
  name?: string
  slug?: string
  description?: string
  status?: 'draft' | 'active' | 'suspended' | 'archived'
  joinEnabled?: boolean
  targetUserId?: string
  reason?: string
  accounts?: AccountInput[]
  emailDomain?: string
  managerEmail?: string
  managerNickname?: string
  managerPassword?: string
}

const origins = (Deno.env.get('ALLOWED_ORIGINS') ?? 'https://develop.haligali.swonport.kr,https://haligali.swonport.kr,https://develop.admin.haligali.swonport.kr,https://admin.haligali.swonport.kr')
  .split(',').map(value => value.trim()).filter(Boolean)

function isAllowedOrigin(origin: string) {
  return origins.includes(origin) || /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)
}

function headers(request: Request) {
  const origin = request.headers.get('Origin') ?? ''
  return {
    ...(isAllowedOrigin(origin) ? { 'Access-Control-Allow-Origin': origin } : {}),
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Vary': 'Origin',
    ...diagnosticHeaders(request),
  }
}

function response(request: Request, body: unknown, status = 200) { return Response.json(diagnosticBody(request, body), { status, headers: headers(request) }) }
function validSlug(value: string) { return /^[a-z0-9][a-z0-9-]{2,48}$/.test(value) }
function normalizeEmailDomain(value: string) {
  const domain = value.trim().toLowerCase()
  return /^@[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/.test(domain) ? domain : null
}
function validEmail(value: string) {
  const parts = value.trim().toLowerCase().split('@')
  return parts.length === 2 && Boolean(parts[0]) && !/\s/.test(parts[0]) && normalizeEmailDomain(`@${parts[1]}`) === `@${parts[1]}`
}
function emailMatchesDomain(email: string, domain: string) {
  const normalized = email.trim().toLowerCase()
  const parts = normalized.split('@')
  return validEmail(normalized) && `@${parts[1]}` === domain
}
function randomJoinCode() { return crypto.randomUUID().replaceAll('-', '').slice(0, 8).toUpperCase() }
function randomPassword() { return `Hg-${crypto.randomUUID().replaceAll('-', '').slice(0, 16)}!` }
function checkError(error: { message: string } | null, context: string) { if (error) throw new Error(`${context}: ${error.message}`) }

Deno.serve(async request => {
  const origin = request.headers.get('Origin') ?? ''
  if (origin && !isAllowedOrigin(origin)) return response(request, { error: 'origin_not_allowed' }, 403)
  if (request.method === 'OPTIONS') return response(request, { ok: true })
  if (request.method !== 'POST') return response(request, { error: 'method_not_allowed' }, 405)

  try {
    const authorization = request.headers.get('Authorization')
    if (!authorization) return response(request, { error: 'unauthorized' }, 401)
    const url = Deno.env.get('SUPABASE_URL')!
    const caller = createClient(url, Deno.env.get('SUPABASE_ANON_KEY')!, { global: { headers: { Authorization: authorization } }, auth: { persistSession: false } })
    const { data: { user } } = await caller.auth.getUser()
    if (!user) return response(request, { error: 'unauthorized' }, 401)
    const admin = createClient(url, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false, autoRefreshToken: false } })
    const payload = await request.json().catch(() => ({})) as Payload
    if (!payload.action) return response(request, { error: 'invalid_request' }, 400)
    const { data: actor, error: actorError } = await admin.from('profiles').select('id,nickname,platform_role,suspended_until,deleted_at').eq('id', user.id).maybeSingle()
    checkError(actorError, 'load_actor')
    if (!actor || actor.deleted_at || (actor.suspended_until && new Date(actor.suspended_until) > new Date())) return response(request, { error: 'forbidden' }, 403)
    const isPlatformAdmin = ['admin', 'super_admin'].includes(actor.platform_role)
    const isPlatformReader = ['support', 'admin', 'super_admin'].includes(actor.platform_role)
    async function listAllAuthUsers() {
      const users = []
      for (let page = 1; ; page += 1) {
        const listed = await admin.auth.admin.listUsers({ page, perPage: 1000 })
        checkError(listed.error, 'list_users')
        users.push(...listed.data.users)
        if (listed.data.users.length < 1000) return users
      }
    }

    if (payload.action === 'create_space') {
      if (!isPlatformAdmin) return response(request, { error: 'platform_admin_required' }, 403)
      const name = payload.name?.trim() ?? '', slug = payload.slug?.trim().toLowerCase() ?? ''
      if (name.length < 2 || name.length > 80 || !validSlug(slug)) return response(request, { error: 'invalid_space' }, 400)
      const emailDomain = normalizeEmailDomain(payload.emailDomain ?? '')
      if (!emailDomain) return response(request, { error: 'invalid_email_domain' }, 400)
      const managerEmail = payload.managerEmail?.trim().toLowerCase() ?? ''
      const managerNickname = payload.managerNickname?.trim() ?? ''
      const managerPassword = payload.managerPassword?.trim() || randomPassword()
      if (!/^\S+@\S+\.\S+$/.test(managerEmail) || !emailMatchesDomain(managerEmail, emailDomain)) return response(request, { error: 'manager_email_domain_mismatch' }, 400)
      if (managerNickname.length < 2 || managerNickname.length > 12) return response(request, { error: 'invalid_manager_nickname' }, 400)
      if (managerPassword.length < 12) return response(request, { error: 'weak_manager_password' }, 400)
      const [existingSpace, existingUsers] = await Promise.all([
        admin.from('spaces').select('id').eq('slug', slug).maybeSingle(),
        listAllAuthUsers(),
      ])
      checkError(existingSpace.error, 'check_space_slug')
      if (existingSpace.data) return response(request, { error: 'space_slug_exists' }, 409)
      if (existingUsers.some(item => item.email?.toLowerCase() === managerEmail)) return response(request, { error: 'space_manager_email_exists' }, 409)

      const managerResult = await admin.auth.admin.createUser({
        email: managerEmail,
        password: managerPassword,
        email_confirm: true,
        user_metadata: { nickname: managerNickname },
        app_metadata: { platform_role: 'player' },
      })
      if (managerResult.error || !managerResult.data.user) return response(request, { error: 'space_manager_creation_failed' }, 400)
      const manager = managerResult.data.user
      let created: { id: string; slug: string } | null = null
      try {
        for (let attempt = 0; attempt < 5 && !created; attempt += 1) {
          const insert = await admin.from('spaces').insert({ name, slug, description: payload.description?.trim() || null, status: 'active', created_by: user.id, join_code: randomJoinCode(), join_enabled: true, allowed_email_domain: emailDomain }).select('id,slug').single()
          if (!insert.error) created = insert.data
          else if (!insert.error.message.includes('spaces_join_code_key')) throw insert.error
        }
        if (!created) throw new Error('join_code_allocation_failed')
        checkError((await admin.from('space_members').insert([
          { space_id: created.id, user_id: user.id, role: 'owner', invited_by: user.id },
          { space_id: created.id, user_id: manager.id, role: 'manager', invited_by: user.id },
        ])).error, 'add_space_owners')
        checkError((await admin.from('moderation_actions').insert({ actor_id: user.id, target_space_id: created.id, action: 'create_space', reason: payload.reason?.trim() || '스페이스 생성', metadata: { name, slug, allowed_email_domain: emailDomain, manager_user_id: manager.id } })).error, 'write_audit')
        return response(request, { ok: true, space: created, manager: { userId: manager.id, email: managerEmail, nickname: managerNickname, role: 'manager', password: managerPassword, created: true } })
      } catch (error) {
        if (created) await admin.from('spaces').delete().eq('id', created.id)
        await admin.auth.admin.deleteUser(manager.id)
        throw error
      }
    }

    if (!payload.spaceId) return response(request, { error: 'space_required' }, 400)
    const { data: space, error: spaceError } = await admin.from('spaces').select('id,name,slug,description,status,settings,join_code,join_enabled,allowed_email_domain,created_by,created_at,updated_at,archived_at').eq('id', payload.spaceId).maybeSingle()
    checkError(spaceError, 'load_space')
    if (!space) return response(request, { error: 'space_not_found' }, 404)
    const { data: actorMembership } = await admin.from('space_members').select('role').eq('space_id', space.id).eq('user_id', user.id).maybeSingle()
    const actorSpaceRole = actorMembership?.role as SpaceRole | undefined
    const canManage = isPlatformAdmin || ['owner', 'manager'].includes(actorSpaceRole ?? '')
    const canView = isPlatformReader || Boolean(actorSpaceRole)
    if (payload.action === 'snapshot') {
      if (!canView) return response(request, { error: 'space_access_denied' }, 403)
      const rooms = await admin.from('rooms').select('id,code,kind,status,host_id,max_players,card_set_id,created_at,updated_at').eq('space_id', space.id).order('created_at', { ascending: false }).limit(250)
      checkError(rooms.error, 'load_rooms')
      const roomIds = (rooms.data ?? []).map(item => item.id)
      const gamesPromise = roomIds.length
        ? admin.from('games').select('id,room_id,started_at,finished_at,version,state').in('room_id', roomIds).order('started_at', { ascending: false }).limit(250)
        : Promise.resolve({ data: [], error: null })
      const [members, games, cardSets, authUsers] = await Promise.all([
        admin.from('space_members').select('space_id,user_id,role,student_or_employee_id,invited_by,joined_at,profiles:profiles!space_members_user_id_fkey(nickname,friend_tag,deleted_at,suspended_until)').eq('space_id', space.id).order('joined_at'),
        gamesPromise,
        admin.from('card_sets').select('id,name,status,version,is_platform_default,space_id,updated_at').or(`space_id.eq.${space.id},is_platform_default.eq.true`).order('updated_at', { ascending: false }),
        admin.auth.admin.listUsers({ page: 1, perPage: 1000 }),
      ])
      const error = [members.error, games.error, cardSets.error, authUsers.error].find(Boolean)
      if (error) throw new Error(`snapshot_query: ${error.message}`)
      const identity = new Map((authUsers.data?.users ?? []).map(item => [item.id, { email: item.email ?? null, phone: item.phone ?? null, lastSignInAt: item.last_sign_in_at ?? null }]))
      return response(request, {
        ok: true,
        actor: { id: user.id, platformRole: actor.platform_role, spaceRole: actorSpaceRole ?? null, canManage },
        data: {
          space,
          members: (members.data ?? []).map(member => ({ ...member, ...(identity.get(member.user_id) ?? {}) })),
          rooms: rooms.data ?? [], games: games.data ?? [], cardSets: cardSets.data ?? [],
        },
      })
    }
    if (!canManage) return response(request, { error: 'space_manager_required' }, 403)
    const reason = payload.reason?.trim() || '스페이스 관리자 작업'

    if (payload.action === 'update_space') {
      const next: Record<string, unknown> = { updated_at: new Date().toISOString() }
      if (payload.name !== undefined) {
        const name = payload.name.trim(); if (name.length < 2 || name.length > 80) return response(request, { error: 'invalid_space_name' }, 400); next.name = name
      }
      if (payload.slug !== undefined) {
        const slug = payload.slug.trim().toLowerCase(); if (!validSlug(slug)) return response(request, { error: 'invalid_space_slug' }, 400); next.slug = slug
      }
      if (payload.description !== undefined) next.description = payload.description.trim() || null
      if (payload.joinEnabled !== undefined) next.join_enabled = payload.joinEnabled
      if (payload.status !== undefined) {
        if (payload.status === 'archived' && !isPlatformAdmin && actorSpaceRole !== 'owner') return response(request, { error: 'space_owner_required' }, 403)
        next.status = payload.status
        next.archived_at = payload.status === 'archived' ? new Date().toISOString() : null
      }
      checkError((await admin.from('spaces').update(next).eq('id', space.id)).error, 'update_space')
      checkError((await admin.from('moderation_actions').insert({ actor_id: user.id, target_space_id: space.id, action: payload.status === 'archived' ? 'archive_space' : 'update_space', reason, metadata: next })).error, 'write_audit')
      return response(request, { ok: true })
    }
    if (payload.action === 'rotate_join_code') {
      let joinCode = ''
      for (let attempt = 0; attempt < 5 && !joinCode; attempt += 1) {
        const candidate = randomJoinCode()
        const update = await admin.from('spaces').update({ join_code: candidate, updated_at: new Date().toISOString() }).eq('id', space.id)
        if (!update.error) joinCode = candidate
        else if (!update.error.message.includes('spaces_join_code_key')) throw update.error
      }
      if (!joinCode) throw new Error('join_code_allocation_failed')
      checkError((await admin.from('moderation_actions').insert({ actor_id: user.id, target_space_id: space.id, action: 'update_space', reason, metadata: { rotated_join_code: true } })).error, 'write_audit')
      return response(request, { ok: true, joinCode })
    }

    if (payload.action === 'add_existing') {
      const email = payload.email?.trim().toLowerCase()
      if (!email) return response(request, { error: 'email_required' }, 400)
      if (space.allowed_email_domain && !emailMatchesDomain(email, space.allowed_email_domain)) return response(request, { error: 'space_email_domain_required' }, 403)
      const users = await listAllAuthUsers()
      const target = users.find(item => item.email?.toLowerCase() === email)
      if (!target) return response(request, { error: 'user_not_found' }, 404)
      const role: SpaceRole = payload.role === 'manager' ? 'manager' : 'member'
      if (role === 'manager' && !isPlatformAdmin && actorSpaceRole !== 'owner') return response(request, { error: 'space_owner_required' }, 403)
      checkError((await admin.from('space_members').upsert({ space_id: space.id, user_id: target.id, role, invited_by: user.id, student_or_employee_id: payload.externalId?.trim() || null }, { onConflict: 'space_id,user_id' })).error, 'add_member')
      checkError((await admin.from('moderation_actions').insert({ actor_id: user.id, target_user_id: target.id, action: 'add_space_member', reason, metadata: { space_id: space.id, role } })).error, 'write_audit')
      return response(request, { ok: true, userId: target.id })
    }

    if (payload.action === 'update_member' || payload.action === 'remove_member') {
      if (!payload.targetUserId) return response(request, { error: 'target_required' }, 400)
      const { data: targetMembership } = await admin.from('space_members').select('role').eq('space_id', space.id).eq('user_id', payload.targetUserId).maybeSingle()
      if (!targetMembership) return response(request, { error: 'member_not_found' }, 404)
      if (targetMembership.role === 'owner') return response(request, { error: 'cannot_modify_owner' }, 409)
      if (payload.targetUserId === user.id) return response(request, { error: 'cannot_modify_self' }, 409)
      if (targetMembership.role === 'manager' && !isPlatformAdmin && actorSpaceRole !== 'owner') return response(request, { error: 'space_owner_required' }, 403)
      if (payload.action === 'remove_member') {
        checkError((await admin.from('space_members').delete().eq('space_id', space.id).eq('user_id', payload.targetUserId)).error, 'remove_member')
        checkError((await admin.from('moderation_actions').insert({ actor_id: user.id, target_user_id: payload.targetUserId, action: 'remove_space_member', reason, metadata: { space_id: space.id } })).error, 'write_audit')
      } else {
        const role: SpaceRole = payload.role === 'manager' ? 'manager' : 'member'
        if (role === 'manager' && !isPlatformAdmin && actorSpaceRole !== 'owner') return response(request, { error: 'space_owner_required' }, 403)
        checkError((await admin.from('space_members').update({ role }).eq('space_id', space.id).eq('user_id', payload.targetUserId)).error, 'update_member')
        checkError((await admin.from('moderation_actions').insert({ actor_id: user.id, target_user_id: payload.targetUserId, action: 'change_space_role', reason, metadata: { space_id: space.id, from: targetMembership.role, to: role } })).error, 'write_audit')
      }
      return response(request, { ok: true })
    }

    async function createOrAttach(input: AccountInput, knownUsers?: Awaited<ReturnType<typeof listAllAuthUsers>>) {
      const email = input.email?.trim().toLowerCase() ?? '', nickname = input.nickname?.trim() ?? ''
      if (!validEmail(email) || nickname.length < 2 || nickname.length > 12) throw new Error(`invalid_account:${email || 'unknown'}`)
      if (space.allowed_email_domain && !emailMatchesDomain(email, space.allowed_email_domain)) throw new Error('space_email_domain_required')
      const role: SpaceRole = input.role === 'manager' ? 'manager' : 'member'
      if (role === 'manager' && !isPlatformAdmin && actorSpaceRole !== 'owner') throw new Error('space_owner_required')
      const users = knownUsers ?? await listAllAuthUsers()
      let target = users.find(item => item.email?.toLowerCase() === email)
      const password = input.password?.trim() || randomPassword()
      let created = false
      if (!target) {
        if (password.length < 12) throw new Error(`weak_password:${email}`)
        const result = await admin.auth.admin.createUser({ email, password, email_confirm: true, user_metadata: { nickname }, app_metadata: { platform_role: 'player' } })
        checkError(result.error, 'create_user')
        if (!result.data.user) throw new Error('created_user_missing')
        target = result.data.user; created = true
      }
      const attached = await admin.from('space_members').upsert({ space_id: space.id, user_id: target.id, role, invited_by: user.id, student_or_employee_id: input.externalId?.trim() || null }, { onConflict: 'space_id,user_id' })
      if (attached.error) {
        if (created) await admin.auth.admin.deleteUser(target.id)
        checkError(attached.error, 'attach_member')
      }
      return { userId: target.id, email, nickname, role, password: created ? password : null, created }
    }

    async function rollbackAccount(result: Awaited<ReturnType<typeof createOrAttach>>, previous?: { user_id: string; role: SpaceRole; invited_by: string | null; student_or_employee_id: string | null; joined_at: string }) {
      if (result.created) {
        const removed = await admin.auth.admin.deleteUser(result.userId)
        checkError(removed.error, 'rollback_created_user')
      } else if (previous) {
        checkError((await admin.from('space_members').upsert({ space_id: space.id, ...previous }, { onConflict: 'space_id,user_id' })).error, 'rollback_existing_membership')
      } else {
        checkError((await admin.from('space_members').delete().eq('space_id', space.id).eq('user_id', result.userId)).error, 'rollback_new_membership')
      }
    }

    if (payload.action === 'create_account') {
      const email = payload.email?.trim().toLowerCase() ?? ''
      const users = await listAllAuthUsers()
      const existing = users.find(item => item.email?.toLowerCase() === email)
      const previousMembership = existing
        ? await admin.from('space_members').select('user_id,role,invited_by,student_or_employee_id,joined_at').eq('space_id', space.id).eq('user_id', existing.id).maybeSingle()
        : { data: null, error: null }
      checkError(previousMembership.error, 'load_previous_membership')
      const result = await createOrAttach(payload, users)
      try {
        checkError((await admin.from('moderation_actions').insert({ actor_id: user.id, target_user_id: result.userId, action: 'add_space_member', reason, metadata: { space_id: space.id, role: result.role, account_created: result.created } })).error, 'write_audit')
        return response(request, { ok: true, account: result })
      } catch (error) {
        await rollbackAccount(result, previousMembership.data as Parameters<typeof rollbackAccount>[1])
        throw error
      }
    }
    if (payload.action === 'bulk_create_accounts') {
      if (!Array.isArray(payload.accounts) || payload.accounts.length < 1 || payload.accounts.length > 100) return response(request, { error: 'invalid_bulk_size' }, 400)
      const users = await listAllAuthUsers()
      const existingByEmail = new Map(users.flatMap(item => item.email ? [[item.email.toLowerCase(), item]] : []))
      const seen = new Set<string>()
      const failures: Array<{ email: string; error: string }> = []
      for (const input of payload.accounts) {
        const email = input.email?.trim().toLowerCase() ?? '', nickname = input.nickname?.trim() ?? ''
        let error = ''
        if (!validEmail(email) || nickname.length < 2 || nickname.length > 12) error = 'invalid_account'
        else if (space.allowed_email_domain && !emailMatchesDomain(email, space.allowed_email_domain)) error = 'space_email_domain_required'
        else if (seen.has(email)) error = 'duplicate_bulk_email'
        else if (input.role === 'manager' && !isPlatformAdmin && actorSpaceRole !== 'owner') error = 'space_owner_required'
        else if (!existingByEmail.has(email) && input.password?.trim() && input.password.trim().length < 12) error = 'weak_password'
        seen.add(email)
        if (error) failures.push({ email, error })
      }
      if (failures.length) return response(request, { error: 'bulk_validation_failed', failures }, 400)

      const existingIds = payload.accounts.map(input => existingByEmail.get(input.email!.trim().toLowerCase())?.id).filter((id): id is string => Boolean(id))
      const previousMemberships = existingIds.length
        ? await admin.from('space_members').select('user_id,role,invited_by,student_or_employee_id,joined_at').eq('space_id', space.id).in('user_id', existingIds)
        : { data: [], error: null }
      checkError(previousMemberships.error, 'load_previous_memberships')
      const previousByUserId = new Map((previousMemberships.data ?? []).map(item => [item.user_id, item]))
      const results: Awaited<ReturnType<typeof createOrAttach>>[] = []
      try {
        for (const input of payload.accounts) results.push(await createOrAttach(input, users))
        checkError((await admin.from('moderation_actions').insert({ actor_id: user.id, target_space_id: space.id, action: 'bulk_create_space_members', reason, metadata: { requested: payload.accounts.length, created_or_attached: results.length, failed: 0 } })).error, 'write_audit')
      } catch (error) {
        try {
          for (const result of results.reverse()) await rollbackAccount(result, previousByUserId.get(result.userId) as Parameters<typeof rollbackAccount>[1])
        } catch (rollbackError) {
          logEdgeFailure('space-admin-bulk-rollback', request, rollbackError)
        }
        logEdgeFailure('space-admin-bulk', request, error)
        return response(request, { error: 'bulk_operation_failed' }, 500)
      }
      return response(request, { ok: true, accounts: results, failures: [] })
    }
    return response(request, { error: 'unsupported_action' }, 400)
  } catch (error) {
    logEdgeFailure('space-admin', request, error)
    return response(request, { error: safeErrorCode(error) }, 500)
  }
})
