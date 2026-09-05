/**
 * Seed six months of a plausible household, photograph Reports in both themes
 * and in its table view, then remove every row it created.
 *
 * The palette validator checks colour and nothing else, so the last step of
 * the design procedure is "render it and look at it" — and looking is what
 * caught the bug that mattered: the tick scale could stop BELOW the largest
 * value, so May's income bar was drawn with a negative y, climbed out of its
 * card and sat on top of the subtitle. No amount of reading the code would
 * have shown that.
 *
 *   cd app && npm run build && npm run preview
 *   node shoot-reports.mjs
 *
 * Writes _reports-{light,dark,table}.png, which are gitignored: they are for
 * looking at once, not for keeping.
 */
import { randomUUID } from 'node:crypto'
import { writeFileSync } from 'node:fs'
import { launch, signIn } from './lib/cdp.mjs'
import { loadEnv, asAdmin, asPerson, refuseIfLedgerHasData, dayString } from './lib/env.mjs'

const APP = 'http://localhost:4173/'
const env = loadEnv()
const admin = asAdmin(env)
await refuseIfLedgerHasData(admin)

const abdo = await asPerson(env, 'abdo@samboza.family')
const { data: fam } = await abdo.from('families').select('id').single()
const { data: cats } = await abdo.from('categories').select('id,name_en,kind,needs_recipient')
const { data: ppl } = await abdo.from('people').select('id,display_name')
const P = Object.fromEntries(ppl.map(p => [p.display_name, p]))
const cat = n => cats.find(c => c.name_en === n)

const monthAgo = n => {
  const d = new Date()
  return dayString(new Date(d.getFullYear(), d.getMonth() - n, 12))
}

/* Six months of a plausible household: rent every month, food, the odd
   medical bill, school fees in September, and Ghada's visits. */
const PLAN = []
for (let m = 5; m >= 0; m--) {
  PLAN.push(['expense', 'Rent', 450000, m, null])
  PLAN.push(['expense', 'Food', 180000 + m * 9000, m, null])
  PLAN.push(['expense', 'Allowance', 300000, m, 'Zeyad'])
  PLAN.push(['expense', 'Allowance', 300000, m, 'Rewan'])
  if (m % 2 === 0) PLAN.push(['expense', 'Medical', 62000, m, 'Grandma'])
  if (m === 0 || m === 3) PLAN.push(['expense', 'Education', 240000, m, 'Rewan'])
  if (m === 1) PLAN.push(['expense', 'Gifts', 55000, m, 'Mona'])
  if (m === 4) PLAN.push(['expense', 'Other', 31000, m, null])
  if (m % 3 === 0) PLAN.push(['income', 'Other income', 120000, m, null])
}

for (const [kind, name, amount, m, who] of PLAN) {
  const c = cat(name)
  const { error } = await abdo.rpc('record_transaction', {
    p_family: fam.id, p_kind: kind, p_category: c.id, p_amount: amount,
    p_occurred_on: monthAgo(m), p_person: who ? P[who].id : (c.needs_recipient ? P.Mona.id : null),
    p_memo: 'SHOT', p_client_uuid: randomUUID(),
  })
  if (error) console.log('seed failed', name, error.message)
}
for (const m of [0, 2, 4]) {
  await abdo.rpc('record_remittance', {
    p_family: fam.id, p_from_person: P.Ghada.id, p_amount_original: 900000,
    p_currency: 'SAR', p_fx_rate: 12.9, p_received_on: monthAgo(m),
    p_visit_note: 'SHOT visit', p_client_uuid: randomUUID(),
  })
}
console.log(`seeded ${PLAN.length} entries + 3 remittances`)

const browser = await launch(9350)
const page = await browser.page()
await signIn(page, APP, 'abdo@samboza.family')
await page.click('a[href="/reports"]')
await page.wait(`document.querySelectorAll('.chart').length >= 2`)
await new Promise(r => setTimeout(r, 1200))

const shoot = async (name) => {
  const { result } = await page.screenshot()
  writeFileSync(name, Buffer.from(result.data, 'base64'))
  console.log('wrote', name)
}
// Headless Chrome reports prefers-color-scheme: dark, so light has to be asked
// for explicitly rather than assumed to be the default.
await page.ev(`document.documentElement.dataset.theme = 'light', true`)
await new Promise(r => setTimeout(r, 900))
await shoot('c:/Users/DELL/Desktop/Samboza/scripts/_reports-light.png')

await page.ev(`document.documentElement.dataset.theme = 'dark', true`)
await new Promise(r => setTimeout(r, 900))
await shoot('c:/Users/DELL/Desktop/Samboza/scripts/_reports-dark.png')

// The table view, which the contrast warning obliges.
await page.ev(`[...document.querySelectorAll('.segbtn')].find(b => /Table/.test(b.textContent))?.click(), true`)
await new Promise(r => setTimeout(r, 700))
await shoot('c:/Users/DELL/Desktop/Samboza/scripts/_reports-table.png')

browser.close()

/* ------------------------------------------------------------- cleanup -- */
for (const t of ['remittances']) {
  const { data } = await admin.from(t).select('id,journal_id')
  for (const r of data ?? []) {
    await admin.from(t).delete().eq('id', r.id)
    if (r.journal_id) {
      await admin.from('entries').delete().eq('journal_id', r.journal_id)
      await admin.from('journals').delete().eq('id', r.journal_id)
    }
  }
}
for (const j of (await admin.from('journals').select('id')).data ?? []) {
  await admin.from('entries').delete().eq('journal_id', j.id)
  await admin.from('journals').delete().eq('id', j.id)
}
const { data: bal } = await admin.from('account_balances').select('balance')
console.log('cleanup: non-zero balances', bal.filter(b => b.balance !== 0).length)
