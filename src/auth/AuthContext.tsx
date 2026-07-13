import type { User } from '@supabase/supabase-js'
import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { supabase } from '../lib/supabase'

interface AppUser {
  id: string
  label: string
  source: 'supabase' | 'demo'
  role: 'player' | 'support' | 'admin' | 'super_admin'
}

interface AuthContextValue {
  user: AppUser | null
  loading: boolean
  signIn: (identifier: string, password: string) => Promise<void>
  signUp: (identifier: string, password: string, nickname: string) => Promise<void>
  signOut: () => Promise<void>
}

const AuthContext = createContext<AuthContextValue | null>(null)
const DEMO_USER_KEY = 'halli-galli-demo-user'

function mapUser(user: User): AppUser {
  return {
    id: user.id,
    label: user.user_metadata.nickname ?? user.email ?? user.phone ?? '플레이어',
    source: 'supabase',
    role: user.app_metadata.platform_role ?? 'player',
  }
}

function credentials(identifier: string, password: string) {
  const normalized = identifier.trim()
  return normalized.includes('@') ? { email: normalized, password } : { phone: normalized, password }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AppUser | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!supabase) {
      const saved = localStorage.getItem(DEMO_USER_KEY)
      setUser(saved ? JSON.parse(saved) as AppUser : null)
      setLoading(false)
      return
    }

    void supabase.auth.getUser().then(({ data }) => {
      setUser(data.user ? mapUser(data.user) : null)
      setLoading(false)
    })
    const { data } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ? mapUser(session.user) : null)
      setLoading(false)
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
        if (data.user) setUser(mapUser(data.user))
        return
      }
      const isAdminSurface = window.location.hostname.includes('admin.') || window.location.pathname.startsWith('/admin')
      const demoUser: AppUser = { id: crypto.randomUUID(), label: identifier.split('@')[0] || '플레이어', source: 'demo', role: isAdminSurface ? 'super_admin' : 'player' }
      localStorage.setItem(DEMO_USER_KEY, JSON.stringify(demoUser))
      setUser(demoUser)
    },
    signUp: async (identifier, password, nickname) => {
      if (supabase) {
        const { data, error } = await supabase.auth.signUp({ ...credentials(identifier, password), options: { data: { nickname } } })
        if (error) throw error
        if (data.user) setUser(mapUser(data.user))
        return
      }
      const demoUser: AppUser = { id: crypto.randomUUID(), label: nickname, source: 'demo', role: 'player' }
      localStorage.setItem(DEMO_USER_KEY, JSON.stringify(demoUser))
      setUser(demoUser)
    },
    signOut: async () => {
      if (supabase) await supabase.auth.signOut()
      localStorage.removeItem(DEMO_USER_KEY)
      setUser(null)
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
