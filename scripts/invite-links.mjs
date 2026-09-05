/**
 * ONE LINK PER PERSON, SO NOBODY ELSE EVER KNOWS THEIR PASSWORD.
 *
 *   node scripts/invite-links.mjs --site https://samboza.pages.dev
 *
 * The five accounts currently share one password, which means every policy in
 * this project is decorative: Zeyad can sign in as Abdo and approve his own
 * spending. The fix is not a better shared password. It is that each person
 * sets their own and nobody — not Abdo, not whoever runs this script — ever
 * sees it.
 *
 * These are generated rather than emailed on purpose. A free Supabase project
 * sends a couple of messages an hour project-wide, so five reset emails take
 * an afternoon and the first ones expire while the last are still queued.
 * A link handed over on WhatsApp arrives instantly.
 *
 * TREAT EACH LINK AS THE PASSWORD ITSELF. Anyone holding one can set that
 * account's password until it is used or expires. Send each person theirs
 * PRIVATELY — never into the family group.
 *
 * They expire together, an hour after this runs by default. Raise it first if
 * that is too tight: Supabase -> Authentication -> Emails -> Email OTP
 * expiration. And run it when people are actually awake and holding a phone,
 * rather than sending five links into the night.
 */
import { loadEnv, asAdmin } from './lib/env.mjs'
import { EMAIL, usingRealAddresses } from './lib/people.mjs'

const siteArg = process.argv.indexOf('--site')
const SITE = siteArg > -1 ? process.argv[siteArg + 1] : null

if (!SITE) {
  console.error(
    '\nNeeds the address the app is served from:\n' +
    '  node scripts/invite-links.mjs --site https://samboza.pages.dev\n\n' +
    'It has to be a real, reachable URL, and it must be listed in Supabase\n' +
    'under Authentication -> URL Configuration -> Redirect URLs. If it is\n' +
    'not, the link quietly lands on the site root instead of the password\n' +
    'screen and the person is told nothing.\n')
  process.exit(1)
}
if (!usingRealAddresses) {
  console.error('\nscripts/people.local.json has no real addresses. A link sent to\n' +
                'name@samboza.family reaches nobody.\n')
  process.exit(1)
}

const admin = asAdmin(loadEnv())

console.log(`\n  Send each of these PRIVATELY to the person named. Not the group.\n` +
            `  Each one sets that person's password, once, within the hour.\n`)

let failed = 0
for (const [who, email] of Object.entries(EMAIL)) {
  const { data, error } = await admin.auth.admin.generateLink({
    type: 'recovery',
    email,
    options: { redirectTo: `${SITE.replace(/\/$/, '')}/reset` },
  })
  if (error) {
    console.log(`  ${who.padEnd(6)} FAILED  ${error.message}`)
    failed++
    continue
  }
  console.log(`  ${who.padEnd(6)} ${email}\n          ${data.properties.action_link}\n`)
}

console.log(
  '  Once everyone has used theirs, delete the "password" line from\n' +
  '  scripts/people.local.json. The check scripts will then stop being able\n' +
  '  to sign in as anybody, which is the point: nothing on this machine\n' +
  '  should hold five people\'s passwords.\n')

process.exitCode = failed ? 1 : 0
