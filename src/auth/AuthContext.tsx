import type { User } from '@supabase/supabase-js'
import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { supabase } from '../lib/supabase'
import { createUuid } from '../lib/id'

interface AppUser {
  id: string
  label: string
  source: 'supabase' | 'demo'
  role: 'player' | 'support' | 'admin' | 'super_admin'
  email: string | null
  phone: string | null
  emailConfirmed: boolean
  phoneConfirmed: boolean
}

interface AuthContextValue {
  user: AppUser | null
  loading: boolean
  signIn: (identifier: string, password: string) => Promise<void>
  signUp: (identifier: string, password: string, nickname: string) => Promise<{ requiresVerification: boolean }>
  signOut: () => Promise<void>
  signOutAll: () => Promise<void>
  refreshUser: () => Promise<void>
}

const AuthContext = createContext<AuthContextValue | null>(null)
const DEMO_USER_KEY = 'halli-galli-demo-user'

function mapUser(user: User): AppUser {
  return {
    id: user.id,
    label: user.user_metadata.nickname ?? user.email ?? user.phone ?? '플레이어',
    source: 'supabase',
    role: user.app_metadata.platform_role ?? 'player',
    email: user.email ?? null,
    phone: user.phone ?? null,
    emailConfirmed: Boolean(user.email_confirmed_at),
    phoneConfirmed: Boolean(user.phone_confirmed_at),
  }
}

function credentials(identifier: string, password: string) {
  const normalized = identifier.trim()
  return normalized.includes('@') ? { email: normalized, password } : { phone: normalized, password }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AppUser | null>(null)
  const [loading, setLoading] = useState(true)

  const resolveUser = async (authUser: User | null) => {
    if (!authUser || !supabase) return authUser ? mapUser(authUser) : null
    const { data: profile } = await supabase.from('profiles').select('nickname,platform_role,suspended_until,suspension_reason,deleted_at').eq('id', authUser.id).maybeSingle()
    if (profile?.deleted_at) throw new Error('account_deleted')
    if (profile?.suspended_until && new Date(profile.suspended_until) > new Date()) throw new Error(`account_suspended:${profile.suspension_reason ?? ''}`)
    return { ...mapUser(authUser), label: profile?.nickname ?? mapUser(authUser).label, role: profile?.platform_role ?? mapUser(authUser).role }
  }

  useEffect(() => {
    if (!supabase) {
      const saved = localStorage.getItem(DEMO_USER_KEY)
      setUser(saved ? JSON.parse(saved) as AppUser : null)
      setLoading(false)
      return
    }
    const client = supabase

    void client.auth.getUser().then(({ data }) => resolveUser(data.user)).then(setUser).catch(() => { setUser(null); void client.auth.signOut() }).finally(() => setLoading(false))
    const { data } = client.auth.onAuthStateChange((_event, session) => {
      void resolveUser(session?.user ?? null).then(setUser).catch(() => { setUser(null); void client.auth.signOut() }).finally(() => setLoading(false))
    })
    return () => data.subscription.unsubscribe()
  }, [])

  const value = useMemo<AuthContextValue>(() => ({
    user,
    loading,
    signIn: async (identifier, password) => {
      if (supabase) {
        const { data, error } = await supabase.auth.signInWithPassword(credentials(identifier, password))
        if (error) throw error
        if (data.user) {
          try { setUser(await resolveUser(data.user)) }
          catch (cause) { await supabase.auth.signOut(); throw cause }
        }
        return
      }
      const demoUser: AppUser = { id: createUuid(), label: identifier.split('@')[0] || '플레이어', source: 'demo', role: 'player', email: identifier.includes('@') ? identifier : null, phone: identifier.includes('@') ? null : identifier, emailConfirmed: false, phoneConfirmed: false }
      localStorage.setItem(DEMO_USER_KEY, JSON.stringify(demoUser))
      setUser(demoUser)
    },
    signUp: async (identifier, password, nickname) => {
      if (supabase) {
        const { data, error } = await supabase.auth.signUp({ ...credentials(identifier, password), options: { data: { nickname } } })
        if (error) throw error
        if (data.user && data.session) setUser(await resolveUser(data.user))
        else setUser(null)
        return { requiresVerification: Boolean(data.user && !data.session) }
      }
      const demoUser: AppUser = { id: createUuid(), label: nickname, source: 'demo', role: 'player', email: identifier.includes('@') ? identifier : null, phone: identifier.includes('@') ? null : identifier, emailConfirmed: false, phoneConfirmed: false }
      localStorage.setItem(DEMO_USER_KEY, JSON.stringify(demoUser))
      setUser(demoUser)
      return { requiresVerification: false }
    },
    signOut: async () => {
      if (supabase) await supabase.auth.signOut()
      localStorage.removeItem(DEMO_USER_KEY)
      setUser(null)
    },
    signOutAll: async () => {
      if (supabase) await supabase.auth.signOut({ scope: 'global' })
      localStorage.removeItem(DEMO_USER_KEY)
      setUser(null)
    },
    refreshUser: async () => {
      if (!supabase) return
      const { data } = await supabase.auth.getUser()
      setUser(await resolveUser(data.user))
    },
  }), [user, loading])

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

// Context and hook intentionally live together to keep the auth boundary cohesive.
// eslint-disable-next-line react-refresh/only-export-components
export function useAuth() {
  const context = useContext(AuthContext)
  if (!context) throw new Error('useAuth must be used inside AuthProvider')
  return context
}
