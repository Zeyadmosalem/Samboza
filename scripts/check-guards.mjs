/**
 * The security invariants, checked against the LIVE project.
 *
 * `supabase test db` is the real suite and CI runs it on every push, but it
 * needs Docker and Docker is not always there. These are the same questions
 * asked of the deployed database — and they are questions that must be ASKED,
 * not reasoned about: the view leak in 0008 and the cross-family posting in
 * 0009 both had policies that read correctly and behaved otherwise.
 *
 *   node check-guards.mjs
 *
 * Every check states what it expects AFTER the fix, so running it against a
 * database missing 0009 fails all six — which is how the fix was demonstrated.
 */
import { randomUUID } from 'node:crypto'
import { loadEnv, asAdmin, asPerson, refuseIfLedgerHasData, reporter, dayString } from './lib/env.mjs'

const env = loadEnv()
const admin = asAdmin(env)
await refuseIfLedgerHasData(admin)
const { check, finish } = reporter()

const TODAY = dayString()
const abdo = await asPerson(env, 'abdo@samboza.family')

const { data: fam } = await abdo.from('families').select('id').single()
const { data: accts } = await abdo.from('accounts').select('id,system_key')
const cash = accts.find(a => a.system_key === 'cash')
const due = accts.find(a => a.system_key === 'due_from_driver')
const { data: cats } = await abdo.from('categories').select('id,kind,needs_recipient')
const food = cats.find(c => c.kind === 'expense' && !c.needs_recipient)
const { data: ppl } = await abdo.from('people').select('id,display_name')
const P = Object.fromEntries(ppl.map(p => [p.display_name, p]))

/* A second family, with its own account and its own signed-in admin. Every
   check below asks whether Samboza can reach into it, or it into Samboza. */
const { data: fam2 } = await admin.from('families')
  .insert({ code: 'AUDT-0001', name: 'Audit probe' }).select().single()
const { data: acc2 } = await admin.from('accounts')
  .insert({ family_id: fam2.id, kind: 'asset', name: 'Their cash', system_key: 'cash' })
  .select().single()
const OUT = { email: 'audit-outsider@samboza.family', pw: 'AuditProbe2026!' }
const { data: outUser } = await admin.auth.admin.createUser({
  email: OUT.email, password: OUT.pw, email_confirm: true,
})
const { data: outP } = await admin.from('people').insert({
  family_id: fam2.id, member_no: 1, display_name: 'Outsider', relationship: 'external',
  is_user: true, auth_user_id: outUser.user.id, role: 'admin',
}).select().single()
const outsider = await asPerson(env, OUT.email, OUT.pw)

const refused = e => e && (e.code === '42501' ||
  /insufficient|not a member|another family|in this family/i.test(e.message))

console.log('\n=== 0009 — a definer function must not trust its arguments ===\n')

/* 1 — the finding. Abdo is a real admin; the account is not his family's. */
{
  const { error } = await abdo.rpc('post_journal', {
    p_family: fam.id, p_occurred_on: TODAY, p_memo: 'GUARD 1',
    p_lines: [{ account_id: acc2.id, amount: 5000 }, { account_id: cash.id, amount: -5000 }],
  })
  const { data: landed } = await admin.from('entries').select('id').eq('account_id', acc2.id)
  check('post_journal refuses another family\'s account',
    refused(error) && !landed.length,
    error ? error.message : `*** wrote ${landed.length} entry into AUDT-0001 ***`)
}

/* 2 — the same hole, via person_id rather than account_id. */
{
  const { error } = await abdo.rpc('post_journal', {
    p_family: fam.id, p_occurred_on: TODAY, p_memo: 'GUARD 2',
    p_lines: [
      { account_id: cash.id, amount: 5000, person_id: outP.id },
      { account_id: cash.id, amount: -5000 },
    ],
  })
  check('post_journal refuses another family\'s person on a line',
    refused(error), error?.message ?? '*** a foreign name landed on our ledger ***')
}

/* 3 — and through record_transaction, where it is only attribution. */
{
  const { error } = await abdo.rpc('record_transaction', {
    p_family: fam.id, p_kind: 'expense', p_category: food.id, p_amount: 100,
    p_occurred_on: TODAY, p_person: outP.id, p_memo: 'GUARD 3',
  })
  check('record_transaction refuses a person from another family',
    refused(error), error?.message ?? '*** allowed ***')
}

