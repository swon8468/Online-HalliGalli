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
}

const origins = (Deno.env.get('ALLOWED_ORIGINS') ?? 'https://develop.haligali.swonport.kr,https://haligali.swonport.kr,https://develop.admin.haligali.swonport.kr,https://admin.haligali.swonport.kr')
  .split(',').map(value => value.trim()).filter(Boolean)

function headers(request: Request) {
  const origin = request.headers.get('Origin') ?? ''
  const local = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)
  return {
    'Access-Control-Allow-Origin': origins.includes(origin) || local ? origin : origins[0],
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Vary': 'Origin',
    ...diagnosticHeaders(request),
  }
}

function response(request: Request, body: unknown, status = 200) { return Response.json(diagnosticBody(request, body), { status, headers: headers(request) }) }
function validSlug(value: string) { return /^[a-z0-9][a-z0-9-]{2,48}$/.test(value) }
function randomJoinCode() { return crypto.randomUUID().replaceAll('-', '').slice(0, 8).toUpperCase() }
function randomPassword() { return `Hg-${crypto.randomUUID().replaceAll('-', '').slice(0, 16)}!` }
function checkError(error: { message: string } | null, context: string) { if (error) throw new Error(`${context}: ${error.message}`) }

Deno.serve(async request => {
  if (request.method === 'OPTIONS') return response(request, { ok: true })
  if (request.method !== 'POST') return response(request, { error: 'method_not_allowed' }, 405)
  const origin = request.headers.get('Origin') ?? ''
  if (origin && headers(request)['Access-Control-Allow-Origin'] !== origin) return response(request, { error: 'origin_not_allowed' }, 403)

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

    if (payload.action === 'create_space') {
      if (!isPlatformAdmin) return response(request, { error: 'platform_admin_required' }, 403)
      const name = payload.name?.trim() ?? '', slug = payload.slug?.trim().toLowerCase() ?? ''
      if (name.length < 2 || name.length > 80 || !validSlug(slug)) return response(request, { error: 'invalid_space' }, 400)
      let created: { id: string; slug: string } | null = null
      for (let attempt = 0; attempt < 5 && !created; attempt += 1) {
        const insert = await admin.from('spaces').insert({ name, slug, description: payload.description?.trim() || null, status: 'active', created_by: user.id, join_code: randomJoinCode(), join_enabled: true }).select('id,slug').single()
        if (!insert.error) created = insert.data
        else if (!insert.error.message.includes('spaces_join_code_key')) throw insert.error
      }
      if (!created) throw new Error('join_code_allocation_failed')
      checkError((await admin.from('space_members').insert({ space_id: created.id, user_id: user.id, role: 'owner', invited_by: user.id })).error, 'add_owner')
      checkError((await admin.from('moderation_actions').insert({ actor_id: user.id, target_space_id: created.id, action: 'create_space', reason: payload.reason?.trim() || '스페이스 생성', metadata: { name, slug } })).error, 'write_audit')
      return response(request, { ok: true, space: created })
    }

    if (!payload.spaceId) return response(request, { error: 'space_required' }, 400)
    const { data: space, error: spaceError } = await admin.from('spaces').select('id,name,slug,description,status,settings,join_code,join_enabled,created_by,created_at,updated_at,archived_at').eq('id', payload.spaceId).maybeSingle()
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
      const users = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 })
      checkError(users.error, 'list_users')
      const target = users.data.users.find(item => item.email?.toLowerCase() === email)
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

    async function createOrAttach(input: AccountInput) {
      const email = input.email?.trim().toLowerCase() ?? '', nickname = input.nickname?.trim() ?? ''
      if (!/^\S+@\S+\.\S+$/.test(email) || nickname.length < 2 || nickname.length > 12) throw new Error(`invalid_account:${email || 'unknown'}`)
      const role: SpaceRole = input.role === 'manager' ? 'manager' : 'member'
      if (role === 'manager' && !isPlatformAdmin && actorSpaceRole !== 'owner') throw new Error('space_owner_required')
      const listed = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 })
      checkError(listed.error, 'list_users')
      let target = listed.data.users.find(item => item.email?.toLowerCase() === email)
      const password = input.password?.trim() || randomPassword()
      let created = false
      if (!target) {
        if (password.length < 12) throw new Error(`weak_password:${email}`)
        const result = await admin.auth.admin.createUser({ email, password, email_confirm: true, user_metadata: { nickname } })
        checkError(result.error, 'create_user')
        if (!result.data.user) throw new Error('created_user_missing')
        target = result.data.user; created = true
      }
      checkError((await admin.from('space_members').upsert({ space_id: space.id, user_id: target.id, role, invited_by: user.id, student_or_employee_id: input.externalId?.trim() || null }, { onConflict: 'space_id,user_id' })).error, 'attach_member')
      return { userId: target.id, email, nickname, role, password: created ? password : null, created }
    }

    if (payload.action === 'create_account') {
      const result = await createOrAttach(payload)
      checkError((await admin.from('moderation_actions').insert({ actor_id: user.id, target_user_id: result.userId, action: 'add_space_member', reason, metadata: { space_id: space.id, role: result.role, account_created: result.created } })).error, 'write_audit')
      return response(request, { ok: true, account: result })
    }
    if (payload.action === 'bulk_create_accounts') {
      if (!Array.isArray(payload.accounts) || payload.accounts.length < 1 || payload.accounts.length > 100) return response(request, { error: 'invalid_bulk_size' }, 400)
      const results = [], failures = []
      for (const input of payload.accounts) {
        try { results.push(await createOrAttach(input)) } catch (error) { failures.push({ email: input.email ?? '', error: safeErrorCode(error) }) }
      }
      checkError((await admin.from('moderation_actions').insert({ actor_id: user.id, target_space_id: space.id, action: 'bulk_create_space_members', reason, metadata: { requested: payload.accounts.length, created_or_attached: results.length, failed: failures.length } })).error, 'write_audit')
      return response(request, { ok: true, accounts: results, failures })
    }
    return response(request, { error: 'unsupported_action' }, 400)
  } catch (error) {
    logEdgeFailure('space-admin', request, error)
    return response(request, { error: safeErrorCode(error) }, 500)
  }
})
