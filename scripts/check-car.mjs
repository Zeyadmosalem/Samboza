/**
 * The car, end to end on the live project.
 *
 * The bug this exists to keep dead: `confirm_handover` cleared
 * due_from_driver and NOTHING ever debited it, so the first handover drove
 * the receivable negative — the books said the family owed Joe the money he
 * had just handed over — and "With the driver" read zero however many days he
 * had recorded. Every balance below is read back from account_balances, not
 * inferred from the fact that a call returned without an error.
 *
 *   node check-car.mjs
 */
import { randomUUID } from 'node:crypto'
import {
  loadEnv, asAdmin, asPerson, refuseIfLedgerHasData, reporter, dayString,
} from './lib/env.mjs'

const env = loadEnv()
const admin = asAdmin(env)
await refuseIfLedgerHasData(admin)
const { check, finish } = reporter()

const abdo = await asPerson(env, 'abdo@samboza.family')
const joe = await asPerson(env, 'joe@samboza.family')
const zeyad = await asPerson(env, 'zeyad@samboza.family')

const { data: fam } = await abdo.from('families').select('id').single()
const { data: accts } = await abdo.from('accounts').select('id,system_key')
const acc = Object.fromEntries(accts.map(a => [a.system_key, a.id]))

const day = n => {
  const d = new Date(); d.setDate(d.getDate() - n); return dayString(d)
}
/** The truth, read back from the ledger rather than assumed. */
const held = async () => {
  const { data } = await admin.from('account_balances')
    .select('balance').eq('account_id', acc.due_from_driver).single()
  return Number(data.balance)
}
const carIncome = async () => {
  const { data } = await admin.from('account_balances')
    .select('balance').eq('account_id', acc.car_income).single()
  return Number(data.balance)
}
/** Owed to Marwa. A liability, so the ledger holds it negative. */
const owedToSharer = async () => {
  const { data } = await admin.from('account_balances')
    .select('balance').eq('account_id', acc.car_share_payable).single()
  return -Number(data.balance)
}

console.log('\n=== the car: what Joe holds, and what the family has earned ===\n')

check('the family has both accounts the car needs',
  !!acc.due_from_driver && !!acc.car_income,
  Object.keys(acc).filter(k => k.startsWith('due') || k.startsWith('car')).join(', '))
check('nothing is owed before Joe records anything', await held() === 0, `${await held()}`)

/* 1 — a good day. 900 EGP taken, 150 of fuel. --------------------------- */
const good = await joe.rpc('record_car_day', {
  p_family: fam.id, p_drive_date: day(1), p_worked: true, p_gross: 90000,
  p_expenses: [{ label: 'fuel', class: 'direct', amount_egp: 15000 }],
  p_client_uuid: randomUUID(),
})
check('Joe records a day', !good.error && !!good.data, good.error?.message ?? '')

const { data: goodRow } = await admin.from('car_days').select('*').eq('id', good.data ?? '').single()
check('…and the database computes the split, not the app',
  goodRow?.net_egp === 75000 && goodRow.driver_egp === 25000 &&
  goodRow.family_egp === 37500 && goodRow.marwa_egp === 12500,
  `net ${goodRow?.net_egp} → Joe ${goodRow?.driver_egp} · family ${goodRow?.family_egp} · Marwa ${goodRow?.marwa_egp}`)

check('…the itemised cost matches the day it belongs to',
  (await admin.from('car_expenses').select('amount_egp').eq('car_day_id', good.data))
    .data.reduce((a, r) => a + r.amount_egp, 0) === goodRow.direct_egp + goodRow.indirect_egp,
  `${goodRow?.direct_egp} direct + ${goodRow?.indirect_egp} indirect`)

// THE FIX, and D14 on top of it: Joe hands Abdo the family's share AND
// Marwa's, so the receivable covers both — but only the family's part is
// income. Marwa's is money the family holds for her.
check('…and what Joe holds is the family share PLUS Marwa\'s',
  await held() === 50000, `due_from_driver = ${await held()} (37500 + 12500)`)
check('…of which only the family share is income',
  await carIncome() === -37500, `car_income = ${await carIncome()} (credit-normal)`)
check('…and Marwa\'s quarter is owed to her, not earned by us',
  await owedToSharer() === 12500, `car_share_payable = ${await owedToSharer()}`)

/* 2 — a day off. Recorded, not absent. ---------------------------------- */
const off = await joe.rpc('record_car_day', {
  p_family: fam.id, p_drive_date: day(2), p_worked: false, p_client_uuid: randomUUID(),
})
const { data: offRow } = await admin.from('car_days').select('status,net_egp').eq('id', off.data ?? '').single()
check('Joe records a day off, and it is a row rather than an absence',
  !off.error && offRow?.status === 'off', off.error?.message ?? `status ${offRow?.status}`)
