import { createClient } from 'npm:@supabase/supabase-js@2.95.0'

const allowedOrigins = new Set((Deno.env.get('ALLOWED_ORIGINS') ?? [
  'https://develop.admin.haligali.swonport.kr',
  'https://admin.haligali.swonport.kr',
  'http://127.0.0.1:43127',
  'http://localhost:43127',
].join(',')).split(',').map(value => value.trim()).filter(Boolean))

function isAllowedOrigin(origin: string) {
  return allowedOrigins.has(origin) || /^http:\/\/(localhost|127\.0\.0\.1):\d+$/.test(origin)
}

function response(request: Request, body: unknown, status = 200) {
  const origin = request.headers.get('origin') ?? ''
  return Response.json(body, {
    status,
    headers: {
      ...(isAllowedOrigin(origin) ? { 'Access-Control-Allow-Origin': origin } : {}),
      'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Vary': 'Origin',
    },
  })
}

async function safeEqual(left: string, right: string) {
  const encoder = new TextEncoder()
  const [leftHash, rightHash] = await Promise.all([
    crypto.subtle.digest('SHA-256', encoder.encode(left)),
    crypto.subtle.digest('SHA-256', encoder.encode(right)),
  ])
  const a = new Uint8Array(leftHash)
  const b = new Uint8Array(rightHash)
  let difference = a.length ^ b.length
  for (let index = 0; index < Math.max(a.length, b.length); index += 1) difference |= (a[index] ?? 0) ^ (b[index] ?? 0)
  return difference === 0
}

Deno.serve(async request => {
  const origin = request.headers.get('origin') ?? ''
  if (!isAllowedOrigin(origin)) return response(request, { error: 'origin_not_allowed' }, 403)
  if (request.method === 'OPTIONS') return response(request, { ok: true })
  if (request.method !== 'POST') return response(request, { error: 'method_not_allowed' }, 405)

  const supabaseUrl = Deno.env.get('SUPABASE_URL')
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  const expectedSecret = Deno.env.get('BOOTSTRAP_SECRET')
  if (!supabaseUrl || !serviceRoleKey || !expectedSecret) return response(request, { error: 'server_not_configured' }, 503)

  const admin = createClient(supabaseUrl, serviceRoleKey, { auth: { autoRefreshToken: false, persistSession: false } })
  const payload = await request.json().catch(() => ({})) as Record<string, string>

  const { data: bootstrap } = await admin.from('platform_bootstrap').select('consumed_at').eq('singleton', true).single()
  if (payload.action === 'status') return response(request, { available: !bootstrap?.consumed_at })
  if (bootstrap?.consumed_at) return response(request, { error: 'bootstrap_already_completed' }, 409)
  if (!await safeEqual(payload.secret ?? '', expectedSecret)) return response(request, { error: 'invalid_bootstrap_secret' }, 403)

  const email = payload.email?.trim().toLowerCase()
  const nickname = payload.nickname?.trim()
  const password = payload.password ?? ''
  if (!email || !email.includes('@') || !nickname || nickname.length < 2 || password.length < 12) {
    return response(request, { error: 'invalid_account_data' }, 400)
  }

  const { data: created, error: createError } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { nickname },
    app_metadata: { platform_role: 'super_admin' },
  })
  if (createError || !created.user) return response(request, { error: 'user_creation_failed' }, 400)

  const { error: bootstrapError } = await admin.rpc('complete_platform_bootstrap', { p_user_id: created.user.id })
  if (bootstrapError) {
    await admin.auth.admin.deleteUser(created.user.id)
    return response(request, { error: 'bootstrap_failed' }, 409)
  }

  return response(request, { created: true })
})
