/**
 * THE RESET LINK, END TO END, ON A THROWAWAY ACCOUNT.
 *
 *   cd app && npm run build && npm run preview
 *   node scripts/check-reset.mjs
 *
 * This is the one flow nobody in the family will exercise until the day they
 * are locked out, which is the worst possible day to discover it does not
 * work. So it is driven here on an account created and deleted by this
 * script — no real person's password is touched.
 *
 * The link is not clicked through the mail. generateLink gives the same
 * one-time token the email would carry; verifying it produces exactly the
 * session the link produces, and it is handed to the app in the URL fragment
 * exactly as Supabase hands it over. What is being tested is the app's half:
 * that it notices, that it asks, and that the new password is the one that
 * works afterwards.
 */
import { createClient } from '@supabase/supabase-js'
import { loadEnv, asAdmin, reporter } from './lib/env.mjs'
import { launch, type } from './lib/cdp.mjs'

const APP = 'http://localhost:4173/'
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
  // 1. The token the email would carry.
  const { data: link, error: linkErr } = await admin.auth.admin.generateLink({
    type: 'recovery', email: PROBE,
  })
  check('a reset link can be generated at all',
    !linkErr && !!link?.properties?.email_otp,
    linkErr?.message ?? `otp ${link?.properties?.email_otp ? 'present' : 'missing'}`)

  // 2. Verifying it yields the session the link yields.
  const anon = createClient(env.url, env.anon, { auth: { persistSession: false } })
  const { data: sess, error: otpErr } = await anon.auth.verifyOtp({
    email: PROBE, token: link.properties.email_otp, type: 'recovery',
  })
  check('…and it verifies into a session',
    !otpErr && !!sess?.session?.access_token, otpErr?.message ?? '')

  // 3. Hand it to the app the way Supabase does: in the fragment.
  const s = sess.session
  const hash = `#access_token=${s.access_token}&refresh_token=${s.refresh_token}` +
               `&expires_in=3600&token_type=bearer&type=recovery`
  browser = await launch(9380)
  const page = await browser.page()
  await page.go(APP + 'reset' + hash)

  const asked = await page.wait(`!!document.querySelector('input[autocomplete="new-password"]')`, 12000)
  check('the app notices the link and asks for a new password', asked,
    asked ? await page.text('.auth-card h1') : 'no password form appeared')

  // The dashboard is what a person gets if nothing noticed: signed in,
  // still on the password they could not remember.
  check('…rather than dropping them on the dashboard, signed in',
    !(await page.ev(`!!document.querySelector('.shell')`)))

  // 4. Refuse the obvious mistakes before the round trip.
  await page.ev(type('#pw', 'short'))
  await page.ev(type('#again', 'short'))
  check('…refuses a password that is too short',
    await page.ev(`document.querySelector('button[type=submit]').disabled`))

  await page.ev(type('#pw', NEW))
  await page.ev(type('#again', NEW + 'x'))
  check('…refuses two that do not match',
    await page.ev(`document.querySelector('button[type=submit]').disabled`))

  // 5. Set it.
  await page.ev(type('#again', NEW))
  check('…accepts a good one', !(await page.ev(`document.querySelector('button[type=submit]').disabled`)))
  await page.ev(`document.querySelector('form').requestSubmit()`)

  const saved = await page.wait(`/${'Done'}/.test(document.querySelector('.auth-card .sub')?.innerText ?? '')`, 12000)
  check('…and saves it, saying so', saved,
    (await page.text('.auth-card .sub')) ?? 'no confirmation')

  // 6. The only test that matters: which password now works.
  const fresh = () => createClient(env.url, env.anon, { auth: { persistSession: false } })
  const withNew = await fresh().auth.signInWithPassword({ email: PROBE, password: NEW })
  check('the new password signs in', !withNew.error, withNew.error?.message ?? '')

  const withOld = await fresh().auth.signInWithPassword({ email: PROBE, password: OLD })
  check('the old one no longer does', !!withOld.error, withOld.error?.message ?? 'IT STILL WORKS')

  // 7. The link is spent.
  const again = await fresh().auth.verifyOtp({
    email: PROBE, token: link.properties.email_otp, type: 'recovery',
  })
  check('and the link cannot be used twice', !!again.error, again.error?.message ?? 'REUSABLE')
} finally {
  if (browser) browser.close()
  await admin.auth.admin.deleteUser(user.id)
  const { data } = await admin.auth.admin.listUsers({ perPage: 200 })
  console.log(`\n  probe account removed: ${!data.users.some(u => u.email === PROBE)}`)
}

await finish(admin)
