import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import type { Session } from '@supabase/supabase-js'
import { supabase, type Family, type Person } from './supabase'
import { setFamilyZone } from './data'

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

/**
 * WHO YOU WERE, LAST TIME THIS WORKED.
 *
 * Without it the app opens offline, renders "Loading…", and then tells Joe
 * the server cannot check his account — so he cannot reach the form, and
 * "works offline for entry" is a sentence in a plan rather than a thing that
 * happens. The shell caches, the outbox holds his day; this is what lets him
 * get to the screen that fills it.
 *
 * IT GRANTS NOTHING. This is a name and a role used to draw a navigation bar.
 * Every query still carries his real token and still meets the policies, so a
 * stale "admin" in localStorage buys exactly what an honest one does: the
 * database decides, and it has never been asked to trust this.
 */
const CACHED_ME = 'samboza-me'
/** Where supabase-js keeps the session. Read directly only to answer "is
 *  anybody signed in on this device", which it can do without a network. */
const AUTH_KEY = 'samboza-auth'

function readCached(): { person: Person; family: Family }[] {
  try { return JSON.parse(localStorage.getItem(CACHED_ME) ?? '[]') } catch { return [] }
}

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
  /** True when the memberships came from the last successful load rather than
   *  from the server. The app works; it just could not check. */
  stale: boolean
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
  /** Showing what we last knew, because the server could not be reached. */
  const [stale, setStale] = useState(false)
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
    /*
     * OFFLINE, SHOW THE APP NOW.
     *
     * getSession() offline can spend ten seconds retrying a token refresh
     * that cannot possibly succeed, and until it answers the app is a
     * spinner. Joe in a basement car park does not wait ten seconds; he
     * decides the app is broken and writes the day on his hand.
     *
     * So if this device has a session and remembers who it belongs to, render
     * immediately and let getSession catch up whenever it likes. The identity
     * is only used to draw the screens — every query still carries the real
     * token and still meets the policies.
     */
    if (!navigator.onLine && localStorage.getItem(AUTH_KEY)) {
      const rows = readCached()
      if (rows.length) {
        setMemberships(rows)
        setFamilyZone(rows[0].family.timezone)
        setStale(true)
        setLoading(false)
      }
    }

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

  /*
   * WAITED LONG ENOUGH.
   *
   * navigator.onLine is not the whole story: a phone on hotel wifi with no
   * route out reports true, and getSession can then spend ten seconds
   * retrying a token refresh that cannot succeed. Either way the app is a
   * spinner, and a spinner is what makes somebody decide it is broken.
   *
   * So the rule is about time rather than about connectivity. If this device
   * has a session and remembers who it belongs to, and the network has not
   * answered in two and a half seconds, show the app and say the figures are
   * what it last knew. When the real answer arrives it replaces this.
   */
  useEffect(() => {
    if (!loading) return
    const t = setTimeout(() => {
      const rows = readCached()
      if (!localStorage.getItem(AUTH_KEY) || !rows.length) return
      setMemberships(rows)
      setFamilyZone(rows[0].family.timezone)
      setStale(true)
      setLoading(false)
    }, 2500)
    return () => clearTimeout(t)
  }, [loading])

  /* ---- who am I, and where ------------------------------------------- */
  useEffect(() => {
    if (!session) return
    let cancelled = false

    /** Fall back to the last good answer. Returns false if there isn't one. */
    const useCached = () => {
      const rows = readCached()
      if (!rows.length) return false
      setMemberships(rows)
      setFamilyZone(rows[0].family.timezone)
      setStale(true)
      setMembershipError(false)
      setLoading(false)
      return true
    }

    ;(async () => {
      // With no connection there is nothing to ask, and asking anyway leaves
      // the app on a spinner for as long as fetch takes to give up — which is
      // how "works offline" turns into a loading screen in a car park.
      if (!navigator.onLine && useCached()) return

      const { data, error } = await supabase
        .from('people')
        // The relationship is NAMED, and must stay named. There are now two
        // foreign keys between `people` and `families` — this one, and
        // `families.car_share_person` pointing back — and PostgREST refuses
        // an ambiguous embed rather than guessing. Dropping the hint breaks
        // sign-in for every single person, which is exactly what adding that
        // second key did until a browser check caught it.
        .select('*, family:families!people_family_id_fkey(*)')
        .eq('auth_user_id', session.user.id)
        .eq('active', true)

      if (cancelled) return
      if (error) {
        // The lookup did not run. Distinct from running and finding nothing:
        // a dropped connection is not a revoked account, and telling someone
        // they have been removed from their own family because the wifi went
        // is the kind of message that gets a phone call.
        if (useCached()) return
        setMembershipError(true)
        setMemberships([])
        setLoading(false)
        return
      }
      setMembershipError(false)
      setStale(false)
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
      try { localStorage.setItem(CACHED_ME, JSON.stringify(rows)) } catch { /* private mode */ }
      // Before any screen renders, so "today" means the same day to Abdo in
      // Cairo and to Ghada in Saudi.
      setFamilyZone(rows[0].family.timezone)
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
    stale,
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
      // Forget the cached identity too. It grants nothing, but a name and a
      // family sitting in a shared laptop's storage after someone signs out
      // is still theirs and not the next person's to see.
      localStorage.removeItem(CACHED_ME)
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
