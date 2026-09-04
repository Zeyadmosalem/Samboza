import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import type { Session } from '@supabase/supabase-js'
import { supabase, type Family, type Person } from './supabase'

/**
 * Authentication is PER PERSON; the family is the context you then work in.
 *
 * You sign in as yourself, your auth identity resolves to one or more `people`
 * rows each carrying a family_id, and you pick which family to open. One human
 * can belong to several families, and a family holds people who cannot log in
 * at all — binding auth to the person rather than the family handles both
 * without a special case. See plan §2.4.
 */

/** A week, as agreed. Sessions time out even on a device left signed in. */
const SESSION_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000
const SIGNED_IN_AT = 'samboza-signed-in-at'

interface AuthState {
  loading: boolean
  session: Session | null
  person: Person | null
  family: Family | null
  /** Every family this human belongs to; more than one is possible. */
  memberships: { person: Person; family: Family }[]
  /**
   * The membership lookup FAILED, as opposed to returning nothing. The two
   * are completely different — one is "you were removed", the other is "the
   * train went into a tunnel" — and showing the first message for the second
   * accuses the family of a permissions problem they do not have.
   */
  membershipError: boolean
  signIn: (email: string, password: string) => Promise<{ error: string | null }>
  signOut: () => Promise<void>
  chooseFamily: (familyId: string) => void
  /** Retry the membership lookup after a failure. */
  reload: () => void
}

const Ctx = createContext<AuthState | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [loading, setLoading] = useState(true)
  const [session, setSession] = useState<Session | null>(null)
  const [memberships, setMemberships] = useState<AuthState['memberships']>([])
  const [membershipError, setMembershipError] = useState(false)
  const [attempt, setAttempt] = useState(0)
  const [familyId, setFamilyId] = useState<string | null>(
    () => localStorage.getItem('samboza-family')
  )

  /* ---- the weekly time-box ------------------------------------------
     Supabase refreshes tokens indefinitely, so "expires in a week" has to
     be stated somewhere. Set it in the dashboard too — Authentication →
     Sessions → Time-box user sessions → 168 hours — because this check
     only runs while the app is open. Belt and braces: a stolen laptop
     should not stay signed in because nobody reopened the tab. */
  useEffect(() => {
    if (!session) return
    const started = Number(localStorage.getItem(SIGNED_IN_AT) || 0)
    if (!started) {
      localStorage.setItem(SIGNED_IN_AT, String(Date.now()))
      return
    }
    const expire = () => {
      if (Date.now() - started > SESSION_MAX_AGE_MS) void supabase.auth.signOut()
    }
    expire()
    const t = setInterval(expire, 60_000)
    return () => clearInterval(t)
  }, [session])

  /* ---- session ------------------------------------------------------- */
  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session)
      if (!data.session) setLoading(false)
    })
    const { data: sub } = supabase.auth.onAuthStateChange((_event, s) => {
      setSession(s)
      if (!s) {
        setMemberships([])
        localStorage.removeItem(SIGNED_IN_AT)
        setLoading(false)
      }
    })
    return () => sub.subscription.unsubscribe()
  }, [])

  /* ---- who am I, and where ------------------------------------------- */
  useEffect(() => {
    if (!session) return
    let cancelled = false
    ;(async () => {
      const { data, error } = await supabase
        .from('people')
        .select('*, family:families(*)')
        .eq('auth_user_id', session.user.id)
        .eq('active', true)

      if (cancelled) return
      if (error) {
        // The lookup did not run. Distinct from running and finding nothing:
        // a dropped connection is not a revoked account, and telling someone
        // they have been removed from their own family because the wifi went
        // is the kind of message that gets a phone call.
        setMembershipError(true)
        setMemberships([])
        setLoading(false)
        return
      }
      setMembershipError(false)
      if (!data?.length) {
        // Authenticated but not a member of anything — a real state, not a
        // crash. Someone was deactivated, or an account exists with no person.
        setMemberships([])
        setLoading(false)
        return
      }
      const rows = data.map((r: any) => ({
        person: { ...r, family: undefined } as Person,
        family: r.family as Family,
      }))
      setMemberships(rows)
      if (!rows.some(r => r.family.id === familyId)) {
        setFamilyId(rows[0].family.id)
        localStorage.setItem('samboza-family', rows[0].family.id)
      }
      setLoading(false)
    })()
    return () => { cancelled = true }
  }, [session, attempt])

  const current = memberships.find(m => m.family.id === familyId) ?? memberships[0] ?? null

  const value: AuthState = {
    loading,
    session,
    person: current?.person ?? null,
    family: current?.family ?? null,
    memberships,
    membershipError,
    reload() {
      setLoading(true)
      setMembershipError(false)
      setAttempt(n => n + 1)
    },
    async signIn(email, password) {
      const { error } = await supabase.auth.signInWithPassword({
        email: email.trim().toLowerCase(),
        password,
      })
      if (error) {
        // Deliberately the same message either way. Saying "no such account"
        // tells whoever is guessing which addresses exist.
        return { error: 'err_bad_credentials' }
      }
      localStorage.setItem(SIGNED_IN_AT, String(Date.now()))
      return { error: null }
    },
    async signOut() {
      localStorage.removeItem(SIGNED_IN_AT)
      await supabase.auth.signOut()
    },
    chooseFamily(id) {
      setFamilyId(id)
      localStorage.setItem('samboza-family', id)
    },
  }

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export function useAuth() {
  const v = useContext(Ctx)
  if (!v) throw new Error('useAuth must be used inside <AuthProvider>')
  return v
}
