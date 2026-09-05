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
import { EMAIL } from './lib/people.mjs'

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

/** innerText for a detail line: one line, trimmed to fit the report. */
const oneLine = (text, max = 120) =>
  (text ?? '').split('\n').filter(Boolean).join(' · ').slice(0, max)

const PEOPLE = [
  // Five on the family dashboard since 0014: the plan asks for "days since
  // last remittance" by name, because income here is lumpy and tied to visits.
  { email: EMAIL.abdo,  who: 'Abdo',  role: 'Admin',  kpis: 5 },
  { email: EMAIL.ghada, who: 'Ghada', role: 'Viewer', kpis: 5 },
  { email: EMAIL.zeyad, who: 'Zeyad', role: 'Member', kpis: 3 },
  { email: EMAIL.rewan, who: 'Rewan', role: 'Member', kpis: 3 },
  { email: EMAIL.joe,   who: 'Joe',   role: 'Driver', kpis: 4 },
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

  if (seen.nav.includes('/car')) {
    await page.click('a[href="/car"]')
    const ok = await page.wait(
      `document.querySelectorAll('.kpi').length === 4 && !document.querySelector('.kpi .v.muted')`)
    const view = await page.ev(`({
      confirm: [...document.querySelectorAll('input[type=checkbox]')].length,
      figures: [...document.querySelectorAll('.kpi .k')].map(k => k.textContent).join(' | '),
    })`)
    check(`${person.who}: the Car screen shows what the driver is holding`, ok, view.figures)
    // Ghada watches; only Abdo can pick days to settle.
    check(`${person.who}: only the admin can select days to settle`,
      person.role === 'Admin' || view.confirm === 0, `${view.confirm} checkboxes`)
  }

  if (seen.nav.includes('/remittance')) {
    await page.click('a[href="/remittance"]')
    const ok = await page.wait(
      `document.querySelectorAll('.kpi').length === 3 && !document.querySelector('.kpi .v.muted')`)
    const view = await page.ev(`({
      form: !!document.querySelector('form.form'),
      rate: !!document.querySelector('.grid3'),
    })`)
    check(`${person.who}: Remittance shows the history`, ok, oneLine(await page.text('.kpis'), 110))
    // Ghada sends the money and still cannot record it: D4 puts the rate in
    // the accountant's hands, and the database refuses her either way.
    check(`${person.who}: only the admin gets the form`,
      view.form === (person.role === 'Admin'), `form ${view.form}`)
  }

  if (seen.nav.includes('/reports')) {
    await page.click('a[href="/reports"]')
    // Four charts and a table view. The table is not a nicety: three palette
    // slots fall below 3:1 on a light surface and the rule says a contrast
    // warning obliges visible labels or a table.
    const ok = await page.wait(`document.querySelectorAll('.chart').length >= 2 ||
      /Nothing recorded|مافيش حاجة متسجلة/.test(document.querySelector('.page')?.innerText ?? '')`)
    const view = await page.ev(`({
      charts: document.querySelectorAll('.chart').length,
      table: [...document.querySelectorAll('.segbtn')].some(b => /Table|جدول/.test(b.textContent)),
      overflow: [...document.querySelectorAll('.chart')].some(c => {
        const box = c.getBoundingClientRect(), card = c.closest('.card').getBoundingClientRect();
        return box.top < card.top - 1 || box.bottom > card.bottom + 1;
      }),
    })`)
    check(`${person.who}: Reports renders`, ok, `${view.charts} charts`)
    // The bug looking at it caught: a bar taller than the top tick escaped its
    // card and landed on the subtitle.
    check(`${person.who}: no chart escapes its card`, !view.overflow, `overflow ${view.overflow}`)
    check(`${person.who}: a table view exists`, view.table, `table toggle ${view.table}`)
  }

  if (seen.nav.includes('/loans')) {
    await page.click('a[href="/loans"]')
    const ok = await page.wait(
      `document.querySelectorAll('.kpi').length === 3 && !document.querySelector('.kpi .v.muted')`)
    const view = await page.ev(`({ form: !!document.querySelector('form.form') })`)
    check(`${person.who}: Loans shows what is owed either way`, ok,
      oneLine(await page.text('.kpis'), 110))
    check(`${person.who}: only the admin can register one`,
      view.form === (person.role === 'Admin'), `form ${view.form}`)
  }

  if (seen.nav.includes('/myearnings')) {
    await page.click('a[href="/myearnings"]')
    const ok = await page.wait(
      `document.querySelectorAll('.kpi').length === 4 && !document.querySelector('.kpi .v.muted')`)
    check(`${person.who}: My Earnings shows his share and what he holds`, ok,
      oneLine(await page.text('.kpis'), 130))
  }

  if (seen.nav.includes('/carday')) {
    await page.click('a[href="/carday"]')
    const ok = await page.wait(`!!document.querySelector('form.form input[inputmode=decimal]')`)
    check(`${person.who}: Record a Day renders the form`, ok,
      oneLine(await page.text('.cardhead'), 60))
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
  await signIn(page, APP, EMAIL.abdo)
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
  await signIn(page, APP, EMAIL.zeyad)
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

/* ------------------------------- Joe records a losing day, Abdo settles it */
{
  const page = await browser.page()
  await signIn(page, APP, EMAIL.joe)
  await page.click('a[href="/carday"]')
  await page.wait(`!!document.querySelector('form.form input[inputmode=decimal]')`)

  // A quiet day with a fine on it: 50 EGP taken, 250 of ticket. D10 says the
  // loss is shared, not floored at zero.
  await page.ev(type('form.form input[inputmode=decimal]', '50'))
  await page.ev(`[...document.querySelectorAll('.btn')]
    .find(b => b.textContent.includes('Add a cost'))?.click(), true`)
  await page.wait(`document.querySelectorAll('.costrow').length === 1`)
  await page.ev(type('.costrow select.input', 'ticket', 'select'))
  await page.ev(type('.costrow input[inputmode=decimal]', '250'))

  // The preview is the thing worth checking: it is computed in JavaScript and
  // has to agree with what Postgres will store, including on a negative half.
  const preview = await page.ev(`(() => {
    const lines = [...document.querySelectorAll('.splitline')]
      .map(l => l.textContent.trim());
    return lines.join(' | ');
  })()`)
  // D13: he sees the loss, and he sees that nobody takes a share of it.
  // Showing him a negative third would say he owes the family for a fine he
  // already paid out of his own pocket.
  check('Joe sees the loss, and that nobody shares it, before he submits',
    /−EGP 200/.test(preview) && !/−EGP 67/.test(preview) && !/−EGP 100/.test(preview),
    preview)

  await page.ev(`document.querySelector('form.form').requestSubmit()`)
  const done = await page.wait(`!!document.querySelector('.donemark')`)
  check('…and records it', done,
    done ? '' : await page.ev(`document.querySelector('.errmsg')?.textContent ?? '(no message)'`))

  const { data: day } = await admin.from('car_days').select('*').is('voided_at', null).single()
  check('…stored in full, and shared by nobody',
    day?.net_egp === -20000 && day.indirect_egp === 25000 &&
    day.driver_egp + day.family_egp + day.marwa_egp === 0,
    `net ${day?.net_egp} → Joe ${day?.driver_egp} · family ${day?.family_egp} · Marwa ${day?.marwa_egp}`)

  // Nothing posts until Abdo settles it: the family owes Joe, and how much of
  // that is maintenance and how much is a fine is his call to record.
  const { data: due } = await admin.from('account_balances').select('balance')
    .eq('system_key', 'due_from_driver').single()
  check('…and it posts nothing to the ledger until Abdo settles it',
    Number(due.balance) === 0 && day.journal_id === null,
    `due_from_driver = ${due.balance} · journal ${day?.journal_id}`)
  await page.dispose()
}

/* --------------------------- Joe in a basement, with no signal at all ---- */
{
  const page = await browser.page()
  await signIn(page, APP, EMAIL.joe)
  await page.click('a[href="/carday"]')
  await page.wait(`!!document.querySelector('form.form input[inputmode=decimal]')`)

  // Genuinely offline: this is what navigator.onLine reads and what every
  // fetch hits, not a flag the page could choose to ignore.
  await page.offline(true)
  await page.wait(`navigator.onLine === false`)

  // A date of its own. The section above already recorded today, and
  // car_days is unique per family per day — so reusing today would have the
  // server refuse this on reconnect, which is a different thing being tested.
  const offlineDay = new Date()
  offlineDay.setDate(offlineDay.getDate() - 9)
  const iso = offlineDay.toISOString().slice(0, 10)
  await page.ev(type('form.form input[type=date]', iso))
  await page.ev(type('form.form input[inputmode=decimal]', '400'))
  await page.ev(`document.querySelector('form.form').requestSubmit()`)
  const kept = await page.wait(`!!document.querySelector('.donemark.waiting')`)
  check('Joe records a day with no connection, and is told it is on the phone',
    kept, oneLine(await page.text('.card.form'), 90))

  const { count: duringOffline } = await admin.from('car_days')
    .select('*', { count: 'exact', head: true }).eq('drive_date', iso)
  check('…nothing reached the database yet', duringOffline === 0, `${duringOffline} rows for ${iso}`)

  // He presses submit again, because nothing appeared to happen. This is the
  // exact moment client_uuid was invented for.
  await page.ev(`[...document.querySelectorAll('.btn')]
    .find(b => /Record another|سجّل يوم/.test(b.textContent))?.click(), true`)
  await page.wait(`!!document.querySelector('form.form input[inputmode=decimal]')`)
  const queued = await page.ev(`JSON.parse(localStorage.getItem('samboza-outbox') || '[]').length`)
  check('…and it is waiting in the outbox', queued === 1, `${queued} queued`)

  // The signal comes back.
  await page.offline(false)
  await page.wait(`navigator.onLine === true`)
  await page.ev(`window.dispatchEvent(new Event('online')), true`)

  for (let i = 0; i < 40; i++) {
    const { count } = await admin.from('car_days')
      .select('*', { count: 'exact', head: true }).eq('drive_date', iso)
    if (count === 1) break
    await new Promise(r => setTimeout(r, 500))
  }
  const { count: after } = await admin.from('car_days')
    .select('*', { count: 'exact', head: true }).eq('drive_date', iso)
  check('…and when the signal returns it sends itself, exactly once',
    after === 1, `${after} row(s) for ${iso} after reconnecting`)

  const left = await page.ev(`JSON.parse(localStorage.getItem('samboza-outbox') || '[]').length`)
  check('…leaving the outbox empty', left === 0, `${left} still queued`)

  // And the part without which none of the above is reachable: the app has to
  // LOAD with no signal. A queue on a page that will not open is nothing.
  const sw = await page.wait(`navigator.serviceWorker?.controller !== null`, 8000)
  await page.offline(true)
  await page.go(APP)
  // Chrome drops network emulation when a navigation commits, so the document
  // fetch happened offline — which is the half that proves the cache works —
  // and the page then came back online. Re-apply it before judging the rest.
  await page.offline(true)
  const loaded = await page.wait(`!!document.querySelector('.shell')`, 12000)
  const stale = await page.ev(
    `/Showing what this phone|ده آخر اللي الموبايل/.test(document.body.innerText)`)
  check('…and the app still opens with no connection at all', sw && loaded,
    sw ? (loaded ? 'shell served from cache' : 'the page did not render')
       : 'no service worker took control')
  // And says so, rather than presenting a figure from yesterday as today's.
  check('…and says the figures are what it last knew', loaded && stale,
    stale ? 'the stale banner is shown' : 'no banner — it looks current')
  await page.offline(false)
  await page.dispose()

  for (const d of (await admin.from('car_days').select('id,journal_id')).data ?? []) {
    await admin.from('car_expenses').delete().eq('car_day_id', d.id)
    await admin.from('car_days').delete().eq('id', d.id)
    if (d.journal_id) {
      await admin.from('entries').delete().eq('journal_id', d.journal_id)
      await admin.from('journals').delete().eq('id', d.journal_id)
    }
  }
}

/* ------------------------------------------------------------- cleanup -- */
{
  const { data: days } = await admin.from('car_days').select('id,journal_id')
  for (const d of days ?? []) {
    await admin.from('car_expenses').delete().eq('car_day_id', d.id)
    await admin.from('car_days').delete().eq('id', d.id)
    if (d.journal_id) {
      await admin.from('entries').delete().eq('journal_id', d.journal_id)
      await admin.from('journals').delete().eq('id', d.journal_id)
    }
  }
}
await admin.from('member_expenses').delete().eq('description', MEMO)
const { data: js } = await admin.from('journals').select('id').eq('memo', MEMO)
for (const j of js ?? []) {
  await admin.from('entries').delete().eq('journal_id', j.id)
  await admin.from('journals').delete().eq('id', j.id)
}

browser.close()
await finish(admin)
