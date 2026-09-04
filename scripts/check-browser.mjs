/**
 * The screens, in a real browser, as each of the five people.
 *
 * There is no test framework in `app/`, and this is deliberately not the start
 * of one — it is the single check that stands between "it compiles" and "Abdo
 * can record the shopping". It signs each person in inside their OWN browser
 * context, walks their screens, and then records real money through the actual
 * form and reads it back out of History.
 *
 *   npm run preview      (in app/, on port 4173)
 *   node check-browser.mjs
 *
 * Set CHROME_PATH if neither Chrome nor Edge is where it usually is.
 */
import { randomUUID } from 'node:crypto'
import { launch, signIn, type } from './lib/cdp.mjs'
import { loadEnv, asAdmin, refuseIfLedgerHasData, reporter } from './lib/env.mjs'

const APP = process.env.APP_URL ?? 'http://localhost:4173/'
const env = loadEnv()
const admin = asAdmin(env)
await refuseIfLedgerHasData(admin)
const { check, finish } = reporter()

try {
  const res = await fetch(APP)
  if (!res.ok) throw new Error(String(res.status))
} catch {
  console.error(`\nNothing is serving ${APP}.\n  cd app && npm run build && npm run preview\n`)
  process.exit(1)
}

const browser = await launch()

const PEOPLE = [
  { email: 'abdo@samboza.family',  who: 'Abdo',  role: 'Admin',  kpis: 4 },
  { email: 'ghada@samboza.family', who: 'Ghada', role: 'Viewer', kpis: 4 },
  { email: 'zeyad@samboza.family', who: 'Zeyad', role: 'Member', kpis: 3 },
  { email: 'rewan@samboza.family', who: 'Rewan', role: 'Member', kpis: 3 },
  { email: 'joe@samboza.family',   who: 'Joe',   role: 'Driver', kpis: 4 },
]

console.log('\n=== the screens, one clean browser context per person ===\n')

for (const person of PEOPLE) {
  const page = await browser.page()
  const inShell = await signIn(page, APP, person.email)
  check(`${person.who} signs in and reaches the shell`, inShell,
    inShell ? '' : (await page.text('body'))?.slice(0, 200))
  if (!inShell) { await page.dispose(); continue }

  // Read the figures only once they are figures. A KPI shows a muted dash
  // until its query returns, and reading during that window measures the
  // loading state and calls it the dashboard.
  await page.wait(`document.querySelector('.kpi') && !document.querySelector('.kpi .v.muted')`)

  const seen = await page.ev(`({
    role: document.querySelector('.userchip .r')?.textContent,
    name: document.querySelector('.userchip .n')?.textContent,
    nav:  [...document.querySelectorAll('.navitem')].map(a => a.getAttribute('href')),
    kpis: document.querySelectorAll('.kpi').length,
    figures: [...document.querySelectorAll('.kpi')]
      .map(k => k.querySelector('.k').textContent + ' ' + k.querySelector('.v').textContent)
      .join(' | '),
  })`)

  check(`${person.who}: the dashboard shows the ${person.kpis} figures for a ${person.role.toLowerCase()}`,
    seen.kpis === person.kpis && seen.role === person.role,
    `${seen.name} · ${seen.role} · ${seen.figures}`)

  // Navigation is a courtesy, not a control — but it should still agree with
  // the role, and the driver must not be offered the approvals queue.
  check(`${person.who}: navigation matches the role`,
    seen.nav.length > 0 && (person.role !== 'Driver' || !seen.nav.includes('/approvals')),
    seen.nav.join(' '))

  if (seen.nav.includes('/history')) {
    await page.click('a[href="/history"]')
    const ok = await page.wait(`document.querySelectorAll('.filters .field').length === 4`)
    const note = await page.ev(`document.querySelector('.notice')?.textContent ?? 'no note'`)
    check(`${person.who}: History renders its four filters`, ok, note)
  }

  if (seen.nav.includes('/add')) {
    await page.click('a[href="/add"]')
    // Wait for the CATEGORIES, not merely for the <select>. An empty dropdown
    // is precisely the failure this check exists to catch, and waiting on the
    // element alone would pass while the family could record nothing.
    const ok = await page.wait(
      `document.querySelectorAll('form.form select.input')[0]?.options.length > 1`)
    const form = await page.ev(`({
      cats: document.querySelectorAll('form.form select.input')[0]?.options.length ?? 0,
      seg: [...document.querySelectorAll('.segbtn')].map(b => b.textContent).join('/') || 'none',
      btn: document.querySelector('form.form .btn')?.textContent,
    })`)
    check(`${person.who}: Add Transaction offers real categories`,
      ok && form.cats > 1,
      ok ? `${form.cats - 1} categories · ${form.seg} · "${form.btn}"`
         : 'page was: ' + (await page.text('.page'))?.slice(0, 160))
  }

  // Allowance: Abdo can pay, Ghada sees the same figures with no buttons.
  if (seen.nav.includes('/allowance')) {
    await page.click('a[href="/allowance"]')
    const ok = await page.wait(`document.querySelectorAll('.rows .row').length > 0`)
    const view = await page.ev(`({
      people: document.querySelectorAll('.rows .row').length,
      pay: [...document.querySelectorAll('.btn')].filter(b => /Pay|اصرف/.test(b.textContent)).length,
    })`)
    check(`${person.who}: Allowance lists the recipients`, ok, `${view.people} people`)
    // Ghada watches and changes nothing. The database refuses her either way.
    check(`${person.who}: only the admin is offered a Pay button`,
      person.role === 'Admin' ? view.pay > 0 : view.pay === 0,
      `${view.pay} pay buttons`)
  }

  if (seen.nav.includes('/myspending')) {
    await page.click('a[href="/myspending"]')
    // Settled figures, not the muted dashes they show while loading.
    const ok = await page.wait(
      `document.querySelectorAll('.kpi').length === 4 && !document.querySelector('.kpi .v.muted')`)
    check(`${person.who}: My Spending shows a balance`, ok,
      (await page.text('.kpis'))?.split('\n').join(' · ').slice(0, 120))
  }

  if (seen.nav.includes('/approvals')) {
    await page.click('a[href="/approvals"]')
    // Settled: either rows to decide, or the sentence saying there are none.
    // Waiting on the heading alone would only prove the heading is a heading.
    const ok = await page.wait(`document.querySelectorAll('.rows .row').length > 0 ||
      /Nothing waiting|مافيش حاجة مستنية/.test(document.querySelector('.page')?.innerText ?? '')`)
    check(`${person.who}: Approvals renders the queue`, ok,
      (await page.text('.page'))?.split('\n').join(' · ').slice(0, 110))
  }

  // Typing a URL the role has no business on. The nav hides it and the
  // database refuses it; neither should end in a blank screen.
  await page.go(APP + 'approvals')
  check(`${person.who}: typing /approvals directly does not break the app`,
    await page.wait(`!!document.querySelector('.shell')`))

  await page.dispose()
}

