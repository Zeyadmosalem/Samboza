/**
 * THE FIVE SIGN-INS, IN ONE PLACE.
 *
 * They used to be typed into six scripts, which meant changing an address
 * meant changing it six times and finding out you had missed one when a
 * check failed to sign in.
 *
 * The real addresses are not in this repository. Four of them belong to other
 * people, and a private repo is one "make public" click and one fork away
 * from not being private — so they live in scripts/people.local.json, which
 * is gitignored, beside the .env that already has to be there. Without that
 * file these fall back to the placeholders a fresh bootstrap creates, which
 * is exactly what a new clone or a scratch project wants.
 */
import { readFileSync } from 'node:fs'

const ROOT = new URL('../../', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')

/** What bootstrap.mjs creates on an empty project. Nobody can receive mail here. */
export const PLACEHOLDER = {
  ghada: 'ghada@samboza.family',
  abdo:  'abdo@samboza.family',
  zeyad: 'zeyad@samboza.family',
  rewan: 'rewan@samboza.family',
  joe:   'joe@samboza.family',
}

let local = {}
try {
  local = JSON.parse(readFileSync(ROOT + 'scripts/people.local.json', 'utf8'))
} catch { /* no local file: placeholders, which is a valid state */ }

export const EMAIL = { ...PLACEHOLDER, ...(local.emails ?? {}) }

/**
 * The shared password, until each person sets their own.
 *
 * When they do, these scripts stop being able to sign in as anybody — which
 * is the correct end of them, the same way an empty ledger is. Nothing should
 * hold five people's passwords, least of all a file in a working directory.
 */
export const PASSWORD = local.password ?? 'Samboza2026!'

export const usingRealAddresses = Object.keys(local.emails ?? {}).length > 0
