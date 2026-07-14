import { createClient } from 'npm:@supabase/supabase-js@2.95.0'
import { diagnosticBody, diagnosticHeaders, logEdgeFailure, safeErrorCode } from '../_shared/diagnostics.ts'

const functionName = 'delete-card-set'
const allowedOrigins = new Set((Deno.env.get('ALLOWED_ORIGINS') ?? [
  'https://develop.admin.haligali.swonport.kr',
  'https://admin.haligali.swonport.kr',
  'https://develop.haligali.swonport.kr',
  'https://haligali.swonport.kr',
].join(',')).split(',').map(value => value.trim()).filter(Boolean))

function isAllowedOrigin(origin: string) {
  return allowedOrigins.has(origin) || /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)
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

function respond(request: Request, body: unknown, status = 200) {
  return Response.json(diagnosticBody(request, body), { status, headers: headers(request) })
}

async function listAssetPaths(admin: ReturnType<typeof createClient>, cardSetId: string) {
  const paths: string[] = []
  for (let offset = 0; ; offset += 1000) {
    const listed = await admin.storage.from('card-assets').list(cardSetId, { limit: 1000, offset })
    if (listed.error) throw new Error(`storage_list_failed: ${listed.error.message}`)
    paths.push(...listed.data.filter(item => item.id).map(item => `${cardSetId}/${item.name}`))
    if (listed.data.length < 1000) return paths
  }
}

Deno.serve(async request => {
  const origin = request.headers.get('Origin') ?? ''
  if (origin && !isAllowedOrigin(origin)) return respond(request, { error: 'origin_not_allowed' }, 403)
  if (request.method === 'OPTIONS') return respond(request, { ok: true })
  if (request.method !== 'POST') return respond(request, { error: 'method_not_allowed' }, 405)

  try {
    const authorization = request.headers.get('Authorization')
    if (!authorization) return respond(request, { error: 'unauthorized' }, 401)
    const payload = await request.json().catch(() => ({})) as { cardSetId?: string }
    if (!payload.cardSetId || !/^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(payload.cardSetId)) {
      return respond(request, { error: 'invalid_card_set' }, 400)
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    const caller = createClient(supabaseUrl, anonKey, { global: { headers: { Authorization: authorization } }, auth: { persistSession: false } })
    const { data: { user } } = await caller.auth.getUser()
    if (!user) return respond(request, { error: 'unauthorized' }, 401)

    const admin = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false, autoRefreshToken: false } })
    const [manageable, cardSet, rooms] = await Promise.all([
      admin.rpc('can_manage_card_set', { p_card_set_id: payload.cardSetId, p_user_id: user.id }),
      admin.from('card_sets').select('id,is_platform_default').eq('id', payload.cardSetId).maybeSingle(),
      admin.from('rooms').select('id', { count: 'exact', head: true }).eq('card_set_id', payload.cardSetId),
    ])
    const lookupError = manageable.error ?? cardSet.error ?? rooms.error
    if (lookupError) throw new Error(`card_set_lookup_failed: ${lookupError.message}`)
    if (!cardSet.data || !manageable.data) return respond(request, { error: 'card_set_access_denied' }, 403)
    if (cardSet.data.is_platform_default) return respond(request, { error: 'cannot_delete_default' }, 409)
    if ((rooms.count ?? 0) > 0) return respond(request, { error: 'card_set_in_use' }, 409)

    const assetPaths = await listAssetPaths(admin, payload.cardSetId)
    const removedSet = await admin.from('card_sets').delete().eq('id', payload.cardSetId).eq('is_platform_default', false).select('id').maybeSingle()
    if (removedSet.error) {
      const code = removedSet.error.code === '23503' ? 'card_set_in_use' : 'card_set_delete_failed'
      return respond(request, { error: code }, removedSet.error.code === '23503' ? 409 : 500)
    }
    if (!removedSet.data) return respond(request, { error: 'card_set_not_found' }, 404)

    if (assetPaths.length) {
      let storageError: Error | null = null
      for (let attempt = 0; attempt < 3; attempt += 1) {
        const removedAssets = await admin.storage.from('card-assets').remove(assetPaths)
        if (removedAssets.error) {
          storageError = new Error(`storage_remove_failed: ${removedAssets.error.message}`)
          continue
        }
        const remaining = await listAssetPaths(admin, payload.cardSetId)
        if (!remaining.some(path => assetPaths.includes(path))) {
          storageError = null
          break
        }
        storageError = new Error(`storage_remove_incomplete: ${remaining.length}`)
      }
      if (storageError) {
        logEdgeFailure(functionName, request, storageError)
        return respond(request, { ok: true, removedAssets: 0, storageCleanupPending: true }, 202)
      }
    }

    return respond(request, { ok: true, removedAssets: assetPaths.length, storageCleanupPending: false })
  } catch (error) {
    logEdgeFailure(functionName, request, error)
    return respond(request, { error: safeErrorCode(error) }, 500)
  }
})
