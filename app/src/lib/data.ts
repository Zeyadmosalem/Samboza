import { supabase } from './supabase'

/**
 * Every query the money screens make, in one place.
 *
 * None of these functions carries an authorisation check, and that is
 * deliberate: row-level security decides what comes back. A member calling
 * `ledgerFeed()` gets an empty array, not an error, and the screens are
 * written to read that as "nothing to show you" rather than a failure. The
 * only thing the client is trusted to do is ask.
 */

/* ------------------------------------------------------------------ money */

/** "1,234.5" → 123450 piastres. Returns null for anything that is not money. */
export function toPiastres(input: string): number | null {
  const cleaned = input.replace(/[,\s٫٬]/g, '').trim()
  if (!cleaned || !/^\d*\.?\d*$/.test(cleaned)) return null
  const n = Number(cleaned)
  if (!Number.isFinite(n) || n <= 0) return null
  // Round half away from zero, matching Postgres. Amounts here are positive,
  // but the rule is written once so it cannot drift where they are not.
  return Math.sign(n) * Math.round(Math.abs(n) * 100)
}

/**
 * "2026-09-04" → "4 Sep 2026". Built from a LOCAL Date, never `new Date(iso)`,
 * which parses a bare day as UTC midnight and renders the previous day
 * anywhere west of Greenwich.
 */
export function fmtDay(iso: string, lang: 'en' | 'ar') {
  const [y, m, d] = iso.split('-').map(Number)
  return new Intl.DateTimeFormat(lang === 'ar' ? 'ar-EG-u-nu-latn' : 'en-GB',
    { day: 'numeric', month: 'short', year: 'numeric' }).format(new Date(y, m - 1, d))
}

