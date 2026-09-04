/**
 * Every query the money screens make, run as each real person against the
 * live project.
 *
 * The point is not that the queries succeed. It is that a member and the
 * driver get ZERO ROWS AND NO ERROR from the family ledger — row-level
 * security denies by returning nothing — so the screens must read "empty" as
 * an answer rather than a failure, and something has to prove that is what
 * actually comes back.
 *
 *   node check-screens.mjs
 */
import { randomUUID } from 'node:crypto'
import {
  loadEnv, asAdmin, asPerson, refuseIfLedgerHasData, reporter, dayString, monthStart,
} from './lib/env.mjs'

const env = loadEnv()
const admin = asAdmin(env)
await refuseIfLedgerHasData(admin)
const { check, finish } = reporter()

const TODAY = dayString()
const MONTH = monthStart()

const abdo = await asPerson(env, 'abdo@samboza.family')
const ghada = await asPerson(env, 'ghada@samboza.family')
const zeyad = await asPerson(env, 'zeyad@samboza.family')
const joe = await asPerson(env, 'joe@samboza.family')

const { data: fam } = await abdo.from('families').select('id').single()
const { data: cats } = await abdo.from('categories').select('id,name_en,kind,needs_recipient')
const expenseCat = cats.find(c => c.kind === 'expense' && !c.needs_recipient)
const incomeCat = cats.find(c => c.kind === 'income')
const { data: ppl } = await abdo.from('people').select('id,display_name')
const P = Object.fromEntries(ppl.map(p => [p.display_name, p]))

console.log('\n=== the money screens, as each role ===\n')

check('there is at least one income category for Add Transaction to offer',
  !!incomeCat, incomeCat?.name_en ?? '*** the income tab would be an empty dropdown ***')

/* ------------------------------------------------ the admin write path -- */
const uuid = randomUUID()
const first = await abdo.rpc('record_transaction', {
  p_family: fam.id, p_kind: 'expense', p_category: expenseCat.id,
  p_amount: 45050, p_occurred_on: TODAY, p_person: P.Rewan.id,
  p_memo: 'SCREEN CHECK groceries', p_client_uuid: uuid,
})
check('Add Transaction: the admin records an expense',
  !first.error && !!first.data, first.error?.message ?? '')

const retry = await abdo.rpc('record_transaction', {
  p_family: fam.id, p_kind: 'expense', p_category: expenseCat.id,
  p_amount: 45050, p_occurred_on: TODAY, p_person: P.Rewan.id,
  p_memo: 'SCREEN CHECK groceries', p_client_uuid: uuid,
})
const { data: dupes } = await admin.from('journals').select('id').eq('memo', 'SCREEN CHECK groceries')
check('…and a retry with the same client_uuid posts once, not twice',
  retry.data === first.data && dupes.length === 1,
  `${dupes.length} journal(s) for one submission pressed twice`)

if (incomeCat) {
  const inc = await abdo.rpc('record_transaction', {
    p_family: fam.id, p_kind: 'income', p_category: incomeCat.id,
    p_amount: 1500000, p_occurred_on: TODAY, p_memo: 'SCREEN CHECK income',
    p_client_uuid: randomUUID(),
  })
  check('Add Transaction: the admin records income', !inc.error, inc.error?.message ?? '')
}

const future = await abdo.rpc('record_transaction', {
  p_family: fam.id, p_kind: 'expense', p_category: expenseCat.id, p_amount: 100,
  p_occurred_on: '2099-01-01', p_memo: 'SCREEN CHECK future', p_client_uuid: randomUUID(),
})
check('…and refuses a day that has not happened',
  /has not happened yet/.test(future.error?.message ?? ''),
  future.error?.message ?? '*** accepted a future date ***')

/* ----------------------------------------------- the member write path -- */
const sub = await zeyad.from('member_expenses').insert({
  family_id: fam.id, person_id: P.Zeyad.id, category_id: expenseCat.id,
  amount_egp: 12500, occurred_on: TODAY, description: 'SCREEN CHECK bus',
  client_uuid: randomUUID(),
}).select().single()
check('Add Transaction: a member submits, and it lands pending',
  !sub.error && sub.data?.status === 'pending', sub.error?.message ?? '')

/* --------------------------------------------------- the admin's screens */
{
  const [bal, month, recent, pending] = await Promise.all([
    abdo.from('account_balances').select('account_id,system_key,kind,balance').eq('family_id', fam.id),
    abdo.from('ledger_feed').select('*').eq('family_id', fam.id).gte('occurred_on', MONTH)
      .order('occurred_on', { ascending: false }).order('recorded_at', { ascending: false }).range(0, 499),
    abdo.from('ledger_feed').select('*').eq('family_id', fam.id)
      .order('occurred_on', { ascending: false }).order('recorded_at', { ascending: false }).range(0, 7),
    abdo.from('member_expenses').select('*').eq('family_id', fam.id).eq('status', 'pending').range(0, 99),
  ])
  const failed = [bal, month, recent, pending].filter(x => x.error)
  const cash = bal.data?.find(b => b.system_key === 'cash')?.balance ?? 0
  const income = month.data.filter(r => r.account_kind === 'income').reduce((a, r) => a + r.signed_amount, 0)
  const spend = -month.data.filter(r => r.account_kind === 'expense').reduce((a, r) => a + r.signed_amount, 0)

  check('Dashboard (admin): every query returns', !failed.length,
    failed.map(f => f.error.message).join('; '))
  check('Dashboard (admin): the KPIs reconcile — cash = income − spending',
    cash === income - spend, `cash ${cash} · income ${income} · spend ${spend}`)
  check('Dashboard (admin): the pending queue is visible', pending.data.length >= 1,
    `${pending.data.length} pending`)
  check('Dashboard (admin): recent activity has rows', recent.data.length >= 2,
    `${recent.data.length} rows`)
}

