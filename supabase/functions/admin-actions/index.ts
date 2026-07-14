import { createClient } from 'npm:@supabase/supabase-js@2.95.0'
import { diagnosticBody, diagnosticHeaders, logEdgeFailure, safeErrorCode } from '../_shared/diagnostics.ts'

type PlatformRole = 'player' | 'support' | 'admin' | 'super_admin'
type AdminAction = 'snapshot' | 'suspend_user' | 'unsuspend_user' | 'deactivate_user' | 'close_room' | 'change_role' | 'create_admin'
type Payload = {
  action?: AdminAction
  targetId?: string
  reason?: string
  durationDays?: number | null
  role?: PlatformRole
  email?: string
  password?: string
  nickname?: string
}

const allowedOrigins = new Set((Deno.env.get('ALLOWED_ORIGINS') ?? [
  'https://develop.admin.haligali.swonport.kr',
  'https://admin.haligali.swonport.kr',
  'https://develop.haligali.swonport.kr',
  'https://haligali.swonport.kr',
].join(',')).split(',').map(value => value.trim()).filter(Boolean))

function isAllowedOrigin(origin: string) {
  return allowedOrigins.has(origin) || /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)
}

function corsHeaders(request: Request) {
  const origin = request.headers.get('Origin') ?? ''
  return {
    ...(isAllowedOrigin(origin) ? { 'Access-Control-Allow-Origin': origin } : {}),
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Vary': 'Origin',
    ...diagnosticHeaders(request),
  }
}

function respond(request: Request, body: unknown, status = 200) {
  return Response.json(diagnosticBody(request, body), { status, headers: corsHeaders(request) })
}

function failIf(error: { message: string } | null, context: string) {
  if (error) throw new Error(`${context}: ${error.message}`)
}

