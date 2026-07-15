import { appEnvironment } from './environment'
import { createUuid } from './id'
import { supabase } from './supabase'

type DiagnosticSeverity = 'info' | 'warning' | 'error' | 'critical'

interface DiagnosticContext {
  severity?: DiagnosticSeverity
  gameId?: string | null
  roomId?: string | null
  actionId?: string | null
  cardId?: string | null
  reconnectCount?: number | null
}

const requestId = createUuid()
const appBuildVersion = (import.meta.env.VITE_CF_PAGES_COMMIT_SHA || import.meta.env.VITE_APP_BUILD_VERSION || 'local').slice(0, 64)
const pwaVersion = (import.meta.env.VITE_PWA_VERSION || appBuildVersion).slice(0, 64)

function deviceFamily() {
  const agent = navigator.userAgent.toLowerCase()
  const browser = agent.includes('firefox') ? 'firefox'
    : agent.includes('chrome') || agent.includes('chromium') || agent.includes('edg/') ? 'chromium'
      : agent.includes('safari') ? 'safari' : 'other'
  const os = agent.includes('android') ? 'android'
    : /iphone|ipad|ipod/.test(agent) ? 'ios'
      : agent.includes('mac os') ? 'macos'
        : agent.includes('windows') ? 'windows'
          : agent.includes('linux') ? 'linux' : 'other'
  return { browser, os }
}

export function recordClientDiagnostic(category: string, context: DiagnosticContext = {}) {
  if (!supabase || typeof navigator === 'undefined') return
  const { browser, os } = deviceFamily()
  void supabase.rpc('record_client_diagnostic', {
    p_environment: appEnvironment,
    p_severity: context.severity ?? 'info',
    p_category: category,
    p_request_id: requestId,
    p_game_id: context.gameId ?? null,
    p_room_id: context.roomId ?? null,
    p_action_id: context.actionId ?? null,
    p_card_id: context.cardId ?? null,
    p_reconnect_count: context.reconnectCount ?? null,
    p_pwa_version: pwaVersion,
    p_app_build_version: appBuildVersion,
    p_browser_family: browser,
    p_os_family: os,
  }).then(() => undefined, () => undefined)
}
