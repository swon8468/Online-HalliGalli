import { createClient } from '@supabase/supabase-js'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

function isPlaceholder(value: string) {
  return /^(your-|replace[-_ ]?me|example[-_ ]?)/i.test(value.trim())
}

function isValidSupabaseUrl(value?: string) {
  if (!value || isPlaceholder(value)) return false
  try {
    const parsed = new URL(value)
    return (parsed.protocol === 'https:' || parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1') && Boolean(parsed.hostname)
  } catch {
    return false
  }
}

function isValidAnonKey(value?: string) {
  return Boolean(value && value.length >= 20 && !isPlaceholder(value))
}

export const isSupabaseConfigured = isValidSupabaseUrl(supabaseUrl) && isValidAnonKey(supabaseAnonKey)
export const hasInvalidSupabaseConfiguration = Boolean(supabaseUrl || supabaseAnonKey) && !isSupabaseConfigured

export const supabase = isSupabaseConfigured
  ? createClient(supabaseUrl!, supabaseAnonKey!, {
      auth: { persistSession: true, autoRefreshToken: true },
      realtime: { params: { eventsPerSecond: 10 } },
    })
  : null
