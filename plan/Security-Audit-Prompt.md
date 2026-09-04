# Security audit prompt — Samboza Family Finance

Paste this to start an audit. It is the generic two-pass audit prompt, rebuilt
around what this project actually is.

> **Why it needed rewriting.** The generic prompt assumes a server you control:
> routes, middleware, an auth check you can grep for. This app has no such
> server. Supabase exposes the tables directly over PostgREST, and **row-level
> security is the entire authorization layer**. "Is there an auth check on this
> route?" is the wrong question. "Does this table have a policy, and does the
> policy say what I think it says?" is the right one.
>
> It also has an inverted testing profile: **no frontend tests at all**, and 34
> assertions covering the security-critical layer. An auditor must not assume
> the usual shape.

---

## Step 0 — Preflight

State the stack and the exact commands. For this repo they are:

```
app/        Vite + React 18 + TypeScript, npm
            npm ci && npm run typecheck && npm run build
supabase/   Postgres migrations + pgTAP
            supabase db push          (applies to the live project)
            supabase test db          (NEEDS DOCKER — usually unavailable locally)
scripts/    Node ESM, service_role admin scripts
.github/    CI: applies migrations from scratch, runs the RLS suite
```

- **The RLS suite is the real test suite.** It cannot run locally without
  Docker. Check CI instead: `gh run list --limit 5`. Treat a red run as a
  failing baseline and say so.
- **There are no frontend tests.** Do not call any UI change "safe" or
  "functionally equivalent". Mark risky changes risky.
- Stop if the working tree is dirty.

**Scope.** In: `app/src/**`, `supabase/migrations/**`, `supabase/tests/**`,
`scripts/**`, `.github/workflows/**`, `.gitignore`, `*.env.example`.
Out: `node_modules`, lockfiles, `dist/`, and **`demo/`** — that is a throwaway
prototype, explicitly not shipping, and auditing it wastes the pass.

---

## Step 0b — Inventory

The map is mostly known; verify it rather than rebuild it.

| Area | What it is | Trust boundary |
|---|---|---|
| `app/src/lib/supabase.ts` | Client, anon key | Holds the public key — see false positives |
| `app/src/lib/auth.tsx` | Session, person/family resolution | **Reads `people` to decide role** |
| `app/src/components/Shell.tsx` | Role-based navigation | **Cosmetic only** — never a control |
| `supabase/migrations/0006_rls.sql` | Every policy | **The actual authorization layer** |
| `supabase/migrations/000{2,3,4,7}` | `SECURITY DEFINER` functions | **Privilege escalation surface** |
| `scripts/*.mjs` | Admin scripts | **Hold `service_role` — bypass everything** |
| `.github/workflows/*.yml` | CI | Secret handling |

**Where untrusted input enters:** every PostgREST request. Any signed-in family
member can call any table endpoint and any `rpc()` directly with their own
token — curl, devtools, a modified client. **Assume they do.** The UI is not a
boundary.

---

## Pass 1 — Two sweeps, then fuse

### Sweep A — patterns, adapted to this stack

Generic ones still apply (`eval`, `innerHTML`, `child_process`, string-built
SQL, `console.log` near tokens). These matter more here:

- `service_role` or `SERVICE_ROLE` anywhere under `app/` — **critical**, that
  key bypasses every policy and must never reach a browser bundle.
- `create view` / `create or replace view` **without** `security_invoker` —
  see the known bug class below.
- `security definer` functions that never call `my_role()` or `my_person()` —
  a definer function runs as owner and skips RLS by design.
- `using (true)` or `with check (true)` in any policy.
- A table created in a migration with no matching `enable row level security`.
- `.rpc(` calls from the client — each is a callable endpoint; check the
  function guards its own arguments rather than trusting the caller.
- `localStorage.setItem` — sessions live there legitimately; anything else
  wants justification.
- Hardcoded passwords in `scripts/` (there is a known one, see below).

### Sweep B — reachability, expressed as RLS

For **every table and every view**, answer:

1. Is RLS enabled?
2. Is there a policy for each of select / insert / update / delete that this
   app performs? *(With RLS on, no policy = denied. That is a safe default and
   often intentional — confirm which.)*
3. Does the policy scope to `family_id`, so another family cannot read it?
4. Does it scope to the **person** where it should — a member's own
   submissions, the driver's own days, an owner's own personal book?
5. **If it is a view: is `security_invoker` on?**

For every `SECURITY DEFINER` function:

6. Does it check `my_role()` before doing privileged work? It bypasses RLS, so
   its own check is the only check.
7. Can its arguments be abused — passing another family's `family_id`, another
   person's id, a negative amount, a future date?

