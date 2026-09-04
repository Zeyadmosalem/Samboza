/**
 * One-time bootstrap: creates the family, the five accounts, the people rows
 * and the ledger accounts.
 *
 * WHY THIS EXISTS AT ALL
 * Every RLS policy asks "which people row is this auth user?" — but the first
 * family has no people, and the first admin has no row. Nobody can create it
 * *through* the app, because the rules that protect it have nothing to check
 * against yet. So the very first rows are written with the service_role key,
 * which bypasses RLS. Once, and never again.
 *
 * RUN
 *   cd scripts
 *   npm install @supabase/supabase-js
 *   # .env in the repo root, already gitignored:
 *   #   SUPABASE_URL=https://<ref>.supabase.co
 *   #   SUPABASE_SERVICE_ROLE_KEY=<the secret key>
 *   node bootstrap.mjs
 *
 * The service_role key bypasses every policy that supabase/tests/rls.test.sql
 * verifies. Keep it in .env, never in the app, never in a commit, never in a
 * chat window. If it leaks, rotate it in Settings → API.
 *
 * Idempotent: safe to run again. It skips whatever already exists.
 */
import { createClient } from '@supabase/supabase-js'
import { readFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))

// Minimal .env reader — no dependency for four lines of parsing.
try {
  for (const line of readFileSync(resolve(here, '..', '.env'), 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z_]+)\s*=\s*(.*)\s*$/)
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '')
  }
} catch { /* fall back to real environment variables */ }

const URL = process.env.SUPABASE_URL
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!URL || !KEY) {
  console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY (see the header of this file)')
  process.exit(1)
}

const db = createClient(URL, KEY, { auth: { autoRefreshToken: false, persistSession: false } })

/* ------------------------------------------------------------------ data
   Placeholder emails, as agreed — an email is only a login identity here.
   The UUID underneath is what history attaches to, so changing an address
   later breaks nothing. Passwords are temporary and must be changed. */
const FAMILY = { code: 'SMBZ-7420', name: 'Samboza', base_currency: 'EGP' }

const PEOPLE = [
  { no: 1, name: 'Ghada', rel: 'mother',          role: 'viewer', email: 'ghada@samboza.family' },
  { no: 2, name: 'Abdo',  rel: 'brother',         role: 'admin',  email: 'abdo@samboza.family'  },
  { no: 3, name: 'Zeyad', rel: 'son',             role: 'member', email: 'zeyad@samboza.family' },
  { no: 4, name: 'Rewan', rel: 'daughter',        role: 'member', email: 'rewan@samboza.family' },
  { no: 9, name: 'Joe',   rel: 'uncle_maternal',  role: 'driver', email: 'joe@samboza.family'   },
  // Beneficiaries: no login, no role. They appear in records and receive
  // money; they can be promoted to users later without rewriting history.
  { no: 5, name: 'Mona',        rel: 'aunt_maternal' },
  { no: 6, name: 'Grandma',     rel: 'grandmother'   },
  { no: 7, name: 'Marwa',       rel: 'aunt_maternal' },
  { no: 8, name: 'Adam & Anas', rel: 'cousins'       },
]

const TEMP_PASSWORD = 'Samboza2026!'

/* The accounts the ledger needs before anything can post. `due_from_driver`
   is where "Joe is holding money he has not handed over yet" lives, and its
   balance is the carried amount when a handover comes up short (D12). */
const ACCOUNTS = [
  { key: 'cash',              kind: 'asset',  name: 'Cash' },
  { key: 'due_from_driver',   kind: 'asset',  name: 'Due from driver' },
  { key: 'remittance_income', kind: 'income', name: 'Remittances' },
  { key: 'car_income',        kind: 'income', name: 'Car income' },
  // D14: Marwa's quarter arrives with the family's share and is owed to her
  // until Abdo pays it out with her allowance. Money we hold, not money we
  // earned — so a liability, not income.
  { key: 'car_share_payable', kind: 'liability', name: 'Car share owed' },
  { key: 'loan_liability',    kind: 'liability', name: 'Loans owed' },
]