Deno.serve(async request => {
  const origin = request.headers.get('Origin') ?? ''
  if (origin && !isAllowedOrigin(origin)) return respond(request, { error: 'origin_not_allowed' }, 403)
  if (request.method === 'OPTIONS') return respond(request, { ok: true })
  if (request.method !== 'POST') return respond(request, { error: 'method_not_allowed' }, 405)

  try {
    const authorization = request.headers.get('Authorization')
    if (!authorization) return respond(request, { error: 'unauthorized' }, 401)
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    const caller = createClient(supabaseUrl, anonKey, { global: { headers: { Authorization: authorization } }, auth: { persistSession: false } })
    const { data: { user } } = await caller.auth.getUser()
    if (!user) return respond(request, { error: 'unauthorized' }, 401)

    const admin = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false, autoRefreshToken: false } })
    const { data: actor } = await admin.from('profiles').select('id,nickname,platform_role,suspended_until,deleted_at').eq('id', user.id).maybeSingle()
    if (!actor || !['support', 'admin', 'super_admin'].includes(actor.platform_role) || actor.deleted_at || (actor.suspended_until && new Date(actor.suspended_until) > new Date())) {
      return respond(request, { error: 'forbidden' }, 403)
    }

    const payload = await request.json().catch(() => ({})) as Payload
    if (!payload.action) return respond(request, { error: 'invalid_request' }, 400)

    if (payload.action === 'snapshot') {
      const [profiles, rooms, members, games, spaces, cardSets, audit, authUsers] = await Promise.all([
        admin.from('profiles').select('id,nickname,friend_tag,platform_role,suspended_until,suspension_reason,deleted_at,created_at,updated_at').order('created_at', { ascending: false }).limit(1000),
        admin.from('rooms').select('id,code,kind,status,max_players,space_id,card_set_id,host_id,created_at,updated_at').order('created_at', { ascending: false }).limit(500),
        admin.from('room_members').select('room_id,user_id,role,joined_at,left_at,kicked_at,kick_reason'),
        admin.from('games').select('id,room_id,current_turn,version,started_at,finished_at,state').order('started_at', { ascending: false }).limit(500),
        admin.from('spaces').select('id,name,slug,status,created_at').order('created_at', { ascending: false }).limit(500),
        admin.from('card_sets').select('id,name,status,version,is_platform_default,space_id,updated_at').order('updated_at', { ascending: false }).limit(500),
        admin.from('moderation_actions').select('id,actor_id,target_user_id,target_room_id,target_space_id,action,reason,metadata,created_at').order('created_at', { ascending: false }).limit(500),
        admin.auth.admin.listUsers({ page: 1, perPage: 1000 }),
      ])
      const firstError = [profiles.error, rooms.error, members.error, games.error, spaces.error, cardSets.error, audit.error, authUsers.error].find(Boolean)
      if (firstError) throw firstError
      const emailById = new Map((authUsers.data?.users ?? []).map(item => [item.id, { email: item.email ?? null, phone: item.phone ?? null, lastSignInAt: item.last_sign_in_at ?? null }]))
      const profileById = new Map((profiles.data ?? []).map(item => [item.id, item]))
      const roomMemberMap = new Map<string, typeof members.data>()
      for (const member of members.data ?? []) roomMemberMap.set(member.room_id, [...(roomMemberMap.get(member.room_id) ?? []), member])
      const gameByRoom = new Map((games.data ?? []).map(item => [item.room_id, item]))
      const profilesOutput = (profiles.data ?? []).map(profile => ({ ...profile, ...emailById.get(profile.id) }))
      const roomsOutput = (rooms.data ?? []).map(room => ({
        ...room,
        members: (roomMemberMap.get(room.id) ?? []).map(member => ({ ...member, nickname: profileById.get(member.user_id)?.nickname ?? '알 수 없음' })),
        game: gameByRoom.get(room.id) ?? null,
        hostNickname: profileById.get(room.host_id)?.nickname ?? '알 수 없음',
      }))
      const auditOutput = (audit.data ?? []).map(entry => ({
        ...entry,
        actorNickname: profileById.get(entry.actor_id)?.nickname ?? '알 수 없음',
        targetNickname: entry.target_user_id ? profileById.get(entry.target_user_id)?.nickname ?? '알 수 없음' : null,
      }))
      return respond(request, {
        ok: true,
        actor: { id: actor.id, nickname: actor.nickname, role: actor.platform_role },
        data: { profiles: profilesOutput, rooms: roomsOutput, spaces: spaces.data ?? [], cardSets: cardSets.data ?? [], audit: auditOutput },
      })
    }

    if (!['admin', 'super_admin'].includes(actor.platform_role)) return respond(request, { error: 'read_only_role' }, 403)
    const reason = payload.reason?.trim()
    if (!reason || reason.length < 2 || reason.length > 500) return respond(request, { error: 'invalid_reason' }, 400)

    if (payload.action === 'create_admin') {
      if (actor.platform_role !== 'super_admin') return respond(request, { error: 'super_admin_required' }, 403)
      if (!payload.email?.trim() || !payload.password || !payload.nickname?.trim() || !payload.role || !['support', 'admin'].includes(payload.role)) return respond(request, { error: 'invalid_admin_account' }, 400)
      if (payload.password.length < 12) return respond(request, { error: 'weak_password' }, 400)
      const { data: created, error: createError } = await admin.auth.admin.createUser({
        email: payload.email.trim().toLowerCase(), password: payload.password, email_confirm: true,
        user_metadata: { nickname: payload.nickname.trim() }, app_metadata: { platform_role: payload.role },
      })
      failIf(createError, 'create_user')
      if (!created.user) throw new Error('created_user_missing')
      const { error: profileError } = await admin.from('profiles').update({ platform_role: payload.role, nickname: payload.nickname.trim(), updated_at: new Date().toISOString() }).eq('id', created.user.id)
      failIf(profileError, 'update_profile')
      const { error: auditError } = await admin.from('moderation_actions').insert({ actor_id: user.id, target_user_id: created.user.id, action: 'create_admin', reason, metadata: { role: payload.role } })
      failIf(auditError, 'write_audit')
      return respond(request, { ok: true, userId: created.user.id })
    }

    if (!payload.targetId) return respond(request, { error: 'invalid_request' }, 400)

    if (payload.action === 'close_room') {
      const now = new Date().toISOString()
      const { data: room, error: roomLookupError } = await admin.from('rooms').select('id,status').eq('id', payload.targetId).maybeSingle()
      failIf(roomLookupError, 'load_room')
      if (!room) return respond(request, { error: 'room_not_found' }, 404)
      if (room.status !== 'closed') {
        failIf((await admin.from('rooms').update({ status: 'closed', updated_at: now }).eq('id', payload.targetId)).error, 'close_room')
        failIf((await admin.from('room_members').update({ left_at: now, disconnected_at: now }).eq('room_id', payload.targetId).is('left_at', null)).error, 'close_members')
        await admin.from('game_invites').update({ status: 'cancelled' }).eq('room_id', payload.targetId).eq('status', 'pending')
      }
      failIf((await admin.from('moderation_actions').insert({ actor_id: user.id, target_room_id: payload.targetId, action: 'close_room', reason, metadata: { previous_status: room.status } })).error, 'write_audit')
      return respond(request, { ok: true })
    }

    const { data: target, error: targetError } = await admin.from('profiles').select('platform_role,deleted_at').eq('id', payload.targetId).maybeSingle()
    failIf(targetError, 'load_target')
    if (!target) return respond(request, { error: 'user_not_found' }, 404)
    if (target.platform_role === 'super_admin' && actor.platform_role !== 'super_admin') return respond(request, { error: 'cannot_manage_super_admin' }, 403)
    if (payload.targetId === user.id && payload.action !== 'unsuspend_user') return respond(request, { error: 'cannot_restrict_self' }, 409)

    if (payload.action === 'change_role') {
      if (actor.platform_role !== 'super_admin') return respond(request, { error: 'super_admin_required' }, 403)
      if (!payload.role || !['player', 'support', 'admin'].includes(payload.role)) return respond(request, { error: 'invalid_role' }, 400)
      failIf((await admin.auth.admin.updateUserById(payload.targetId, { app_metadata: { platform_role: payload.role } })).error, 'update_auth_role')
      failIf((await admin.from('profiles').update({ platform_role: payload.role, updated_at: new Date().toISOString() }).eq('id', payload.targetId)).error, 'update_profile_role')
      failIf((await admin.from('moderation_actions').insert({ actor_id: user.id, target_user_id: payload.targetId, action: 'role_change', reason, metadata: { from: target.platform_role, to: payload.role } })).error, 'write_audit')
      return respond(request, { ok: true })
    }

    if (payload.action === 'suspend_user') {
      const permanent = payload.durationDays == null
      const days = permanent ? null : Math.max(1, Math.min(3650, Math.trunc(Number(payload.durationDays))))
      const suspendedUntil = permanent ? '9999-12-31T23:59:59.000Z' : new Date(Date.now() + (days as number) * 86400000).toISOString()
      failIf((await admin.auth.admin.updateUserById(payload.targetId, { ban_duration: permanent ? '876000h' : `${(days as number) * 24}h` })).error, 'ban_user')
      failIf((await admin.from('profiles').update({ suspended_until: suspendedUntil, suspension_reason: reason, updated_at: new Date().toISOString() }).eq('id', payload.targetId)).error, 'suspend_profile')
      failIf((await admin.from('moderation_actions').insert({ actor_id: user.id, target_user_id: payload.targetId, action: 'suspend', reason, metadata: { duration_days: days, permanent } })).error, 'write_audit')
    } else if (payload.action === 'unsuspend_user') {
      failIf((await admin.auth.admin.updateUserById(payload.targetId, { ban_duration: 'none' })).error, 'unban_user')
      failIf((await admin.from('profiles').update({ suspended_until: null, suspension_reason: null, updated_at: new Date().toISOString() }).eq('id', payload.targetId)).error, 'restore_profile')
      failIf((await admin.from('moderation_actions').insert({ actor_id: user.id, target_user_id: payload.targetId, action: 'unsuspend', reason })).error, 'write_audit')
    } else if (payload.action === 'deactivate_user') {
      failIf((await admin.auth.admin.updateUserById(payload.targetId, { ban_duration: '876000h' })).error, 'deactivate_auth')
      failIf((await admin.from('profiles').update({ deleted_at: new Date().toISOString(), suspension_reason: reason, updated_at: new Date().toISOString() }).eq('id', payload.targetId)).error, 'deactivate_profile')
      failIf((await admin.from('moderation_actions').insert({ actor_id: user.id, target_user_id: payload.targetId, action: 'soft_delete', reason })).error, 'write_audit')
    } else {
      return respond(request, { error: 'unsupported_action' }, 400)
    }

    return respond(request, { ok: true })
  } catch (error) {
    logEdgeFailure('admin-actions', request, error)
    return respond(request, { error: safeErrorCode(error) }, 500)
  }
})
