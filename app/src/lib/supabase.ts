import { createClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL
const anon = import.meta.env.VITE_SUPABASE_ANON_KEY

if (!url || !anon) {
  throw new Error(
    'Missing VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY. ' +
    'Copy app/.env.example to app/.env.local and fill them in.'
  )
}

/**
 * The anon key is public and ships in the bundle. That is fine and expected:
 * row-level security is what protects the data, not the key. Every policy was
 * written and tested in supabase/tests/rls.test.sql precisely so that holding
 * this key grants nothing on its own.
 */
export const supabase = createClient(url, anon, {
  auth: {
    persistSession: true,      // they use a phone and a laptop; both stay signed in
    autoRefreshToken: true,
    detectSessionInUrl: false, // no magic-link flow yet
    storageKey: 'samboza-auth',
  },
})

export type Role = 'admin' | 'member' | 'viewer' | 'driver'

export interface Person {
  id: string
  family_id: string
  member_no: number
  display_name: string
  relationship: string
  is_user: boolean
  auth_user_id: string | null
  role: Role | null
  active: boolean
}

export interface Family {
  id: string
  code: string
  name: string
  base_currency: string
  /** Where this family's day starts. See setFamilyZone in data.ts. */
  timezone: string | null
}

/** The public member code — derived, never stored. See plan §2.4. */
export const memberCode = (family: Family, person: Person) =>
  `${family.code}·${String(person.member_no).padStart(2, '0')}`
