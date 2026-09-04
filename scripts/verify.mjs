/**
 * What is actually in the database? Reports counts and names only — no keys,
 * no tokens, nothing secret. Safe to paste anywhere.
 *
 * Run: node verify.mjs
 */
import { createClient } from '@supabase/supabase-js'
import { readFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
try {
  for (const line of readFileSync(resolve(here, '..', '.env'), 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z_]+)\s*=\s*(.*?)\s*$/)
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '')
  }
} catch { /* real env vars are fine too */ }

const db = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { autoRefreshToken: false, persistSession: false } }
)

const line = (label, value) => console.log('  ' + label.padEnd(22) + value)

const { data: fam, error: famErr } = await db.from('families').select('*')
if (famErr) { console.error('\nFAILED:', famErr.message, '\n'); process.exit(1) }

console.log('\nFAMILIES')
if (!fam.length) {
  console.log('  none — bootstrap has not run. Run: node bootstrap.mjs\n')
  process.exit(0)
}
fam.forEach(f => line(f.code, f.name + '  (' + f.base_currency + ')'))

const family = fam[0]

const { data: people } = await db.from('people')
  .select('member_no, display_name, relationship, role, is_user, active')
  .eq('family_id', family.id).order('member_no')

console.log('\nPEOPLE')
people?.forEach(p => line(
  family.code + '·' + String(p.member_no).padStart(2, '0'),
  p.display_name.padEnd(14) +
  (p.is_user ? (p.role ?? '?').padEnd(8) : 'beneficiary'.padEnd(8)) +
  p.relationship + (p.active ? '' : '  [INACTIVE]')
))

const { data: users } = await db.auth.admin.listUsers()
console.log('\nSIGN-IN ACCOUNTS')
const linked = new Set(people?.filter(p => p.is_user).map(p => p.display_name))
users?.users?.forEach(u => {
  const name = u.user_metadata?.display_name ?? '(no name)'
  line(u.email ?? '(no email)',
    (u.email_confirmed_at ? 'confirmed' : 'UNCONFIRMED').padEnd(13) +
    (linked.has(name) ? 'linked to ' + name : 'NOT LINKED to a person'))
})

for (const [label, table] of [
  ['ACCOUNTS', 'accounts'], ['CATEGORIES', 'categories'], ['ALLOWANCE RATES', 'allowance_rates'],
]) {
  const { data } = await db.from(table).select('*').eq('family_id', family.id)
  console.log('\n' + label + '  (' + (data?.length ?? 0) + ')')
  data?.forEach(r => line(
    r.system_key ?? r.name_en ?? '',
    r.name ?? (r.amount_egp != null ? (r.amount_egp / 100) + ' EGP from ' + r.effective_from : '')
  ))
}

console.log('\nReady to sign in at app/ with the emails above.\n')
