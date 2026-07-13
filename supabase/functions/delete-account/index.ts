import { createClient } from 'npm:@supabase/supabase-js@2.95.0'

const allowedOrigins = (Deno.env.get('ALLOWED_ORIGINS') ?? 'https://develop.haligali.swonport.kr,https://haligali.swonport.kr').split(',').map(value => value.trim())
const headersFor = (request: Request) => {
  const origin = request.headers.get('Origin') ?? ''
  const allowed = allowedOrigins.includes(origin) || /^http:\/\/(localhost|127\.0\.0\.1):\d+$/.test(origin)
  return { 'Access-Control-Allow-Origin': allowed ? origin : allowedOrigins[0], 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type', 'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Vary': 'Origin' }
}

Deno.serve(async request => {
  const headers = headersFor(request)
  const origin = request.headers.get('Origin') ?? ''
  if (origin && headers['Access-Control-Allow-Origin'] !== origin) return Response.json({ error: 'origin_not_allowed' }, { status: 403, headers })
  if (request.method === 'OPTIONS') return Response.json({ ok: true }, { headers })
  if (request.method !== 'POST') return Response.json({ error: 'method_not_allowed' }, { status: 405, headers })
  const authorization = request.headers.get('Authorization')
  if (!authorization) return Response.json({ error: 'unauthorized' }, { status: 401, headers })
  const url = Deno.env.get('SUPABASE_URL')!, anon = Deno.env.get('SUPABASE_ANON_KEY')!, service = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  const caller = createClient(url, anon, { global: { headers: { Authorization: authorization } }, auth: { persistSession: false } })
  const { data: { user } } = await caller.auth.getUser()
  if (!user) return Response.json({ error: 'unauthorized' }, { status: 401, headers })
  const body = await request.json().catch(() => ({})) as { confirmation?: string }
  if (body.confirmation !== '회원 탈퇴') return Response.json({ error: 'invalid_confirmation' }, { status: 400, headers })
  const admin = createClient(url, service, { auth: { persistSession: false, autoRefreshToken: false } })
  const deletedTag = `deleted#${user.id.replaceAll('-', '').slice(0, 8)}`
  const profile = await admin.from('profiles').update({ nickname: '탈퇴한 사용자', friend_tag: deletedTag, deleted_at: new Date().toISOString(), suspension_reason: '사용자 직접 탈퇴' }).eq('id', user.id)
  if (profile.error) return Response.json({ error: 'profile_delete_failed' }, { status: 500, headers })
  await admin.from('matchmaking_queue').delete().eq('user_id', user.id)
  await admin.from('game_invites').update({ status: 'cancelled', updated_at: new Date().toISOString() }).eq('status', 'pending').or(`sender_id.eq.${user.id},receiver_id.eq.${user.id}`)
  const banned = await admin.auth.admin.updateUserById(user.id, { ban_duration: '876000h', user_metadata: { ...user.user_metadata, nickname: '탈퇴한 사용자' } })
  if (banned.error) return Response.json({ error: 'auth_delete_failed' }, { status: 500, headers })
  return Response.json({ ok: true }, { headers })
})