check('…and it moves no money', await held() === 50000, `${await held()}`)

/* 3 — a losing day (D13): recorded in full, shared by nobody. ----------- */
const bad = await joe.rpc('record_car_day', {
  p_family: fam.id, p_drive_date: day(3), p_worked: true, p_gross: 5000,
  p_expenses: [{ label: 'ticket', class: 'indirect', amount_egp: 25000, description: 'traffic fine' }],
  p_client_uuid: randomUUID(),
})
const { data: badRow } = await admin.from('car_days').select('*').eq('id', bad.data ?? '').single()
check('Joe records a losing day, and the cost is on the record',
  !bad.error && badRow?.net_egp === -20000 && badRow.indirect_egp === 25000,
  `net ${badRow?.net_egp}, cost ${badRow?.indirect_egp} itemised`)
check('…but nobody takes a share of a loss',
  badRow.driver_egp === 0 && badRow.family_egp === 0 && badRow.marwa_egp === 0,
  `Joe ${badRow?.driver_egp} · family ${badRow?.family_egp} · Marwa ${badRow?.marwa_egp}`)
check('…and it posts nothing until Abdo settles it',
  badRow.journal_id === null && await held() === 50000,
  `journal ${badRow?.journal_id} · due_from_driver still ${await held()}`)

const { data: expenseCats } = await abdo.from('categories').select('id,name_en').eq('kind', 'expense')
const other = expenseCats.find(c => c.name_en === 'Other')

const joeSettles = await joe.rpc('settle_car_loss',
  { p_day: bad.data, p_category: other.id, p_memo: 'not mine to settle' })
check('…which the driver cannot do himself', joeSettles.error?.code === '42501',
  joeSettles.error?.message ?? '*** the driver settled his own loss ***')

const settled = await abdo.rpc('settle_car_loss',
  { p_day: bad.data, p_category: other.id, p_memo: 'car maintenance' })
check('Abdo settles it as a family expense, with a note saying what it was',
  !settled.error && !!settled.data, settled.error?.message ?? '')

const { data: lossFeed } = await abdo.from('ledger_feed').select('*')
  .eq('journal_id', settled.data ?? '')
check('…for exactly what Joe was out of pocket, in the category he chose',
  lossFeed?.length === 1 && lossFeed[0].amount === 20000 && lossFeed[0].category_en === 'Other',
  lossFeed?.map(r => `${r.category_en} ${r.signed_amount}`).join(', ') ?? 'nothing posted')

const twice = await abdo.rpc('settle_car_loss', { p_day: bad.data, p_category: other.id })
check('…and it cannot be settled twice',
  /already been settled/.test(twice.error?.message ?? ''),
  twice.error?.message ?? '*** settled twice ***')

/* 4 — voiding a mistyped day. -------------------------------------------- */
const spare = await joe.rpc('record_car_day', {
  p_family: fam.id, p_drive_date: day(4), p_worked: true, p_gross: 30000,
  p_expenses: [], p_client_uuid: randomUUID(),
})
const beforeVoid = await held()
const joeVoids = await joe.rpc('void_car_day', { p_day: spare.data, p_reason: 'mine now' })
check('Joe cannot void his own day', joeVoids.error?.code === '42501',
  joeVoids.error?.message ?? '*** the driver voided a day ***')

const voided = await abdo.rpc('void_car_day', { p_day: spare.data, p_reason: 'recorded twice' })
check('the admin voids it, and the journal is REVERSED rather than deleted',
  voided.data === true && await held() === 50000,
  `due_from_driver ${beforeVoid} → ${await held()}`)
check('…and the voided date is free to record again',
  !(await joe.rpc('record_car_day', {
    p_family: fam.id, p_drive_date: day(4), p_worked: true, p_gross: 1000,
    p_expenses: [], p_client_uuid: randomUUID(),
  })).error, 'Joe re-records the day he got wrong')
const { data: redo } = await admin.from('car_days').select('id')
  .eq('drive_date', day(4)).is('voided_at', null).single()
await abdo.rpc('void_car_day', { p_day: redo.id, p_reason: 'tidying the check' })

/* 5 — the handover, short (D12). ----------------------------------------- */
const cashBefore = Number((await admin.from('account_balances').select('balance')
  .eq('account_id', acc.cash).single()).data.balance)