### Fusing

Both sweeps agreeing ranks highest. But note the asymmetry here: **Sweep B is
the one that finds the real bugs in this codebase.** A missing policy and a
leaking view have no pattern to grep for. Do not down-rank a Sweep-B-only
finding because grep did not corroborate it.

### Confirmation — query as the role

Do not confirm by reading policies. **Sign in as the role and query.**

```js
const c = createClient(url, ANON_KEY)
await c.auth.signInWithPassword({ email: 'joe@samboza.family', password })
await c.from('entries').select('id')          // expect 0
await c.from('ledger_feed').select('id')      // expect 0
```

Roles: `abdo` admin, `ghada` viewer, `zeyad`/`rewan` member, `joe` driver.

A finding is confirmed when a role that should see nothing sees something.
Reading a policy and concluding it is fine is exactly how the view leak
shipped.

---

## Known bug class — check this first, every time

**Postgres views default to `security_invoker = off`**, so they execute as the
view's *owner* and skip RLS on the underlying tables entirely.

This has already happened once here: `ledger_feed` and `account_balances`
served the whole family ledger to the driver and to members, while the
`entries` table correctly refused them. The policies were right. The view went
around them.

There is now a structural assertion in the suite that fails the build if any
view in `public` lacks it. **Verify that guard still exists and still passes** —
and if a new view has been added, confirm it empirically, not by reading.

---

## Do not report these — they are correct by design

Flagging any of these as findings wastes the pass:

| Looks like | Actually |
|---|---|
| `VITE_SUPABASE_ANON_KEY` in the client bundle | **Correct and required.** The anon key is public by design. RLS protects the data, not the key. |
| Income accounts hold negative balances | Correct double-entry — income is credit-normal. |
| `journals` / `entries` have no UPDATE or DELETE policy | Deliberate. History is append-only; a correction is a reversing journal. |
| `revoke update, delete` rather than a rewrite rule | Deliberate — a rule would swallow FK cascades. See 0002. |
| Money as `bigint` piastres | Deliberate. Never float. |
| Nav hides screens by role | A courtesy. The database refuses. Not a control, and not a finding. |
| `demo/` uses `innerHTML` everywhere | Out of scope. Throwaway prototype. |

## Already known and tracked — do not re-report as discoveries

- All five accounts share the temporary password `Samboza2026!` from bootstrap.
  Tracked; must be changed before real money. Report only if still true **and**
  the app is live.
- Emails are placeholders (`name@samboza.family`).
- Session time-box is set client-side; the dashboard setting
  (Authentication → Sessions → 168h) may still be pending.
- `SUPABASE_URL` / `SUPABASE_ANON_KEY` GitHub secrets may still be unset —
  that breaks the keepalive workflow, not security.

**Do check, because these would be real:** that `.env` has never been
committed (`git log --all --full-history -- .env`), and that no `service_role`
key appears anywhere in history or under `app/`.

---

## Severity, calibrated to this app

This is a family ledger, not a bank. Calibrate accordingly:

- **Critical** — one family member can read or alter another's money; any
  cross-family leak; `service_role` reachable from the client; secrets in git
  history.
- **High** — a role sees data it should not (the view leak was here); a
  `SECURITY DEFINER` function missing its role check; money can be recorded
  that violates a documented decision (D1–D12).
- **Medium** — missing validation caught later by a constraint; unhandled
  errors that lose a write silently; a missing index on a growing table.
- **Low** — cosmetic, DX, style.

**Not a finding:** anything whose only impact is that a family member sees a
number they are allowed to see anyway.

---

## Report format

Sections, IDs and effort estimates as in the generic prompt (`S1`, `D1`, `R1`…).
Two changes:

- Add a **§0 RLS coverage table** before everything else: every table and view,
  RLS on/off, which policies exist, and the empirical result per role. That
  table is the audit; the rest is commentary.
- Cut the tail. Most grep hits here are noise because the interesting failures
  are absences. If a section is empty, write "no findings".

End with: *"Reply with the IDs to fix."* Then stop.

---

## Pass 2 — fixes

As the generic prompt, with three additions:

1. **Every RLS change needs a matching assertion** in
   `supabase/tests/rls.test.sql` — and the assertion must **fail before** the
   fix and pass after. Show both. A policy fix with no test is not finished.
2. **Migrations are forward-only.** Never edit an applied migration; add a new
   numbered one. CI applies from scratch, so an edited migration passes CI and
   diverges from the live database.
3. After any migration: `supabase db push`, then push and confirm CI is green
   (`gh run list`). The suite is the gate.

Do not touch the money rules (D1–D12 in the plan) without asking. They are
family decisions, not implementation details.
