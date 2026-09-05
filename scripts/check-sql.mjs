/**
 * Static checks over the SQL, needing no database at all.
 *
 * WHY THIS EXISTS. The pgTAP suite cannot run on this machine — it needs
 * Docker — so CI has been the first place it ever executes. Seven red runs on
 * main, seven failure emails, every one of them a mistake that was visible in
 * the file before it was pushed:
 *
 *   3 x  the test helpers were not granted to the role the tests run as
 *   1 x  a plan of 58 against 59 assertions
 *   2 x  assertions that read an account's whole balance as though nothing
 *        else in the suite had ever touched it
 *   1 x  a policy fix with no assertion behind it
 *
 * This catches the mechanical ones in under a second. It is not a substitute
 * for running the suite; it is the part of running the suite that does not
 * need a database.
 *
 *   node check-sql.mjs
 */
import { readFileSync, readdirSync } from 'node:fs'
import { execSync } from 'node:child_process'

const ROOT = new URL('../', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')
const TESTS = ROOT + 'supabase/tests/rls.test.sql'
const MIGRATIONS = ROOT + 'supabase/migrations/'

let problems = 0
const fail = (what, detail) => {
  problems++
  console.log(`  FAIL  ${what}\n        ${detail}`)
}
const pass = (what, detail = '') =>
  console.log(`  ok    ${what}${detail ? '\n        ' + detail : ''}`)

console.log('\n=== the SQL, before it costs anybody a red build ===\n')

const suite = readFileSync(TESTS, 'utf8')

/* 1 — the plan must equal the assertions ---------------------------------
   pgTAP counts what ran and compares it to what you promised. Promising 58
   and running 59 is a failed build even when all 59 pass, and rightly so: a
   suite that cannot count itself cannot promise it ran everything. */
{
  const planned = Number(suite.match(/select plan\((\d+)\);/)?.[1] ?? -1)
  const actual = (suite.match(/^select (is|isnt|ok|throws_ok|lives_ok|cmp_ok)\(/gm) ?? []).length
  planned === actual
    ? pass('the plan matches the assertions', `${actual}`)
    : fail('the plan does not match the assertions',
           `plan(${planned}) but ${actual} assertions — pgTAP will call this a bad plan`)
}

/* 2 — no assertion on the cash account's total balance --------------------
   Cash is touched by almost everything in the suite: three allowances, a
   handover, a settled loss, a remittance, a loan. An assertion that reads its
   whole balance only holds when it happens to run first, which is a fact
   about the test file's order rather than about the code. Assert the journal
   the thing under test actually posted. */
{
  const CASH = 'cccc0000-0000-4000-8000-000000000001'
  const bad = suite.split(/\n(?=select )/)
    .filter(s => /account_balances/.test(s) && s.includes(CASH))
  bad.length === 0
    ? pass('no assertion reads the whole cash balance')
    : fail(`${bad.length} assertion(s) read the whole cash balance`,
           bad.map(s => s.split('\n').pop().trim()).join(' | '))
}

/* 3 — every view is locked to the caller ---------------------------------
   The leak 0008 closed. CREATE OR REPLACE VIEW does not reliably carry
   reloptions forward either, so a view rebuilt in a later migration can lose
   it silently. The suite has a structural guard for this; catching it here
   means catching it before the guard has to. */
{
  const files = readdirSync(MIGRATIONS).filter(f => f.endsWith('.sql')).sort()
  const created = new Map()
  const secured = new Set()
  for (const f of files) {
    // Comments off first. These files explain themselves at length, and a
    // sentence about CREATE OR REPLACE VIEW is not a view.
    const sql = readFileSync(MIGRATIONS + f, 'utf8')
      .split('\n').map(l => l.replace(/--.*$/, '')).join('\n')
    for (const m of sql.matchAll(/create (?:or replace )?view\s+(\w+)/gi)) created.set(m[1], f)
    for (const m of sql.matchAll(/alter view\s+(\w+)\s+set\s*\(\s*security_invoker/gi)) secured.add(m[1])
  }
  const leaky = [...created.keys()].filter(v => !secured.has(v))
  leaky.length === 0
    ? pass('every view sets security_invoker', [...created.keys()].join(', '))
    : fail('a view can be read past its own policies', leaky.join(', '))
}

/* 4 — migrations are forward-only -----------------------------------------
   CI applies from scratch and the live database does not. An edited migration
   passes CI while production keeps the old definition, and the two drift with
   nothing to show for it. */
{
  let changed = []
  try {
    changed = execSync('git diff --name-only origin/main -- supabase/migrations',
                       { cwd: ROOT, encoding: 'utf8' })
      .split('\n').map(s => s.trim()).filter(Boolean)
  } catch {
    console.log('  skip  forward-only check (no origin/main to compare against)')
  }
  let applied = new Set()
  try {
    applied = new Set(
      execSync('git ls-tree --name-only origin/main supabase/migrations/',
               { cwd: ROOT, encoding: 'utf8' }).split('\n').map(s => s.trim()).filter(Boolean))
  } catch { /* a fresh clone or a shallow CI checkout has no origin/main */ }
  const edited = changed.filter(f => applied.has(f))
  edited.length === 0
    ? pass('no already-pushed migration was edited',
           changed.length ? `${changed.length} new: ${changed.map(f => f.split('/').pop()).join(', ')}` : 'none new')
    : fail('an already-pushed migration was edited', edited.join(', ') +
           ' — add a new numbered migration instead; CI applies from scratch and the live database does not')
}

/* 5 — a migration that changes a policy should change the suite -----------
   Not a rule that can be enforced mechanically, so this only asks the
   question when the answer is most likely to be "no". */
{
  let touched = ''
  try {
    touched = execSync('git diff --name-only origin/main', { cwd: ROOT, encoding: 'utf8' })
  } catch { /* nothing to compare */ }
  let policyChanged = false
  try {
    policyChanged = touched.split('\n').some(f => f.startsWith('supabase/migrations/')) &&
      execSync('git diff origin/main -- supabase/migrations', { cwd: ROOT, encoding: 'utf8' })
        .split('\n').some(l => /^\+.*(create policy|drop policy|security definer)/i.test(l))
  } catch { /* nothing to compare against */ }
  const suiteChanged = touched.includes('supabase/tests/rls.test.sql')
  !policyChanged || suiteChanged
    ? pass('policy and definer changes come with assertions')
    : fail('a policy or definer function changed with no change to the suite',
           'every RLS change needs an assertion that fails before it and passes after')
}

console.log(problems
  ? `\n  ${problems} problem(s). Fix these before pushing — CI failing is an email to the family.\n`
  : '\n  clean\n')
process.exit(problems ? 1 : 0)
