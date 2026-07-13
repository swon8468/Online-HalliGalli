import { createClient } from 'npm:@supabase/supabase-js@2.95.0'
import webpush from 'npm:web-push@3.6.7'

const configuredOrigins = (Deno.env.get('ALLOWED_ORIGINS') ?? 'https://develop.haligali.swonport.kr,https://haligali.swonport.kr')
  .split(',').map(value => value.trim()).filter(Boolean)

function isAllowedOrigin(origin: string) {
  return configuredOrigins.includes(origin) || /^http:\/\/(localhost|127\.0\.0\.1):\d+$/.test(origin)
}

function corsHeaders(request: Request) {
  const origin = request.headers.get('Origin') ?? ''
  return {
    ...(isAllowedOrigin(origin) ? { 'Access-Control-Allow-Origin': origin } : {}),
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Vary': 'Origin',
  }
}

Deno.serve(async request => {
  const headers = corsHeaders(request)
  const origin = request.headers.get('Origin') ?? ''
  if (origin && !isAllowedOrigin(origin)) return Response.json({ error: 'origin_not_allowed' }, { status: 403, headers })
  if (request.method === 'OPTIONS') return Response.json({ ok: true }, { headers })
  if (request.method !== 'POST') return Response.json({ error: 'method_not_allowed' }, { status: 405, headers })

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  const authorization = request.headers.get('Authorization')
  if (!authorization) return Response.json({ error: 'unauthorized' }, { status: 401, headers })

  const callerClient = createClient(supabaseUrl, anonKey, { global: { headers: { Authorization: authorization } }, auth: { persistSession: false } })
  const { data: { user } } = await callerClient.auth.getUser()
  if (!user) return Response.json({ error: 'unauthorized' }, { status: 401, headers })

  const payload = await request.json().catch(() => ({})) as { inviteId?: string }
  if (!payload.inviteId || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(payload.inviteId)) {
    return Response.json({ error: 'invalid_invite_id' }, { status: 400, headers })
  }

  const admin = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false, autoRefreshToken: false } })
  const sentAt = new Date().toISOString()
  const claimed = await admin.rpc('claim_game_invite_push', {
    p_invite_id: payload.inviteId,
    p_sender_id: user.id,
    p_sent_at: sentAt,
  })
  if (claimed.error) return Response.json({ error: 'push_claim_failed' }, { status: 500, headers })

  const invite = claimed.data as {
    id: string
    sender_id: string
    receiver_id: string
    room_id: string
    status: string
    expires_at: string
    push_sent_at: string
  } | null
  if (!invite) {
    const [existing, actor] = await Promise.all([
      admin.from('game_invites').select('sender_id,status,expires_at,push_sent_at').eq('id', payload.inviteId).maybeSingle(),
      admin.from('profiles').select('deleted_at,suspended_until').eq('id', user.id).maybeSingle(),
    ])
    if (existing.error || actor.error) return Response.json({ error: 'push_lookup_failed' }, { status: 500, headers })
    const actorIsActive = Boolean(actor.data)
      && !actor.data?.deleted_at
      && (!actor.data?.suspended_until || new Date(actor.data.suspended_until) <= new Date())
    if (!actorIsActive) return Response.json({ error: 'account_inactive' }, { status: 403, headers })
    const duplicate = existing.data?.sender_id === user.id
      && existing.data.status === 'pending'
      && new Date(existing.data.expires_at) > new Date()
      && Boolean(existing.data.push_sent_at)
    if (duplicate) return Response.json({ delivered: 0, duplicate: true }, { headers })
    return Response.json({ error: 'invalid_invite' }, { status: 403, headers })
  }

  const [senderResult, subscriptionsResult] = await Promise.all([
    admin.from('profiles').select('nickname').eq('id', user.id).single(),
    admin.from('push_subscriptions').select('id,endpoint,p256dh,auth').eq('user_id', invite.receiver_id),
  ])
  if (senderResult.error || subscriptionsResult.error) return Response.json({ error: 'push_lookup_failed' }, { status: 500, headers })
  const subscriptions = subscriptionsResult.data ?? []
  webpush.setVapidDetails(Deno.env.get('VAPID_SUBJECT')!, Deno.env.get('VAPID_PUBLIC_KEY')!, Deno.env.get('VAPID_PRIVATE_KEY')!)
  const message = JSON.stringify({ title: '게임 초대', body: `${senderResult.data?.nickname ?? '친구'}님이 게임에 초대했어요.`, url: `/join?invite=${invite.id}`, tag: `invite-${invite.id}` })

  let delivered = 0
  let transientFailures = 0
  for (const subscription of subscriptions) {
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        await webpush.sendNotification({ endpoint: subscription.endpoint, keys: { p256dh: subscription.p256dh, auth: subscription.auth } }, message)
        delivered += 1
        break
      } catch (caught) {
        const statusCode = typeof caught === 'object' && caught && 'statusCode' in caught ? Number(caught.statusCode) : 0
        if (statusCode === 404 || statusCode === 410) {
          await admin.from('push_subscriptions').delete().eq('id', subscription.id)
          break
        }
        if (attempt === 0) await new Promise(resolve => setTimeout(resolve, 250))
        else transientFailures += 1
      }
    }
  }

  if (delivered === 0 && transientFailures > 0) {
    const released = await admin.from('game_invites')
      .update({ push_sent_at: null })
      .eq('id', invite.id)
      .eq('push_sent_at', sentAt)
    if (released.error) return Response.json({ error: 'push_claim_release_failed' }, { status: 500, headers })
    return Response.json({ error: 'push_temporarily_unavailable', retryable: true }, { status: 503, headers })
  }

  return Response.json({ delivered, duplicate: false }, { headers })
})
