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

/**
 * WHOSE TODAY. Not the device's, and not the server's.
 *
 * The database runs on Africa/Cairo and refuses a date it has not reached, so
 * a device an hour ahead gets "that day has not happened yet" — which is
 * exactly what Ghada's phone in Saudi would do, and what any device does
 * between midnight and 3am while the server is still on yesterday in UTC.
 *
 * Module state rather than a prop, because it is one fact about the family
 * that every screen needs and nothing should be able to disagree about.
 * AuthProvider sets it the moment the family resolves.
 */
let familyZone = 'Africa/Cairo'
export const setFamilyZone = (tz?: string | null) => { familyZone = tz || 'Africa/Cairo' }

/** Today, where the family lives. 'en-CA' formats as YYYY-MM-DD. */
export const today = () =>
  new Intl.DateTimeFormat('en-CA', { timeZone: familyZone }).format(new Date())

/** The first of the month the family is currently in. */
export const monthStart = () => today().slice(0, 7) + '-01'

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
  journal_id: string | null
  loss_journal_id: string | null
  voided_at: string | null
  void_reason: string | null
  handover_id: string | null
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

export async function carDays(q: FeedQuery & { includeVoided?: boolean }) {
  let sel = supabase
    .from('car_days')
    .select('*')
    .eq('family_id', q.familyId)
    .order('drive_date', { ascending: false })
  // A voided day is a correction, not history to re-read. Its journal was
  // reversed, so counting it again would double what Joe appears to owe.
  if (!q.includeVoided) sel = sel.is('voided_at', null)
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

/* -------------------------------------------------------------- allowance */

export interface MemberBalance {
  family_id: string
  person_id: string
  received: number
  approved: number
  /** received − approved. Only meaningful for someone who submits at all. */
  balance: number
  pending: number
  pending_count: number
  last_period: string | null
  rate: number | null
}

export interface AllowancePayment {
  id: string
  recipient_id: string
  period: string
  amount_egp: number
  paid_on: string
}

export async function memberBalances(familyId: string) {
  const { data, error } = await supabase
    .from('member_balances')
    .select('*')
    .eq('family_id', familyId)
  if (error) throw error
  return (data ?? []) as MemberBalance[]
}

/** Every payment for one month. Absence is the answer to "has X been paid". */
export async function allowancesFor(familyId: string, period: string) {
  const { data, error } = await supabase
    .from('allowances')
    .select('id,recipient_id,period,amount_egp,paid_on')
    .eq('family_id', familyId)
    .eq('period', period)
  if (error) throw error
  return (data ?? []) as AllowancePayment[]
}

export async function payAllowance(args: {
  familyId: string
  recipientId: string
  period: string
  paidOn: string
  clientUuid: string
}) {
  const { data, error } = await supabase.rpc('pay_allowance', {
    p_family: args.familyId,
    p_recipient: args.recipientId,
    p_period: args.period,
    p_paid_on: args.paidOn,
    p_amount: null,          // whatever the rate for that month says
    p_client_uuid: args.clientUuid,
  })
  if (error) throw error
  return data as string
}

export async function setAllowanceRate(args: {
  familyId: string
  recipientId: string
  amount: number
  effectiveFrom: string
}) {
  const { error } = await supabase.rpc('set_allowance_rate', {
    p_family: args.familyId,
    p_recipient: args.recipientId,
    p_amount: args.amount,
    p_effective_from: args.effectiveFrom,
  })
  if (error) throw error
}

/** The 1st of the month `iso` falls in, and the 1st of the one after. */
export const periodOf = (iso: string) => iso.slice(0, 7) + '-01'
export function nextMonthStart(iso: string) {
  const [y, m] = iso.split('-').map(Number)
  return m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, '0')}-01`
}
export const monthLabel = (iso: string, lang: 'en' | 'ar') => {
  const [y, m] = iso.split('-').map(Number)
  return new Intl.DateTimeFormat(lang === 'ar' ? 'ar-EG-u-nu-latn' : 'en-GB',
    { month: 'long', year: 'numeric' }).format(new Date(y, m - 1, 1))
}

/* ------------------------------------------------------------- approvals */

export async function pendingSubmissions(familyId: string) {
  const { data, error } = await supabase
    .from('member_expenses')
    .select('id,person_id,category_id,amount_egp,occurred_on,description,status,reason,created_at')
    .eq('family_id', familyId)
    .eq('status', 'pending')
    .order('occurred_on', { ascending: true })
  if (error) throw error
  return (data ?? []) as MemberExpense[]
}

/**
 * Guarded on the CURRENT status inside the function, so two admins deciding
 * the same row cannot both succeed. `false` means somebody got there first —
 * not an error, and the screen should reload rather than complain.
 */
export async function decideSubmission(id: string, status: 'approved' | 'rejected', reason?: string) {
  const { data, error } = await supabase.rpc('decide_member_expense', {
    p_id: id, p_status: status, p_reason: reason || null,
  })
  if (error) throw error
  return data as boolean
}

/* -------------------------------------------------------------------- car */

export type CostClass = 'direct' | 'indirect'
export const COST_LABELS = ['fuel', 'tolls', 'permit', 'admin', 'ticket', 'other'] as const
export type CostLabel = typeof COST_LABELS[number]

/** The label only SUGGESTS a class (D2). Joe sets it, and can override this. */
export const SUGGESTED_CLASS: Record<CostLabel, CostClass> = {
  fuel: 'direct', tolls: 'direct',
  permit: 'indirect', admin: 'indirect', ticket: 'indirect', other: 'indirect',
}

export interface CostLine {
  label: CostLabel
  class: CostClass
  amount_egp: number
  description?: string | null
}

export interface CarExpense extends CostLine { id: string; car_day_id: string }

export interface Handover {
  id: string
  received_on: string
  amount_egp: number
  counted_egp: number
  note: string | null
}

/**
 * What the split WILL be, for the screen only — `record_car_day` computes the
 * real one in SQL and that is what gets stored.
 *
 * Rounding is half away from zero, matching Postgres. `Math.round` is half
 * UP, which agrees on every positive value and disagrees on exact negative
 * halves — and days can be negative (D10), so the two rules differ on roughly
 * one losing day in twelve. Getting this wrong would show Joe one number and
 * store another.
 */
const roundAway = (x: number) => Math.sign(x) * Math.round(Math.abs(x))
export function splitPreview(net: number) {
  const driver = roundAway(net / 3)
  const family = roundAway((net - driver) * 0.75)
  return { driver, family, marwa: (net - driver) - family }
}

export async function recordCarDay(args: {
  familyId: string
  driveDate: string
  worked: boolean
  gross?: number
  expenses?: CostLine[]
  clientUuid: string
}) {
  const { data, error } = await supabase.rpc('record_car_day', {
    p_family: args.familyId,
    p_drive_date: args.driveDate,
    p_worked: args.worked,
    p_gross: args.worked ? (args.gross ?? 0) : 0,
    p_expenses: args.worked ? (args.expenses ?? []) : [],
    p_client_uuid: args.clientUuid,
  })
  if (error) throw error
  return data as string
}

export async function voidCarDay(id: string, reason: string) {
  const { data, error } = await supabase.rpc('void_car_day', { p_day: id, p_reason: reason })
  if (error) throw error
  return data as boolean
}

export async function confirmHandover(args: {
  familyId: string
  dayIds: string[]
  receivedOn: string
  countedEgp: number
  note?: string | null
  clientUuid: string
}) {
  const { data, error } = await supabase.rpc('confirm_handover', {
    p_family: args.familyId,
    p_day_ids: args.dayIds,
    p_received_on: args.receivedOn,
    p_counted_egp: args.countedEgp,
    p_note: args.note ?? null,
    p_client_uuid: args.clientUuid,
  })
  if (error) throw error
  return data as string
}

export async function handovers(familyId: string, limit = 10) {
  const { data, error } = await supabase
    .from('car_handovers')
    .select('id,received_on,amount_egp,counted_egp,note')
    .eq('family_id', familyId)
    .order('received_on', { ascending: false })
    .limit(limit)
  if (error) throw error
  return (data ?? []) as Handover[]
}

export async function carExpensesFor(dayIds: string[]) {
  if (!dayIds.length) return []
  const { data, error } = await supabase
    .from('car_expenses')
    .select('id,car_day_id,label,class,amount_egp,description')
    .in('car_day_id', dayIds)
  if (error) throw error
  return (data ?? []) as CarExpense[]
}

/**
 * D11 + the family's own cadence: Joe hands over when it suits him, and Abdo
 * should be nudged rather than nagged. The queue is expected to hold up to a
 * month of days, which is why the Car screen asks for 60 rows and no more —
 * a driver recording daily for a month is 30 of them.
 */
export const HANDOVER_NUDGE_DAYS = 10
export const HANDOVER_ALARM_DAYS = 30

/** Whole days between an ISO day and the family's today. */
export function daysSince(iso: string) {
  const at = (s: string) => {
    const [y, m, d] = s.split('-').map(Number)
    return Date.UTC(y, m - 1, d)
  }
  return Math.round((at(today()) - at(iso)) / 86_400_000)
}

/**
 * D13: a day that cost more than it took is settled by the family, not shared.
 * Abdo names the category and says what it was — a shortfall with no
 * explanation is the kind of entry that starts an argument six months later.
 */
export async function settleCarLoss(args: {
  dayId: string
  categoryId: string
  memo?: string | null
  clientUuid: string
}) {
  const { data, error } = await supabase.rpc('settle_car_loss', {
    p_day: args.dayId,
    p_category: args.categoryId,
    p_memo: args.memo ?? null,
    p_client_uuid: args.clientUuid,
  })
  if (error) throw error
  return data as string
}

/* ------------------------------------------------------------ remittances */

export const CURRENCIES = ['EGP', 'SAR', 'USD'] as const
export type Currency = typeof CURRENCIES[number]

export interface Remittance {
  id: string
  from_person: string
  amount_original: number
  currency: Currency
  fx_rate: number
  amount_egp: number
  received_on: string
  visit_note: string | null
  voided_at: string | null
  void_reason: string | null
}

export async function remittances(familyId: string, limit = 40) {
  const { data, error } = await supabase
    .from('remittances')
    .select('id,from_person,amount_original,currency,fx_rate,amount_egp,received_on,visit_note,voided_at,void_reason')
    .eq('family_id', familyId)
    .is('voided_at', null)
    .order('received_on', { ascending: false })
    .limit(limit)
  if (error) throw error
  return (data ?? []) as Remittance[]
}

/**
 * The EGP a remittance will come to — shown so nobody is surprised, computed
 * again in SQL so nobody can supply it. Both round half away from zero, and
 * amounts here are positive, so the two always agree.
 */
export const toEgp = (amountMinor: number, rate: number) =>
  Math.sign(amountMinor * rate) * Math.round(Math.abs(amountMinor * rate))

export async function recordRemittance(args: {
  familyId: string
  fromPerson: string
  amountOriginal: number
  currency: Currency
  fxRate: number
  receivedOn: string
  visitNote?: string | null
  clientUuid: string
}) {
  const { data, error } = await supabase.rpc('record_remittance', {
    p_family: args.familyId,
    p_from_person: args.fromPerson,
    p_amount_original: args.amountOriginal,
    p_currency: args.currency,
    p_fx_rate: args.fxRate,
    p_received_on: args.receivedOn,
    p_visit_note: args.visitNote ?? null,
    p_client_uuid: args.clientUuid,
  })
  if (error) throw error
  return data as string
}

export async function voidRemittance(id: string, reason: string) {
  const { data, error } = await supabase.rpc('void_remittance', { p_id: id, p_reason: reason })
  if (error) throw error
  return data as boolean
}

/** "1,234.5" in a currency's own minor units. Same parser, different label. */
export const toMinorUnits = toPiastres

/** A rate is not money: it has six decimal places and no thousands grouping. */
export function parseRate(input: string): number | null {
  const cleaned = input.replace(/[,\s]/g, '').trim()
  if (!cleaned || !/^\d*\.?\d*$/.test(cleaned)) return null
  const n = Number(cleaned)
  return Number.isFinite(n) && n > 0 ? n : null
}
