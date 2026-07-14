import type { User } from '@supabase/supabase-js'
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
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
  const sessionRejectionRef = useRef<Promise<void> | null>(null)
  const interactiveAuthRef = useRef(false)

  const rejectSession = useCallback(async () => {
    setUser(null)
    if (!supabase) return
    if (!sessionRejectionRef.current) {
      sessionRejectionRef.current = supabase.auth.signOut({ scope: 'local' }).then(() => undefined).finally(() => {
        sessionRejectionRef.current = null
      })
    }
    await sessionRejectionRef.current
  }, [])

  const resolveUser = async (authUser: User | null) => {
    if (!authUser || !supabase) return authUser ? mapUser(authUser) : null
    const { data: profile, error } = await supabase.from('profiles').select('nickname,platform_role,suspended_until,suspension_reason,deleted_at').eq('id', authUser.id).maybeSingle()
    // Authentication alone is not enough to authorize the app. The profile is
    // the source of truth for suspension, deletion and platform permissions, so
    // fail closed when its state cannot be verified.
    if (error) throw new Error('profile_check_failed')
    if (!profile) throw new Error('account_unavailable')
    if (profile?.deleted_at) throw new Error('account_deleted')
    if (profile?.suspended_until && new Date(profile.suspended_until) > new Date()) throw new Error(`account_suspended:${profile.suspension_reason ?? ''}`)
    return { ...mapUser(authUser), label: profile.nickname ?? mapUser(authUser).label, role: profile.platform_role ?? mapUser(authUser).role }
  }

  useEffect(() => {
    if (!supabase) {
      const saved = localStorage.getItem(DEMO_USER_KEY)
      setUser(saved ? JSON.parse(saved) as AppUser : null)
      setLoading(false)
      return
    }
    const client = supabase

    void client.auth.getUser().then(({ data, error }) => {
      if (error) throw error
      return resolveUser(data.user)
    }).then(setUser).catch(() => rejectSession()).finally(() => setLoading(false))
    const { data } = client.auth.onAuthStateChange((_event, session) => {
      // signIn/signUp validates the same session itself. Processing the nested
      // event here can attempt signOut while the Auth client still owns its lock.
      if (interactiveAuthRef.current) return
      void resolveUser(session?.user ?? null).then(setUser).catch(() => rejectSession()).finally(() => setLoading(false))
    })
    return () => data.subscription.unsubscribe()
  }, [rejectSession])

  const value = useMemo<AuthContextValue>(() => ({
    user,
    loading,
    signIn: async (identifier, password) => {
      if (supabase) {
        interactiveAuthRef.current = true
        try {
          const { data, error } = await supabase.auth.signInWithPassword(credentials(identifier, password))
          if (error) throw error
          if (data.user) {
            try { setUser(await resolveUser(data.user)) }
            catch (cause) { await rejectSession(); throw cause }
          }
        } finally {
          interactiveAuthRef.current = false
        }
        return
      }
      const demoUser: AppUser = { id: createUuid(), label: identifier.split('@')[0] || '플레이어', source: 'demo', role: 'player', email: identifier.includes('@') ? identifier : null, phone: identifier.includes('@') ? null : identifier, emailConfirmed: false, phoneConfirmed: false }
      localStorage.setItem(DEMO_USER_KEY, JSON.stringify(demoUser))
      setUser(demoUser)
    },
    signUp: async (identifier, password, nickname) => {
      if (supabase) {
        interactiveAuthRef.current = true
        try {
          const { data, error } = await supabase.auth.signUp({ ...credentials(identifier, password), options: { data: { nickname } } })
          if (error) throw error
          if (data.user && data.session) {
            try { setUser(await resolveUser(data.user)) }
            catch (cause) { await rejectSession(); throw cause }
          } else setUser(null)
          return { requiresVerification: Boolean(data.user && !data.session) }
        } finally {
          interactiveAuthRef.current = false
        }
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
      const { data, error } = await supabase.auth.getUser()
      if (error) {
        await rejectSession()
        throw error
      }
      try { setUser(await resolveUser(data.user)) }
      catch (cause) { await rejectSession(); throw cause }
    },
  }), [user, loading, rejectSession])

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

// Context and hook intentionally live together to keep the auth boundary cohesive.
// eslint-disable-next-line react-refresh/only-export-components
export function useAuth() {
  const context = useContext(AuthContext)
  if (!context) throw new Error('useAuth must be used inside AuthProvider')
  return context
}
