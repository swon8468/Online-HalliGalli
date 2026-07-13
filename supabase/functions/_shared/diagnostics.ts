const requestIds = new WeakMap<Request, string>()

export function edgeRequestId(request: Request) {
  const existing = requestIds.get(request)
  if (existing) return existing
  const supplied = request.headers.get('x-request-id')?.trim() ?? ''
  const value = /^[A-Za-z0-9._-]{8,80}$/.test(supplied)
    ? supplied
    : `EDGE-${Date.now().toString(36).toUpperCase()}-${crypto.randomUUID().slice(0, 8).toUpperCase()}`
  requestIds.set(request, value)
  return value
}

export function diagnosticHeaders(request: Request) {
  return {
    'X-Request-ID': edgeRequestId(request),
    'Access-Control-Expose-Headers': 'X-Request-ID',
  }
}

export function safeErrorCode(error: unknown) {
  const raw = error instanceof Error ? error.message : 'internal_error'
  const candidate = raw.split(':', 1)[0].trim().toLowerCase().replaceAll(/[^a-z0-9_]/g, '_')
  return candidate && candidate.length <= 64 ? candidate : 'internal_error'
}

export function diagnosticBody(request: Request, body: unknown) {
  if (!body || typeof body !== 'object' || Array.isArray(body) || !('error' in body)) return body
  return { ...body, requestId: edgeRequestId(request) }
}

export function logEdgeFailure(functionName: string, request: Request, error: unknown) {
  console.error(JSON.stringify({
    level: 'error',
    function: functionName,
    requestId: edgeRequestId(request),
    code: safeErrorCode(error),
  }))
}