const CATEGORIES = [
  { en: 'Allowance', ar: 'المصروف',   kind: 'expense', colour: '#2a78d6' },
  { en: 'Rent',      ar: 'الإيجار',   kind: 'expense', colour: '#eb6834' },
  { en: 'Food',      ar: 'الأكل',     kind: 'expense', colour: '#1baf7a' },
  { en: 'Education', ar: 'التعليم',   kind: 'expense', colour: '#eda100' },
  { en: 'Medical',   ar: 'العلاج',    kind: 'expense', colour: '#e87ba4' },
  { en: 'Gifts',     ar: 'الهدايا',   kind: 'expense', colour: '#8a9490', needs_recipient: true },
  { en: 'Other',     ar: 'أخرى',      kind: 'expense', colour: '#8a9490' },
  // Income the family receives directly. Remittances and the car have their
  // own screens and their own accounts, so this is deliberately the only one:
  // without it the income side of Add Transaction is an empty dropdown, and
  // money that arrives any other way has nowhere to go. Split it into real
  // categories from Settings once the family knows what they actually are.
  { en: 'Other income', ar: 'دخل آخر', kind: 'income', colour: '#6f5bd4' },
]

/* Monthly allowances, in PIASTRES. Effective-dated (D3), so raising one
   later never rewrites what was already paid. */
const RATES = [
  { name: 'Zeyad',       piastres: 300_000 },
  { name: 'Rewan',       piastres: 300_000 },
  { name: 'Mona',        piastres: 200_000 },
  { name: 'Grandma',     piastres: 200_000 },
  { name: 'Marwa',       piastres: 200_000 },
  { name: 'Adam & Anas', piastres: 200_000 },
]

const log = (...a) => console.log(' ', ...a)

