/**
 * THE RESET LINK, END TO END, ON A THROWAWAY ACCOUNT.
 *
 *   node scripts/check-reset.mjs                                  (local preview)
 *   APP_URL=https://samboza.ncspark.workers.dev/ node scripts/check-reset.mjs
 *
 * This is the one flow nobody in the family will exercise until the day they
 * are locked out, which is the worst possible day to discover it does not
 * work. So it is driven here on an account created and deleted by this
 * script — no real person's password is touched.
 *
 * Against a deployed site it walks the ACTUAL link, because two of the ways
 * this breaks are invisible from anywhere else:
 *
 *   Supabase refuses a redirect it was not told to allow, and rather than
 *   saying so it drops the person on the site root — signed in, on the
 *   dashboard, with no idea why the link did nothing.
 *
 *   /reset is not a file. A host that does not know this is a single-page app
 *   returns its own 404 to everyone who ever clicks a reset link.
 *
 * The token is single-use, so the link is followed once and the rest of the
 * test continues in that same browser. Following it and then verifying the
 * same token again would fail on the second attempt — correctly, and for a
 * reason that has nothing to do with what is being tested.
 */
import { createClient } from '@supabase/supabase-js'
import { loadEnv, asAdmin, reporter } from './lib/env.mjs'
import { launch, type } from './lib/cdp.mjs'

const APP = (process.env.APP_URL ?? 'http://localhost:4173/').replace(/\/$/, '')
const PROBE = 'reset-probe@samboza.family'
const OLD = 'ProbeOld2026!'
const NEW = 'ProbeNew2026!'

const env = loadEnv()
const admin = asAdmin(env)
const { check, finish } = reporter()

/** Remove any probe left by a run that crashed, then make a fresh one. */
async function freshProbe() {
  const { data } = await admin.auth.admin.listUsers({ perPage: 200 })
  const old = data.users.find(u => u.email === PROBE)
  if (old) await admin.auth.admin.deleteUser(old.id)
  const { data: made, error } = await admin.auth.admin.createUser({
    email: PROBE, password: OLD, email_confirm: true,
  })
  if (error) throw new Error('could not create the probe: ' + error.message)
  return made.user
}

const user = await freshProbe()
let browser
try {
  browser = await launch(9380)
  const page = await browser.page()

  // 1. The link the email would carry.
  const { data: link, error: linkErr } = await admin.auth.admin.generateLink({
    type: 'recovery', email: PROBE, options: { redirectTo: APP + '/reset' },
  })
  check('a reset link can be generated at all',
    !linkErr && !!link?.properties?.action_link, linkErr?.message ?? '')

  // 2. Follow it, exactly as the person would.
  await page.go(link.properties.action_link)
  const asked = await page.wait(`!!document.querySelector('input[autocomplete="new-password"]')`, 15000)
  const where = await page.ev(`location.pathname`)
  check('the link lands on the password screen', asked && where === '/reset',
    asked && where === '/reset'
      ? where
      : `landed on ${where} — if that is "/", add ${APP}/reset under Supabase -> ` +
        `Authentication -> URL Configuration -> Redirect URLs`)

  // The dashboard is what a person gets if nothing noticed: signed in, and
  // still on the password they could not remember.
  check('…rather than dropping them on the dashboard, signed in',
    !(await page.ev(`!!document.querySelector('.shell')`)))

  // 3. Refuse the obvious mistakes before the round trip.
  await page.ev(type('#pw', 'short'))
  await page.ev(type('#again', 'short'))
  check('…refuses a password that is too short',
    await page.ev(`document.querySelector('button[type=submit]').disabled`))

  await page.ev(type('#pw', NEW))
  await page.ev(type('#again', NEW + 'x'))
  check('…refuses two that do not match',
    await page.ev(`document.querySelector('button[type=submit]').disabled`))

  // 4. Set it.
  await page.ev(type('#again', NEW))
  check('…accepts a good one',
    !(await page.ev(`document.querySelector('button[type=submit]').disabled`)))
  await page.ev(`document.querySelector('form').requestSubmit()`)

  const saved = await page.wait(
    `/Done|تمام/.test(document.querySelector('.auth-card .sub')?.innerText ?? '')`, 15000)
  check('…and saves it, saying so', saved,
    (await page.text('.auth-card .sub')) ?? 'no confirmation')

  // 5. The only test that matters: which password now works.
  const fresh = () => createClient(env.url, env.anon, { auth: { persistSession: false } })
  const withNew = await fresh().auth.signInWithPassword({ email: PROBE, password: NEW })
  check('the new password signs in', !withNew.error, withNew.error?.message ?? '')

  const withOld = await fresh().auth.signInWithPassword({ email: PROBE, password: OLD })
  check('the old one no longer does', !!withOld.error, withOld.error?.message ?? 'IT STILL WORKS')

  // 6. The link is spent. Following it again must not hand out a second
  //    chance to set the password — a link forwarded to the wrong chat, or
  //    left in an inbox, is otherwise a standing key to the account.
  const page2 = await browser.page()
  await page2.go(link.properties.action_link)
  const reusable = await page2.wait(`!!document.querySelector('input[autocomplete="new-password"]')`, 6000)
  check('and the link cannot be used twice', !reusable,
    reusable ? 'IT ASKED AGAIN' : 'refused, as it should be')
} finally {
  if (browser) browser.close()
  await admin.auth.admin.deleteUser(user.id)
  const { data } = await admin.auth.admin.listUsers({ perPage: 200 })
  console.log(`\n  probe account removed: ${!data.users.some(u => u.email === PROBE)}`)
}

await finish(admin)