const short = await abdo.rpc('confirm_handover', {
  p_family: fam.id, p_day_ids: [good.data], p_received_on: dayString(),
  p_counted_egp: 49500, p_note: 'CAR CHECK handover', p_client_uuid: randomUUID(),
})
check('Abdo confirms a handover of BOTH shares, 500 short', !short.error, short.error?.message ?? '')
const cashAfter = Number((await admin.from('account_balances').select('balance')
  .eq('account_id', acc.cash).single()).data.balance)
check('…the cash arrives', cashAfter - cashBefore === 49500, `cash ${cashBefore} → ${cashAfter}`)
check('…and the 500 is CARRIED, not written off',
  await held() === 500, `due_from_driver = ${await held()}`)
check('…while what is owed to Marwa is untouched by the handover',
  await owedToSharer() === 12500, `car_share_payable = ${await owedToSharer()}`)

const { data: dayNow } = await admin.from('car_days').select('status').eq('id', good.data).single()
check('…and the day is settled', dayNow.status === 'settled', dayNow.status)

/* 6 — D14: Marwa is paid her quarter with her allowance, in one envelope. */
{
  const { data: ppl } = await abdo.from('people').select('id,display_name')
  const marwa = ppl.find(p => p.display_name === 'Marwa')
  const period = dayString().slice(0, 7) + '-01'
  const rate = (await abdo.from('allowance_rates').select('amount_egp')
    .eq('recipient_id', marwa.id).order('effective_from', { ascending: false })
    .limit(1)).data[0].amount_egp

  const paid = await abdo.rpc('pay_allowance', {
    p_family: fam.id, p_recipient: marwa.id, p_period: period,
    p_paid_on: dayString(), p_amount: null, p_client_uuid: randomUUID(),
  })
  check('Abdo pays Marwa', !paid.error, paid.error?.message ?? '')

  const { data: row } = await admin.from('allowances').select('amount_egp,journal_id')
    .eq('id', paid.data ?? '').single()
  check('…the allowance record still says the ALLOWANCE, not the total',
    row?.amount_egp === rate, `${row?.amount_egp} vs rate ${rate}`)

  const { data: lines } = await admin.from('entries').select('amount,account_id')
    .eq('journal_id', row.journal_id)
  const cashLine = lines.find(l => l.account_id === acc.cash)
  check('…but one payment left the house, covering both',
    lines.length === 3 && cashLine.amount === -(rate + 12500),
    `${lines.length} lines · cash ${cashLine?.amount} = −(${rate} + 12500)`)
  check('…and Marwa is owed nothing afterwards',
    await owedToSharer() === 0, `car_share_payable = ${await owedToSharer()}`)
}

/* 7 — who may do what. --------------------------------------------------- */
const zeyadRecords = await zeyad.rpc('record_car_day', {
  p_family: fam.id, p_drive_date: day(5), p_worked: true, p_gross: 999,
  p_expenses: [], p_client_uuid: randomUUID(),
})
check('a member cannot record a car day', zeyadRecords.error?.code === '42501',
  zeyadRecords.error?.message ?? '*** a member recorded a day ***')

const joeHands = await joe.rpc('confirm_handover', {
  p_family: fam.id, p_day_ids: [good.data], p_received_on: dayString(),
  p_counted_egp: 100, p_client_uuid: randomUUID(),
})
check('and the driver cannot confirm his own handover', joeHands.error?.code === '42501',
  joeHands.error?.message ?? '*** the driver confirmed his own handover ***')

const direct = await joe.from('car_days').insert({
  family_id: fam.id, drive_date: day(6), submitted_by: null,
  gross_egp: 1, direct_egp: 0, indirect_egp: 0, net_egp: 1,
  driver_egp: 0, family_egp: 1, marwa_egp: 0,
})
check('and nobody writes a car day directly', !!direct.error,
  direct.error?.message?.slice(0, 60) ?? '*** direct insert accepted ***')

/* ------------------------------------------------------------- cleanup -- */
await admin.from('allowances').delete().neq('id', '00000000-0000-0000-0000-000000000000')
await admin.from('car_expenses').delete().in('car_day_id',
  (await admin.from('car_days').select('id')).data.map(d => d.id))
await admin.from('car_days').delete().neq('id', '00000000-0000-0000-0000-000000000000')
await admin.from('car_handovers').delete().neq('id', '00000000-0000-0000-0000-000000000000')
for (const j of (await admin.from('journals').select('id')).data ?? []) {
  await admin.from('entries').delete().eq('journal_id', j.id)
}
await admin.from('journals').update({ reverses: null }).neq('id', '00000000-0000-0000-0000-000000000000')
await admin.from('journals').delete().neq('id', '00000000-0000-0000-0000-000000000000')

await finish(admin)