/* ----------------------------------------------------- Ghada, the auditor */
{
  const [ledger, subs, bal] = await Promise.all([
    ghada.from('ledger_feed').select('*').eq('family_id', fam.id).range(0, 24),
    ghada.from('member_expenses').select('*').eq('family_id', fam.id).range(0, 24),
    ghada.from('account_balances').select('*').eq('family_id', fam.id),
  ])
  check('History (viewer): Ghada watches the whole family',
    !ledger.error && ledger.data.length >= 2 && !subs.error && subs.data.length >= 1 && !bal.error,
    `${ledger.data?.length} ledger rows · ${subs.data?.length} submissions`)
}

/* -------------------------------------------------------- Zeyad, a member */
{
  const [ledger, mine, rate, others] = await Promise.all([
    zeyad.from('ledger_feed').select('*').eq('family_id', fam.id).range(0, 24),
    zeyad.from('member_expenses').select('*').eq('person_id', P.Zeyad.id).range(0, 24),
    zeyad.from('allowance_rates').select('amount_egp').eq('recipient_id', P.Zeyad.id)
      .lte('effective_from', TODAY).order('effective_from', { ascending: false }).limit(1),
    zeyad.from('member_expenses').select('*').eq('person_id', P.Rewan.id),
  ])
  check('History (member): the ledger is EMPTY, not an error',
    !ledger.error && ledger.data.length === 0,
    ledger.error ? `errored: ${ledger.error.message}` : '0 rows and no error — the screen must show a note, not a failure')
  check('Dashboard (member): Zeyad sees his own submissions',
    !mine.error && mine.data.length >= 1, `${mine.data?.length} rows`)
  check('Dashboard (member): his allowance rate resolves',
    !rate.error && rate.data.length === 1, `${rate.data?.[0]?.amount_egp} piastres`)
  check('…and none of Rewan\'s', !others.error && others.data.length === 0,
    `${others.data?.length} of Rewan's rows`)
}

/* -------------------------------------------------------- Joe, the driver */
{
  const { data: day } = await admin.from('car_days').insert({
    family_id: fam.id, drive_date: TODAY, submitted_by: P.Joe.id,
    gross_egp: 90000, direct_egp: 15000, indirect_egp: 0, net_egp: 75000,
    driver_egp: 25000, family_egp: 37500, marwa_egp: 12500,
  }).select().single()

  const [days, ledger] = await Promise.all([
    joe.from('car_days').select('*').eq('family_id', fam.id).gte('drive_date', MONTH)
      .order('drive_date', { ascending: false }).range(0, 199),
    joe.from('ledger_feed').select('*').eq('family_id', fam.id).range(0, 24),
  ])
  const owed = days.data.filter(x => x.status === 'recorded').reduce((a, x) => a + x.family_egp, 0)
  check('Dashboard (driver): Joe sees his own days', !days.error && days.data.length >= 1,
    `${days.data?.length} days · ${owed} owed to the family`)
  check('Dashboard (driver): the ledger is EMPTY, not an error',
    !ledger.error && ledger.data.length === 0,
    ledger.error ? `errored: ${ledger.error.message}` : '0 rows and no error')

  // D10: a losing day is a loss, shared in the same ratios as a profit.
  const loss = await admin.from('car_days').insert({
    family_id: fam.id, drive_date: addDays(TODAY, -1), submitted_by: P.Joe.id,
    gross_egp: 5000, direct_egp: 25000, indirect_egp: 0, net_egp: -20000,
    driver_egp: -7000, family_egp: -9750, marwa_egp: -3250,
  }).select().single()
  check('Dashboard (driver): a losing day stays negative, and still splits exactly',
    !loss.error && loss.data.net_egp === -20000 &&
      loss.data.driver_egp + loss.data.family_egp + loss.data.marwa_egp === -20000,
    loss.error?.message ?? `net ${loss.data?.net_egp}`)

  await admin.from('car_days').delete().eq('id', day.id)
  await admin.from('car_days').delete().eq('id', loss.data?.id ?? '')
}

/* ------------------------------------------------------ History paginates */
{
  const one = await abdo.from('ledger_feed').select('*').eq('family_id', fam.id)
    .order('occurred_on', { ascending: false }).range(0, 0)
  const two = await abdo.from('ledger_feed').select('*').eq('family_id', fam.id)
    .order('occurred_on', { ascending: false }).range(0, 1)
  check('History: range() pages rather than fetching a growing table whole',
    one.data?.length === 1 && two.data?.length === 2,
    `page of 1 → ${one.data?.length} · page of 2 → ${two.data?.length}`)
}

/* ------------------------------------------------------------- cleanup -- */
await admin.from('member_expenses').delete().like('description', 'SCREEN CHECK%')
for (const memo of ['SCREEN CHECK groceries', 'SCREEN CHECK income']) {
  const { data: js } = await admin.from('journals').select('id').eq('memo', memo)
  for (const j of js ?? []) {
    await admin.from('entries').delete().eq('journal_id', j.id)
    await admin.from('journals').delete().eq('id', j.id)
  }
}
await finish(admin)

function addDays(iso, n) {
  const [y, m, d] = iso.split('-').map(Number)
  return dayString(new Date(y, m - 1, d + n))
}
