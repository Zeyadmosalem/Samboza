/**
 * MOVE THE FIVE ACCOUNTS ONTO ADDRESSES PEOPLE CAN ACTUALLY RECEIVE MAIL AT.
 *
 * They were created as name@samboza.family — a domain nobody owns. That was
 * fine while the only person signing in was the one who made them, and it
 * stops being fine the moment anybody forgets a password: a reset link is
 * sent to an address that does not exist, so there is no recovery at all,
 * and §2 of the plan promises Abdo can trigger one for whoever needs it.
 *
 *   node scripts/set-emails.mjs            what it would do, changing nothing
 *   node scripts/set-emails.mjs --apply    do it
 *
 * email_confirm: true is deliberate. It marks the new address verified in the
 * same call, so no confirmation mail is sent — which matters because a free
 * Supabase project rate-limits its built-in mailer to a couple of messages an
 * hour, and five confirmations would take most of an afternoon and strand
 * anyone whose link expired first. Nobody is being verified here anyway: the
 * addresses came from the family directly.
 *
 * Idempotent. An account already on its real address is left alone, so a run
 * that fails halfway is simply run again.
 */
import { loadEnv, asAdmin } from './lib/env.mjs'
import { EMAIL, PLACEHOLDER, usingRealAddresses } from './lib/people.mjs'

const APPLY = process.argv.includes('--apply')

if (!usingRealAddresses) {
  console.error(
    '\nscripts/people.local.json has no addresses in it, so there is nothing to\n' +
    'move the accounts to. That file is gitignored and holds the real ones.\n')
  process.exit(1)
}

const admin = asAdmin(loadEnv())
const { data, error } = await admin.auth.admin.listUsers({ perPage: 200 })
if (error) { console.error(error.message); process.exit(1) }

const byEmail = new Map(data.users.map(u => [u.email.toLowerCase(), u]))
const taken = new Map(data.users.map(u => [u.email.toLowerCase(), u.id]))

console.log(APPLY ? '\nApplying:\n' : '\nDry run — nothing will be changed. Add --apply.\n')

let changed = 0, already = 0, failed = 0
for (const [who, target] of Object.entries(EMAIL)) {
  const from = PLACEHOLDER[who]
  const user = byEmail.get(from.toLowerCase()) ?? byEmail.get(target.toLowerCase())

  if (!user) {
    console.log(`  ??  ${who.padEnd(6)} no account found at ${from} or ${target}`)
    failed++
    continue
  }
  if (user.email.toLowerCase() === target.toLowerCase()) {
    console.log(`  ok  ${who.padEnd(6)} already ${target}`)
    already++
    continue
  }
  // Another account already holds the target address. Overwriting would make
  // two people the same login; stop and say so instead.
  const holder = taken.get(target.toLowerCase())
  if (holder && holder !== user.id) {
    console.log(`  !!  ${who.padEnd(6)} ${target} is already another account`)
    failed++
    continue
  }
  if (!APPLY) {
    console.log(`  ->  ${who.padEnd(6)} ${user.email}  ->  ${target}`)
    changed++
    continue
  }
  const { error: e } = await admin.auth.admin.updateUserById(user.id, {
    email: target,
    email_confirm: true,
  })
  if (e) { console.log(`  !!  ${who.padEnd(6)} ${e.message}`); failed++; continue }
  console.log(`  ->  ${who.padEnd(6)} ${user.email}  ->  ${target}`)
  changed++
}

console.log(
  `\n  ${changed} ${APPLY ? 'changed' : 'to change'} · ${already} already correct · ${failed} problem${failed === 1 ? '' : 's'}\n`)

if (!failed && APPLY) {
  console.log('  Passwords are untouched. Everyone still signs in with the shared one,\n' +
              '  at their new address, until each person sets their own.\n')
}
// Set the code rather than calling process.exit(): tearing the process down
// while the client still holds a handle aborts on Windows, which looks like a
// failure at the end of a run that worked.
process.exitCode = failed ? 1 : 0