/** The first of the month a date falls in, as an ISO day string. */
export const monthStart = (d = new Date()) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`

/** Today in the user's own timezone — never `toISOString()`, which is UTC and
 *  hands Egypt the wrong day for two hours every evening. */
export const today = () => {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/* ------------------------------------------------------------------ types */

export interface Category {
  id: string
  name_en: string
  name_ar: string
  kind: 'income' | 'expense'
  colour: string | null
  needs_recipient: boolean
}

export interface LedgerRow {
  entry_id: string
  journal_id: string
  occurred_on: string
  recorded_at: string
  memo: string | null
  reverses: string | null
  category_id: string | null
  category_en: string | null
  category_ar: string | null
  category_colour: string | null
  category_kind: 'income' | 'expense' | null
  person_id: string | null
  person_name: string | null
  account_kind: 'asset' | 'liability' | 'income' | 'expense' | 'equity'
  signed_amount: number
  amount: number
}

export interface MemberExpense {
  id: string
  person_id: string
  category_id: string
  amount_egp: number
  occurred_on: string
  description: string | null
  status: 'pending' | 'approved' | 'rejected'
  reason: string | null
  created_at: string
}

export interface CarDay {
  id: string
  drive_date: string
  worked: boolean
  gross_egp: number
  direct_egp: number
  indirect_egp: number
  net_egp: number
  driver_egp: number
  family_egp: number
  marwa_egp: number
  status: 'recorded' | 'settled' | 'off'
  submitted_by: string
}

export interface Balance {
  account_id: string
  system_key: string | null
  kind: string
  balance: number
}

/* ---------------------------------------------------------------- queries */

export async function categories(familyId: string) {
  const { data, error } = await supabase
    .from('categories')
    .select('id,name_en,name_ar,kind,colour,needs_recipient')
    .eq('family_id', familyId)
    .eq('active', true)
    .order('kind')
    .order('name_en')
  if (error) throw error
  return (data ?? []) as Category[]
}

export async function balances(familyId: string) {
  const { data, error } = await supabase
    .from('account_balances')
    .select('account_id,system_key,kind,balance')
    .eq('family_id', familyId)
  if (error) throw error
  return (data ?? []) as Balance[]
}

/** One system account's balance, or 0 when the caller cannot see it. */
export const systemBalance = (rows: Balance[], key: string) =>
  rows.find(b => b.system_key === key)?.balance ?? 0

export interface FeedQuery {
  familyId: string
  from?: string
  to?: string
  personId?: string | null
  /** Page size; History pages rather than fetching a growing table whole. */
  limit?: number
  offset?: number
}

export async function ledgerFeed(q: FeedQuery) {
  let sel = supabase
    .from('ledger_feed')
    .select('*')
    .eq('family_id', q.familyId)
    .order('occurred_on', { ascending: false })
    .order('recorded_at', { ascending: false })
  if (q.from) sel = sel.gte('occurred_on', q.from)
  if (q.to) sel = sel.lte('occurred_on', q.to)
  if (q.personId) sel = sel.eq('person_id', q.personId)
  const { data, error } = await sel.range(q.offset ?? 0, (q.offset ?? 0) + (q.limit ?? 50) - 1)
  if (error) throw error
  return (data ?? []) as LedgerRow[]
}

export async function memberExpenses(q: FeedQuery & { status?: string }) {
  let sel = supabase
    .from('member_expenses')
    .select('id,person_id,category_id,amount_egp,occurred_on,description,status,reason,created_at')
    .eq('family_id', q.familyId)
    .order('occurred_on', { ascending: false })
  if (q.from) sel = sel.gte('occurred_on', q.from)
  if (q.to) sel = sel.lte('occurred_on', q.to)
  if (q.personId) sel = sel.eq('person_id', q.personId)
  if (q.status) sel = sel.eq('status', q.status)
  const { data, error } = await sel.range(q.offset ?? 0, (q.offset ?? 0) + (q.limit ?? 50) - 1)
  if (error) throw error
  return (data ?? []) as MemberExpense[]
}

export async function carDays(q: FeedQuery) {
  let sel = supabase
    .from('car_days')
    .select('*')
    .eq('family_id', q.familyId)
    .order('drive_date', { ascending: false })
  if (q.from) sel = sel.gte('drive_date', q.from)
  if (q.to) sel = sel.lte('drive_date', q.to)
  const { data, error } = await sel.range(q.offset ?? 0, (q.offset ?? 0) + (q.limit ?? 50) - 1)
  if (error) throw error
  return (data ?? []) as CarDay[]
}

/** The monthly figure in force for a person on a date. Effective-dated, so
 *  the answer for March is what March actually was. */
export async function allowanceRate(personId: string, when = today()) {
  const { data, error } = await supabase
    .from('allowance_rates')
    .select('amount_egp,effective_from')
    .eq('recipient_id', personId)
    .lte('effective_from', when)
    .order('effective_from', { ascending: false })
    .limit(1)
  if (error) throw error
  return data?.[0]?.amount_egp ?? null
}

/* ----------------------------------------------------------------- writes */

/** The admin's ledger entry. One RPC, because the debit/credit shape is the
 *  database's business, not a screen's. */
export async function recordTransaction(args: {
  familyId: string
  kind: 'income' | 'expense'
  categoryId: string
  amount: number
  occurredOn: string
  personId?: string | null
  memo?: string | null
  clientUuid: string
}) {
  const { data, error } = await supabase.rpc('record_transaction', {
    p_family: args.familyId,
    p_kind: args.kind,
    p_category: args.categoryId,
    p_amount: args.amount,
    p_occurred_on: args.occurredOn,
    p_person: args.personId ?? null,
    p_memo: args.memo ?? null,
    p_client_uuid: args.clientUuid,
  })
  if (error) throw error
  return data as string
}

/** A member's own submission. Lands `pending`; only Abdo moves it. */
export async function submitExpense(args: {
  familyId: string
  personId: string
  categoryId: string
  amount: number
  occurredOn: string
  description?: string | null
  clientUuid: string
}) {
  const { error } = await supabase.from('member_expenses').insert({
    family_id: args.familyId,
    person_id: args.personId,
    category_id: args.categoryId,
    amount_egp: args.amount,
    occurred_on: args.occurredOn,
    description: args.description || null,
    client_uuid: args.clientUuid,
  })
  if (error) throw error
}

/**
 * Generated once per form, reused on every retry. Joe on bad signal pressing
 * submit twice must post Tuesday once — the unique index on client_uuid is
 * what enforces that, and this is what feeds it.
 */
export const newClientUuid = () =>
  (globalThis.crypto?.randomUUID?.() ??
    // Older WebViews. Not cryptographically strong, and does not need to be:
    // this is a collision guard, not a secret.
    `${Date.now().toString(16)}-${Math.random().toString(16).slice(2, 10)}-4000-8000-${Math.random().toString(16).slice(2, 14)}`)
