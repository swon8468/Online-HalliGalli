import { createClient } from 'npm:@supabase/supabase-js@2.95.0'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

type AdminAction = 'suspend_user' | 'unsuspend_user' | 'deactivate_user' | 'close_room'

Deno.serve(async request => {
  if (request.method === 'OPTIONS') return Response.json({ ok: true }, { headers: corsHeaders })
  if (request.method !== 'POST') return Response.json({ error: 'method_not_allowed' }, { status: 405, headers: corsHeaders })

  const authorization = request.headers.get('Authorization')
  if (!authorization) return Response.json({ error: 'unauthorized' }, { status: 401, headers: corsHeaders })
  const supabaseUrl = Deno.env.get('SUPABASE_URL')!
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  const callerClient = createClient(supabaseUrl, anonKey, { global: { headers: { Authorization: authorization } }, auth: { persistSession: false } })
  const { data: { user } } = await callerClient.auth.getUser()
  if (!user) return Response.json({ error: 'unauthorized' }, { status: 401, headers: corsHeaders })

  const admin = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false, autoRefreshToken: false } })
  const { data: actor } = await admin.from('profiles').select('platform_role').eq('id', user.id).single()
  if (!actor || !['admin', 'super_admin'].includes(actor.platform_role)) return Response.json({ error: 'forbidden' }, { status: 403, headers: corsHeaders })

  const payload = await request.json().catch(() => ({})) as { action?: AdminAction; targetId?: string; reason?: string }
  const reason = payload.reason?.trim() || 'Platform administrator action'
  if (!payload.action || !payload.targetId) return Response.json({ error: 'invalid_request' }, { status: 400, headers: corsHeaders })

  if (payload.action === 'close_room') {
    const { error } = await admin.from('rooms').update({ status: 'closed', updated_at: new Date().toISOString() }).eq('id', payload.targetId)
    if (error) return Response.json({ error: error.message }, { status: 400, headers: corsHeaders })
    await admin.from('moderation_actions').insert({ actor_id: user.id, target_room_id: payload.targetId, action: 'close_room', reason })
    return Response.json({ ok: true }, { headers: corsHeaders })
  }

  const { data: target } = await admin.from('profiles').select('platform_role').eq('id', payload.targetId).single()
  if (!target) return Response.json({ error: 'user_not_found' }, { status: 404, headers: corsHeaders })
  if (target.platform_role === 'super_admin' && actor.platform_role !== 'super_admin') return Response.json({ error: 'cannot_manage_super_admin' }, { status: 403, headers: corsHeaders })
  if (payload.targetId === user.id && payload.action !== 'unsuspend_user') return Response.json({ error: 'cannot_restrict_self' }, { status: 409, headers: corsHeaders })

  if (payload.action === 'suspend_user') {
    const suspendedUntil = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString()
    await admin.auth.admin.updateUserById(payload.targetId, { ban_duration: '720h' })
    await admin.from('profiles').update({ suspended_until: suspendedUntil, suspension_reason: reason }).eq('id', payload.targetId)
    await admin.from('moderation_actions').insert({ actor_id: user.id, target_user_id: payload.targetId, action: 'suspend', reason, metadata: { duration_days: 30 } })
  } else if (payload.action === 'unsuspend_user') {
    await admin.auth.admin.updateUserById(payload.targetId, { ban_duration: 'none' })
    await admin.from('profiles').update({ suspended_until: null, suspension_reason: null }).eq('id', payload.targetId)
    await admin.from('moderation_actions').insert({ actor_id: user.id, target_user_id: payload.targetId, action: 'unsuspend', reason })
  } else if (payload.action === 'deactivate_user') {
    await admin.auth.admin.updateUserById(payload.targetId, { ban_duration: '876000h' })
    await admin.from('profiles').update({ deleted_at: new Date().toISOString(), suspension_reason: reason }).eq('id', payload.targetId)
    await admin.from('moderation_actions').insert({ actor_id: user.id, target_user_id: payload.targetId, action: 'soft_delete', reason })
  } else {
    return Response.json({ error: 'unsupported_action' }, { status: 400, headers: corsHeaders })
  }

  return Response.json({ ok: true }, { headers: corsHeaders })
})
