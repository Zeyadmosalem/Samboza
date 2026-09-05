import { supabase } from './supabase'
import { writeOrQueue } from './outbox'

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
  return writeOrQueue('record_transaction', {
    p_family: args.familyId,
    p_kind: args.kind,
    p_category: args.categoryId,
    p_amount: args.amount,
    p_occurred_on: args.occurredOn,
    p_person: args.personId ?? null,
    p_memo: args.memo ?? null,
    p_client_uuid: args.clientUuid,
  }, args.memo || args.occurredOn)
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
  return writeOrQueue('member_expense', {
    family_id: args.familyId,
    person_id: args.personId,
    category_id: args.categoryId,
    amount_egp: args.amount,
    occurred_on: args.occurredOn,
    description: args.description || null,
    client_uuid: args.clientUuid,
  }, args.description || args.occurredOn)
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

/**
 * The one that most needs the outbox. Joe is in the car, often underground or
 * at the edge of a signal, and a day he cannot record is a day that does not
 * get recorded at all.
 */
export async function recordCarDay(args: {
  familyId: string
  driveDate: string
  worked: boolean
  gross?: number
  expenses?: CostLine[]
  clientUuid: string
}) {
  return writeOrQueue('record_car_day', {
    p_family: args.familyId,
    p_drive_date: args.driveDate,
    p_worked: args.worked,
    p_gross: args.worked ? (args.gross ?? 0) : 0,
    p_expenses: args.worked ? (args.expenses ?? []) : [],
    p_client_uuid: args.clientUuid,
  }, args.driveDate)
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

/* ------------------------------------------------------------------ loans */

export type LoanDirection = 'borrowed' | 'lent'

export interface LoanBalance {
  loan_id: string
  family_id: string
  direction: LoanDirection
  counterparty: string
  principal_egp: number
  taken_on: string
  description: string | null
  repaid_egp: number
  remaining_egp: number
  last_paid_on: string | null
  status: 'outstanding' | 'partial' | 'repaid'
}

export interface LoanPayment {
  id: string
  loan_id: string
  amount_egp: number
  paid_on: string
  voided_at: string | null
}

/** Principal, repaid and remaining — derived in SQL every time, never stored. */
export async function loans(familyId: string) {
  const { data, error } = await supabase
    .from('loan_balances')
    .select('*')
    .eq('family_id', familyId)
    .order('taken_on', { ascending: false })
  if (error) throw error
  return (data ?? []) as LoanBalance[]
}

export async function loanPayments(loanIds: string[]) {
  if (!loanIds.length) return []
  const { data, error } = await supabase
    .from('loan_payments')
    .select('id,loan_id,amount_egp,paid_on,voided_at')
    .in('loan_id', loanIds)
    .is('voided_at', null)
    .order('paid_on', { ascending: false })
  if (error) throw error
  return (data ?? []) as LoanPayment[]
}

export async function recordLoan(args: {
  familyId: string
  direction: LoanDirection
  counterparty: string
  principal: number
  takenOn: string
  description?: string | null
  clientUuid: string
}) {
  const { data, error } = await supabase.rpc('record_loan', {
    p_family: args.familyId,
    p_direction: args.direction,
    p_counterparty: args.counterparty,
    p_principal: args.principal,
    p_taken_on: args.takenOn,
    p_description: args.description ?? null,
    p_client_uuid: args.clientUuid,
  })
  if (error) throw error
  return data as string
}

export async function recordLoanPayment(args: {
  loanId: string
  amount: number
  paidOn: string
  clientUuid: string
}) {
  const { data, error } = await supabase.rpc('record_loan_payment', {
    p_loan: args.loanId,
    p_amount: args.amount,
    p_paid_on: args.paidOn,
    p_client_uuid: args.clientUuid,
  })
  if (error) throw error
  return data as string
}

export async function voidLoan(id: string, reason: string) {
  const { data, error } = await supabase.rpc('void_loan', { p_id: id, p_reason: reason })
  if (error) throw error
  return data as boolean
}

export async function voidLoanPayment(id: string, reason: string) {
  const { data, error } = await supabase.rpc('void_loan_payment', { p_id: id, p_reason: reason })
  if (error) throw error
  return data as boolean
}

/* ---------------------------------------------------------------- reports */

export interface MonthTotal { month: string; income: number; expense: number }
export interface Slice { key: string; label: string; amount: number; colour: string }

/** The last `months` month-starts, oldest first, in the family's own calendar. */
export function lastMonths(months: number): string[] {
  const [y, m] = today().split('-').map(Number)
  const out: string[] = []
  for (let i = months - 1; i >= 0; i--) {
    const d = new Date(y, m - 1 - i, 1)
    out.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`)
  }
  return out
}

/**
 * ONE query feeds all four charts.
 *
 * Six months of a family's ledger is a few hundred rows, so aggregating in the
 * browser is cheaper than four round trips and keeps every chart derived from
 * exactly the same rows — a report where the bar chart and the donut disagree
 * because they were fetched separately is worse than no report.
 */
export async function reportRows(familyId: string, months = 6) {
  const from = lastMonths(months)[0]
  const rows: LedgerRow[] = []
  // Paged rather than one huge range: PostgREST caps a response, and a family
  // that has been running this for a year should not silently lose the tail.
  for (let page = 0; page < 20; page++) {
    const batch = await ledgerFeed({ familyId, from, limit: 500, offset: page * 500 })
    rows.push(...batch)
    if (batch.length < 500) break
  }
  return rows
}

/** Income and expense per month. Both are EGP, so both share one axis. */
export function byMonth(rows: LedgerRow[], months: string[]): MonthTotal[] {
  return months.map(month => {
    const inMonth = rows.filter(r => r.occurred_on.slice(0, 7) === month.slice(0, 7))
    return {
      month,
      income: sum(inMonth.filter(r => r.account_kind === 'income').map(r => r.signed_amount)),
      expense: -sum(inMonth.filter(r => r.account_kind === 'expense').map(r => r.signed_amount)),
    }
  })
}

/**
 * Spending by category, biggest first, capped.
 *
 * A donut is a part-to-whole glance and stops working past six segments — past
 * that, adjacent slices blur and no palette saves it. So the tail folds into
 * one "Rest" slice and the full breakdown lives in the table beside it, which
 * is also the relief the palette's contrast warning requires.
 */
export function byCategory(
  rows: LedgerRow[], lang: 'en' | 'ar', restLabel: string, max = 6,
): { slices: Slice[]; all: Slice[]; total: number } {
  const totals = new Map<string, Slice>()
  for (const r of rows) {
    if (r.account_kind !== 'expense') continue
    const key = r.category_id ?? 'uncategorised'
    const label = (lang === 'ar' ? r.category_ar : r.category_en) ?? '—'
    const cur = totals.get(key) ?? { key, label, amount: 0, colour: r.category_colour ?? NEUTRAL }
    cur.amount += -r.signed_amount
    totals.set(key, cur)
  }
  const all = [...totals.values()].filter(s => s.amount > 0)
    .sort((a, b) => b.amount - a.amount)
  const total = sum(all.map(s => s.amount))

  if (all.length <= max) return { slices: all, all, total }
  const head = all.slice(0, max - 1)
  const rest = all.slice(max - 1)
  return {
    slices: [...head, {
      key: 'rest', label: restLabel, colour: NEUTRAL,
      amount: sum(rest.map(s => s.amount)),
    }],
    all, total,
  }
}

/** What the family spent on each person. Attribution, not judgement. */
export function byPerson(
  rows: LedgerRow[], names: Map<string, string>, unattributed: string,
): Slice[] {
  const totals = new Map<string, number>()
  for (const r of rows) {
    if (r.account_kind !== 'expense') continue
    const key = r.person_id ?? '—'
    totals.set(key, (totals.get(key) ?? 0) + -r.signed_amount)
  }
  return [...totals.entries()]
    .map(([key, amount]) => ({
      key, amount, colour: SERIES[0],
      label: key === '—' ? unattributed : names.get(key) ?? '—',
    }))
    .filter(s => s.amount > 0)
    .sort((a, b) => b.amount - a.amount)
}

/**
 * The categorical slots, in the order the validator signed off. Never cycled:
 * a ninth series folds into "Rest" rather than reusing slot 1, because a
 * repeated hue is indistinguishable from the original under any test a reader
 * can perform.
 */
export const SERIES = ['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4', '#008300', '#4a3aa7', '#e34948']
const NEUTRAL = '#8a9490'

const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0)

/* ------------------------------------------------- her own book (§3.6) --- */

/**
 * Ghada's personal book. Deliberately NOT the family ledger: §3.6 says her
 * salary, her rent in Riyadh and her groceries there are her own money and
 * nobody else's business, and the policy on this table agrees — not even Abdo,
 * the family's accountant, can read a row of it.
 *
 * It is also not a member sub-ledger. That one tracks an allowance the family
 * GAVE, which is why it needs approving. Nothing here was ever family money,
 * so nothing here is approved by anyone.
 */
export interface PersonalEntry {
  id: string
  person_id: string
  direction: 'in' | 'out'
  category: string
  amount: number
  currency: Currency
  occurred_on: string
  description: string | null
  /** The one place the two books touch: a remittance is the largest line in
   *  her month and income to the family. Same event, recorded twice, each
   *  book keeping its own half. */
  family_ref: string | null
}

/** Her list, not the family's — hence the p_ prefix and no `categories` row. */
export const PERSONAL_IN = ['p_salary', 'p_bonus', 'p_other_in'] as const
export const PERSONAL_OUT = [
  'p_rent', 'p_food', 'p_transport', 'p_bills', 'p_health', 'p_sent_home', 'p_other_out',
] as const

export async function personalEntries(personId: string, opts: {
  from?: string; to?: string; limit?: number
} = {}) {
  let q = supabase
    .from('personal_entries')
    .select('id,person_id,direction,category,amount,currency,occurred_on,description,family_ref')
    .eq('person_id', personId)
    .order('occurred_on', { ascending: false })
    .limit(opts.limit ?? 200)
  if (opts.from) q = q.gte('occurred_on', opts.from)
  if (opts.to) q = q.lte('occurred_on', opts.to)
  const { data, error } = await q
  if (error) throw error
  return (data ?? []) as PersonalEntry[]
}

export async function recordPersonal(args: {
  familyId: string
  personId: string
  direction: 'in' | 'out'
  category: string
  amount: number
  currency: Currency
  occurredOn: string
  description?: string | null
  clientUuid: string
}) {
  return writeOrQueue('personal_entry', {
    family_id: args.familyId,
    person_id: args.personId,
    direction: args.direction,
    category: args.category,
    amount: args.amount,
    currency: args.currency,
    occurred_on: args.occurredOn,
    description: args.description || null,
    client_uuid: args.clientUuid,
  }, args.description || args.category)
}

export interface PersonalMonth {
  month: string
  /** Per currency, because they cannot be added. */
  by: { currency: Currency; in: number; out: number }[]
}

/**
 * Her months, each currency kept apart.
 *
 * A single "spent this month" figure would have to add SAR to EGP, and there
 * is no rate in this book to do it with — the rates live on remittances,
 * where the accountant sets them, and they describe a different transaction
 * on a different day. Adding them anyway would produce a number that is not
 * wrong by a little; it is not a quantity of anything.
 */
export function personalMonths(rows: PersonalEntry[]): PersonalMonth[] {
  const months = new Map<string, Map<Currency, { in: number; out: number }>>()
  for (const r of rows) {
    const m = r.occurred_on.slice(0, 7) + '-01'
    if (!months.has(m)) months.set(m, new Map())
    const cur = months.get(m)!
    if (!cur.has(r.currency)) cur.set(r.currency, { in: 0, out: 0 })
    const slot = cur.get(r.currency)!
    slot[r.direction] += r.amount
  }
  return [...months.entries()]
    .sort((a, b) => (a[0] < b[0] ? 1 : -1))
    .map(([month, by]) => ({
      month,
      by: [...by.entries()]
        .sort((a, b) => b[1].out + b[1].in - (a[1].out + a[1].in))
        .map(([currency, v]) => ({ currency, in: v.in, out: v.out })),
    }))
}

/** What she sent home, from the family's side of the same events. She is a
 *  viewer of the family books, so this is a read she is allowed. */
export async function myRemittances(familyId: string, personId: string) {
  const { data, error } = await supabase
    .from('remittances')
    .select('id,from_person,amount_original,currency,fx_rate,amount_egp,received_on,visit_note,voided_at,void_reason')
    .eq('family_id', familyId)
    .eq('from_person', personId)
    .is('voided_at', null)
    .order('received_on', { ascending: false })
    .limit(60)
  if (error) throw error
  return (data ?? []) as Remittance[]
}
