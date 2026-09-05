/* Shared plumbing for the check scripts.
   Loads .env WITHOUT printing anything from it. Nothing in here logs a key. */
import { readFileSync } from 'node:fs'
import { createClient } from '@supabase/supabase-js'

const ROOT = new URL('../../', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')

export function loadEnv() {
  for (const line of readFileSync(ROOT + '.env', 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z_]+)\s*=\s*(.*?)\s*$/)
    if (m) process.env[m[1]] = m[2]
  }
  const url = process.env.SUPABASE_URL
  const service = process.env.SUPABASE_SERVICE_ROLE_KEY
  const anon = readFileSync(ROOT + 'app/.env.local', 'utf8')
    .match(/VITE_SUPABASE_ANON_KEY=(.*)/)?.[1]?.trim()
  if (!url || !service || !anon) {
    console.error('Missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY in .env, ' +
                  'or VITE_SUPABASE_ANON_KEY in app/.env.local. Run: node check-env.mjs')
    process.exit(1)
  }
  return { url, service, anon }
}

/** service_role. Bypasses every policy — used only to seed and to clean up. */
export const asAdmin = ({ url, service }) =>
  createClient(url, service, { auth: { persistSession: false } })

/** A real person, holding the same public key the browser holds. */
export async function asPerson({ url, anon }, email, password = 'Samboza2026!') {
  const c = createClient(url, anon, { auth: { persistSession: false } })
  const { error } = await c.auth.signInWithPassword({ email, password })
  if (error) throw new Error(`${email}: ${error.message}`)
  return c
}

/**
 * These scripts WRITE to the live project and delete what they wrote. That is
 * acceptable while the ledger is empty and unacceptable the moment it is not:
 * a cleanup that deletes by memo would take a real row with the same memo, and
 * a crash mid-run leaves invented money in the family's accounts.
 *
 * So they refuse to run against a ledger that already holds anything. Once the
 * family starts using this for real, that is the end of these scripts — which
 * is the correct outcome, not an inconvenience to work around.
 */
export async function refuseIfLedgerHasData(admin) {
  const counts = {}
  for (const table of ['journals', 'member_expenses', 'car_days', 'remittances']) {
    const { count, error } = await admin.from(table).select('*', { count: 'exact', head: true })
    if (error) { console.error(`could not read ${table}: ${error.message}`); process.exit(1) }
    counts[table] = count ?? 0
  }
  const total = Object.values(counts).reduce((a, b) => a + b, 0)
  if (total === 0) return

  console.error(
    '\nREFUSING TO RUN.\n\n' +
    'This script seeds and deletes rows in the live project, and the ledger is\n' +
    'no longer empty:\n\n' +
    Object.entries(counts).map(([k, v]) => `  ${k.padEnd(18)} ${v}`).join('\n') +
    '\n\nThat is real family money. Point these checks at a scratch Supabase\n' +
    'project instead, or delete them — they were for the empty-database phase.\n')
  process.exit(1)
}

export function reporter() {
  let pass = 0, fail = 0
  return {
    check(name, ok, detail = '') {
      ok ? pass++ : fail++
      console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '\n        ' + detail : ''}`)
    },
    async finish(admin) {
      const { data: bal } = await admin.from('account_balances').select('balance')
      const { data: jn } = await admin.from('journals').select('id')
      const { data: me } = await admin.from('member_expenses').select('id')
      const { data: cd } = await admin.from('car_days').select('id')
      console.log(`\n  ${pass} pass · ${fail} fail`)
      console.log(`  left behind: ${bal.filter(b => b.balance !== 0).length} non-zero balances · ` +
                  `${jn.length} journals · ${me.length} submissions · ${cd.length} car days\n`)
      process.exit(fail ? 1 : 0)
    },
  }
}

/**
 * The FAMILY's date, not this machine's and not UTC. The database runs on
 * Africa/Cairo and refuses a date it has not reached, so a checker running at
 * half past midnight on a laptop set to Cairo would ask it to accept tomorrow.
 * Which is how this was found.
 */
export const dayString = (d = new Date()) =>
  new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Cairo' }).format(d)
export const monthStart = (d = new Date()) => dayString(d).slice(0, 7) + '-01'