/* ------------------------------------------- end to end, through the form */
console.log('\n=== recording real money, through the real form ===\n')
const MEMO = 'BROWSER CHECK ' + randomUUID().slice(0, 8)

{
  const page = await browser.page()
  await signIn(page, APP, 'abdo@samboza.family')
  await page.click('a[href="/add"]')
  await page.wait(`document.querySelectorAll('form.form select.input')[0]?.options.length > 1`)

  await page.ev(type('form.form input[inputmode=decimal]', '123.45'))
  const cat = await page.ev(`(() => {
    const s = document.querySelectorAll('form.form select.input')[0];
    return ([...s.options].find(o => o.textContent === 'Food') ?? s.options[1]).value;
  })()`)
  await page.ev(type('form.form select.input', cat, 'select'))
  await page.ev(type('form.form input:not([inputmode]):not([type=date])', MEMO))
  await page.ev(`document.querySelector('form.form').requestSubmit()`)

  const done = await page.wait(`!!document.querySelector('.donemark')`)
  check('Abdo records EGP 123.45 through the form', done,
    done ? '' : await page.ev(`document.querySelector('.errmsg')?.textContent ?? '(no message)'`))

  const { data: js } = await admin.from('journals').select('id').eq('memo', MEMO)
  const { data: ent } = js?.length
    ? await admin.from('entries').select('amount').eq('journal_id', js[0].id)
    : { data: [] }
  check('…and it lands as ONE balanced journal of 12345 piastres',
    js?.length === 1 && ent.length === 2 &&
      ent.some(e => e.amount === 12345) && ent.reduce((a, e) => a + e.amount, 0) === 0,
    `${js?.length} journal · lines ${ent.map(e => e.amount).join(' + ')}`)

  await page.click('a[href="/history"]')
  const shows = await page.wait(
    `[...document.querySelectorAll('.rows .row')].some(r => r.textContent.includes('123'))`)
  check('…and Abdo sees it in History', shows,
    (await page.text('.rows .row'))?.replace(/\n/g, ' · ') ?? '(no rows)')
  await page.dispose()
}

{
  const page = await browser.page()
  await signIn(page, APP, 'zeyad@samboza.family')
  await page.click('a[href="/add"]')
  await page.wait(`document.querySelectorAll('form.form select.input')[0]?.options.length > 1`)

  await page.ev(type('form.form input[inputmode=decimal]', '60'))
  const cat = await page.ev(`document.querySelectorAll('form.form select.input')[0].options[1].value`)
  await page.ev(type('form.form select.input', cat, 'select'))
  await page.ev(type('form.form input:not([inputmode]):not([type=date])', MEMO))
  await page.ev(`document.querySelector('form.form').requestSubmit()`)

  const done = await page.wait(`!!document.querySelector('.donemark')`)
  check('Zeyad submits EGP 60 through the form', done,
    done ? '' : await page.ev(`document.querySelector('.errmsg')?.textContent ?? '(no message)'`))

  const { data: subs } = await admin.from('member_expenses')
    .select('amount_egp,status').eq('description', MEMO)
  check('…and it lands pending, at 6000 piastres',
    subs?.length === 1 && subs[0].amount_egp === 6000 && subs[0].status === 'pending',
    subs?.map(s => `${s.amount_egp} ${s.status}`).join(', '))

  await page.click('a[href="/history"]')
  const pending = await page.wait(
    `[...document.querySelectorAll('.rows .row .badge')].some(b => b.textContent === 'Pending')`)
  check('…and his History shows it pending', pending,
    (await page.text('.rows .row'))?.replace(/\n/g, ' · ') ?? '(no rows)')

  // The one that matters: Abdo's journal, posted minutes ago, is invisible.
  const ledgerRows = await page.ev(
    `[...document.querySelectorAll('.badge')].filter(b => b.textContent === 'Family ledger').length`)
  check('…and the family ledger is not among his rows', ledgerRows === 0,
    `${ledgerRows} ledger rows visible to a member`)
  await page.dispose()
}

/* ------------------------------------------------------------- cleanup -- */
await admin.from('member_expenses').delete().eq('description', MEMO)
const { data: js } = await admin.from('journals').select('id').eq('memo', MEMO)
for (const j of js ?? []) {
  await admin.from('entries').delete().eq('journal_id', j.id)
  await admin.from('journals').delete().eq('id', j.id)
}

browser.close()
await finish(admin)
