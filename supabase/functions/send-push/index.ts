import { createClient } from 'npm:@supabase/supabase-js@2.95.0'
import webpush from 'npm:web-push@3.6.7'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

Deno.serve(async request => {
  if (request.method === 'OPTIONS') return Response.json({ ok: true }, { headers: corsHeaders })
  if (request.method !== 'POST') return Response.json({ error: 'method_not_allowed' }, { status: 405, headers: corsHeaders })

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  const authorization = request.headers.get('Authorization')
  if (!authorization) return Response.json({ error: 'unauthorized' }, { status: 401, headers: corsHeaders })

  const callerClient = createClient(supabaseUrl, anonKey, { global: { headers: { Authorization: authorization } }, auth: { persistSession: false } })
  const { data: { user } } = await callerClient.auth.getUser()
  if (!user) return Response.json({ error: 'unauthorized' }, { status: 401, headers: corsHeaders })

  const payload = await request.json().catch(() => ({})) as { inviteId?: string }
  if (!payload.inviteId) return Response.json({ error: 'invite_id_required' }, { status: 400, headers: corsHeaders })

  const admin = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false, autoRefreshToken: false } })
  const { data: invite } = await admin.from('game_invites').select('id,sender_id,receiver_id,room_id,status,expires_at').eq('id', payload.inviteId).single()
  if (!invite || invite.sender_id !== user.id || invite.status !== 'pending' || new Date(invite.expires_at) <= new Date()) {
    return Response.json({ error: 'invalid_invite' }, { status: 403, headers: corsHeaders })
  }

  const [senderResult, subscriptionsResult] = await Promise.all([
    admin.from('profiles').select('nickname').eq('id', user.id).single(),
    admin.from('push_subscriptions').select('id,endpoint,p256dh,auth').eq('user_id', invite.receiver_id),
  ])
  const subscriptions = subscriptionsResult.data ?? []
  webpush.setVapidDetails(Deno.env.get('VAPID_SUBJECT')!, Deno.env.get('VAPID_PUBLIC_KEY')!, Deno.env.get('VAPID_PRIVATE_KEY')!)
  const message = JSON.stringify({ title: '게임 초대', body: `${senderResult.data?.nickname ?? '친구'}님이 게임에 초대했어요.`, url: `/join?invite=${invite.id}`, tag: `invite-${invite.id}` })

  let delivered = 0
  for (const subscription of subscriptions) {
    try {
      await webpush.sendNotification({ endpoint: subscription.endpoint, keys: { p256dh: subscription.p256dh, auth: subscription.auth } }, message)
      delivered += 1
    } catch (caught) {
      const statusCode = typeof caught === 'object' && caught && 'statusCode' in caught ? Number(caught.statusCode) : 0
      if (statusCode === 404 || statusCode === 410) await admin.from('push_subscriptions').delete().eq('id', subscription.id)
    }
  }

  return Response.json({ delivered }, { headers: corsHeaders })
})
