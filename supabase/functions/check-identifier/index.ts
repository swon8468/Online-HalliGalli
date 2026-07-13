import { createClient } from 'npm:@supabase/supabase-js@2.95.0'

const allowedOrigins = new Set((Deno.env.get('ALLOWED_ORIGINS') ?? [
  'https://develop.haligali.swonport.kr',
  'https://haligali.swonport.kr',
  'http://127.0.0.1:43127',
  'http://localhost:43127',
].join(',')).split(',').map(value => value.trim()).filter(Boolean))

function isAllowedOrigin(origin: string) {
  return allowedOrigins.has(origin) || /^http:\/\/(localhost|127\.0\.0\.1):\d+$/.test(origin)
}

function response(request: Request, body: unknown, status = 200) {
  const origin = request.headers.get('origin') ?? ''
  return Response.json(body, { status, headers: {
    ...(isAllowedOrigin(origin) ? { 'Access-Control-Allow-Origin': origin } : {}),
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Vary': 'Origin',
  } })
}

async function sha256(value: string) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('')
}

Deno.serve(async request => {
  const origin = request.headers.get('origin') ?? ''
  if (!isAllowedOrigin(origin)) return response(request, { error: 'origin_not_allowed' }, 403)
  if (request.method === 'OPTIONS') return response(request, { ok: true })
  if (request.method !== 'POST') return response(request, { error: 'method_not_allowed' }, 405)

  const payload = await request.json().catch(() => ({})) as { type?: 'email' | 'phone'; value?: string }
  const normalized = payload.type === 'email' ? payload.value?.trim().toLowerCase() ?? '' : payload.value?.replaceAll(/[^0-9]/g, '') ?? ''
  const valid = payload.type === 'email' ? /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized) : normalized.length >= 9 && normalized.length <= 15
  if (!valid) return response(request, { error: 'invalid_identifier' }, 400)

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  const admin = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false, autoRefreshToken: false } })
  const forwardedFor = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? request.headers.get('cf-connecting-ip') ?? 'unknown'
  const fingerprint = await sha256(`${forwardedFor}|${request.headers.get('user-agent') ?? 'unknown'}`)
  const { data: allowed, error: limitError } = await admin.rpc('consume_identifier_check', { p_fingerprint_hash: fingerprint })
  if (limitError || !allowed) return response(request, { error: 'rate_limited' }, 429)

  const identifierHash = await sha256(normalized)
  const column = payload.type === 'email' ? 'email_hash' : 'phone_hash'
  const { count, error } = await admin.from('identity_registry').select('user_id', { count: 'exact', head: true }).eq(column, identifierHash)
  if (error) return response(request, { error: 'availability_check_failed' }, 500)
  return response(request, { available: (count ?? 0) === 0 })
})