async function main() {
  /* ---- family ------------------------------------------------------- */
  let { data: family } = await db.from('families').select('*').eq('code', FAMILY.code).maybeSingle()
  if (family) {
    log(`family ${FAMILY.code} already exists`)
  } else {
    const { data, error } = await db.from('families').insert(FAMILY).select().single()
    if (error) throw error
    family = data
    log(`created family ${family.code}`)
  }

  /* ---- auth users + people ------------------------------------------ */
  for (const p of PEOPLE) {
    const { data: existing } = await db
      .from('people').select('id').eq('family_id', family.id).eq('member_no', p.no).maybeSingle()
    if (existing) { log(`person ${p.name} already exists`); continue }

    let authId = null
    if (p.email) {
      // email_confirm: true means no confirmation email is ever sent and
      // nobody has to click a link. That is why the dashboard setting for
      // confirmations is irrelevant here.
      const { data, error } = await db.auth.admin.createUser({
        email: p.email,
        password: TEMP_PASSWORD,
        email_confirm: true,
        user_metadata: { display_name: p.name },
      })
      if (error && !/already/i.test(error.message)) throw error
      if (data?.user) authId = data.user.id
      else {
        const { data: list } = await db.auth.admin.listUsers()
        authId = list.users.find(u => u.email === p.email)?.id ?? null
      }
      log(`auth account ${p.email}`)
    }

    const { error } = await db.from('people').insert({
      family_id: family.id,
      member_no: p.no,
      display_name: p.name,
      relationship: p.rel,
      is_user: Boolean(p.email),
      auth_user_id: authId,
      role: p.role ?? null,
    })
    if (error) throw error
    log(`person ${p.name}${p.role ? ` (${p.role})` : ' — beneficiary, no login'}`)
  }

  /* ---- accounts ------------------------------------------------------ */
  for (const a of ACCOUNTS) {
    const { data: has } = await db
      .from('accounts').select('id').eq('family_id', family.id).eq('system_key', a.key).maybeSingle()
    if (has) continue
    const { error } = await db.from('accounts').insert({
      family_id: family.id, system_key: a.key, kind: a.kind, name: a.name,
    })
    if (error) throw error
    log(`account ${a.key}`)
  }

  /* ---- categories, each with its OWN account -------------------------
     A category is the human-facing label; the account is where the money
     actually lands. Pointing every category at one account would have
     recorded rent as car income and quietly wrecked every report, so this
     also REPAIRS an existing row whose account is of the wrong kind. */
  const slug = (name) => 'cat:' + name.toLowerCase().replace(/[^a-z0-9]+/g, '_')

  for (const c of CATEGORIES) {
    const key = slug(c.en)

    let { data: account } = await db
      .from('accounts').select('*').eq('family_id', family.id).eq('system_key', key).maybeSingle()
    if (!account) {
      const { data, error } = await db.from('accounts')
        .insert({ family_id: family.id, system_key: key, kind: c.kind, name: c.en })
        .select().single()
      if (error) throw error
      account = data
      log(`account ${key}`)
    }

    const { data: existing } = await db
      .from('categories').select('id, account_id')
      .eq('family_id', family.id).eq('name_en', c.en).maybeSingle()

    if (!existing) {
      const { error } = await db.from('categories').insert({
        family_id: family.id, name_en: c.en, name_ar: c.ar, kind: c.kind,
        account_id: account.id, colour: c.colour,
        needs_recipient: c.needs_recipient ?? false, is_default: true,
      })
      if (error) throw error
      log(`category ${c.en} -> ${key}`)
    } else if (existing.account_id !== account.id) {
      const { error } = await db.from('categories')
        .update({ account_id: account.id }).eq('id', existing.id)
      if (error) throw error
      log(`category ${c.en} REPOINTED to ${key}`)
    }
  }

  const { data: accounts } = await db.from('accounts').select('*').eq('family_id', family.id)
  void accounts

  /* ---- who takes the car's quarter ------------------------------------
     Named on the family rather than hardcoded, so the arrangement can change
     without a migration. */
  {
    const { data: fam } = await db.from('families')
      .select('car_share_person').eq('id', family.id).single()
    if (!fam?.car_share_person) {
      const { data: marwa } = await db.from('people').select('id')
        .eq('family_id', family.id).eq('display_name', 'Marwa').maybeSingle()
      if (marwa) {
        await db.from('families').update({ car_share_person: marwa.id }).eq('id', family.id)
        log('car share -> Marwa')
      }
    }
  }

  /* ---- allowance rates ----------------------------------------------- */
  const { data: people } = await db.from('people').select('*').eq('family_id', family.id)
  const abdo = people.find(p => p.display_name === 'Abdo')
  const today = new Date().toISOString().slice(0, 10)

  for (const r of RATES) {
    const who = people.find(p => p.display_name === r.name)
    if (!who) continue
    const { data: has } = await db
      .from('allowance_rates').select('id').eq('recipient_id', who.id).maybeSingle()
    if (has) continue
    const { error } = await db.from('allowance_rates').insert({
      family_id: family.id, recipient_id: who.id,
      amount_egp: r.piastres, effective_from: today, set_by: abdo.id,
    })
    if (error) throw error
    log(`allowance rate ${r.name}: ${r.piastres / 100} EGP`)
  }

  console.log('\nDone.\n')
  console.log(`  Family code   ${family.code}`)
  console.log(`  Sign in with  ${PEOPLE.filter(p => p.email).map(p => p.email).join('\n                ')}`)
  console.log(`  Password      ${TEMP_PASSWORD}   <- change this for everyone`)
  console.log('\nThe password is temporary and identical for all five. Change it')
  console.log('per person in Supabase → Authentication → Users before anyone')
  console.log('records real money.\n')
}

main().catch(e => { console.error('\nFAILED:', e.message ?? e); process.exit(1) })