/* 4 — the NULL-role fall-through. `v_me.role <> 'admin'` is NULL, not TRUE,
       when the caller is in no family at all. It used to be caught further
       down by a CHECK constraint, which is an accident and not a control. */
{
  const { data: sub } = await admin.from('member_expenses').insert({
    family_id: fam.id, person_id: P.Zeyad.id, category_id: food.id,
    amount_egp: 4242, occurred_on: TODAY, description: 'GUARD 4',
  }).select().single()
  const { error } = await outsider.rpc('decide_member_expense',
    { p_id: sub.id, p_status: 'approved' })
  const { data: after } = await admin.from('member_expenses')
    .select('status').eq('id', sub.id).single()
  check('decide_member_expense fails closed for a non-member — 42501, not a constraint',
    error?.code === '42501' && after.status === 'pending',
    `${error?.code ?? 'no error'} · still ${after.status}`)
  await admin.from('member_expenses').delete().eq('id', sub.id)
}

/* 5 — the same, in reverse_journal, where it used to be a NOT NULL violation. */
{
  const { data: jid } = await abdo.rpc('record_transaction', {
    p_family: fam.id, p_kind: 'expense', p_category: food.id, p_amount: 500,
    p_occurred_on: TODAY, p_memo: 'GUARD 5',
  })
  const { error } = await outsider.rpc('reverse_journal', { p_journal: jid, p_memo: 'not yours' })
  const { data: rev } = await admin.from('journals').select('id').eq('reverses', jid)
  check('reverse_journal fails closed for a non-member — 42501, not a constraint',
    error?.code === '42501' && !rev.length,
    `${error?.code ?? 'no error'} · ${rev.length} reversals posted`)
  await admin.from('entries').delete().eq('journal_id', jid)
  await admin.from('journals').delete().eq('id', jid)
}

/* 6 — and the handover now derives its own accounts instead of being told. */
{
  if (!due) {
    check('confirm_handover derives cash and due_from_driver itself', false,
      'no due_from_driver account — run bootstrap.mjs')
  } else {
    const { data: day } = await admin.from('car_days').insert({
      family_id: fam.id, drive_date: TODAY, submitted_by: P.Joe.id,
      gross_egp: 90000, direct_egp: 15000, indirect_egp: 0, net_egp: 75000,
      driver_egp: 25000, family_egp: 37500, marwa_egp: 12500,
    }).select().single()
    const { data: ho, error } = await abdo.rpc('confirm_handover', {
      p_family: fam.id, p_day_ids: [day.id], p_received_on: TODAY,
      p_counted_egp: 37000, p_note: 'GUARD 6', p_client_uuid: randomUUID(),
    })
    const { data: bal } = await admin.from('account_balances')
      .select('balance').eq('account_id', due.id).single()
    // 37,500 was due and 37,000 arrived: the 500 stays in the receivable (D12).
    check('confirm_handover takes no account parameters, and carries the shortfall',
      !error && !!ho && bal.balance === -37000,
      error ? `${error.code}: ${error.message}` : `due_from_driver ${bal.balance}`)

    const { data: h } = await admin.from('car_handovers').select('id,journal_id').eq('note', 'GUARD 6')
    await admin.from('car_days').delete().eq('id', day.id)
    for (const row of h ?? []) {
      await admin.from('car_handovers').delete().eq('id', row.id)
      await admin.from('entries').delete().eq('journal_id', row.journal_id)
      await admin.from('journals').delete().eq('id', row.journal_id)
    }
  }
}

/* ------------------------------------------------------------- cleanup -- */
for (const memo of ['GUARD 1', 'GUARD 2', 'GUARD 3', 'GUARD 5']) {
  const { data: js } = await admin.from('journals').select('id').eq('memo', memo)
  for (const j of js ?? []) {
    await admin.from('entries').delete().eq('journal_id', j.id)
    await admin.from('journals').delete().eq('id', j.id)
  }
}
await admin.from('entries').delete().eq('account_id', acc2.id)
await admin.from('people').delete().eq('id', outP.id)
await admin.auth.admin.deleteUser(outUser.user.id)
await admin.from('accounts').delete().eq('family_id', fam2.id)
await admin.from('families').delete().eq('id', fam2.id)

await finish(admin)
