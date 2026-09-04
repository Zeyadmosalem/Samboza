# Implementation Plan — Samboza Family Finance

From minute one to production and maintenance. Web app first, native next
sprint. **Hosted entirely on free tiers, no card required at any point.**

> Free-tier terms change. Everything here was accurate as of writing; verify
> each provider's current limits before you rely on them.

---

## The free stack, and why

| Layer | Choice | Free tier | Card? |
|---|---|---|---|
| Repo + CI | **GitHub** | Unlimited private repos; 2,000 Actions min/month | No |
| Hosting | **Cloudflare Pages** | Unlimited bandwidth, 500 builds/month | No |
| Database, Auth, Realtime | **Supabase** | 500 MB Postgres, 50k monthly active users, RLS, Storage | No |
| Error tracking | **Sentry** | 5k errors/month | No |
| Uptime + keepalive | **GitHub Actions cron** | Included above | No |
| Mobile (next sprint) | **PWA first**, then Capacitor | £0 until you want app stores | No |

**Total: EGP 0/month.** The only money that ever appears is if you decide to
publish to the app stores — Google Play $25 one-time, Apple $99/year. A PWA
installs to the home screen on both platforms and costs nothing, so treat the
stores as optional, later, and only if you actually need them.

### The one free-tier trap

**Supabase pauses a free project after ~7 days with no activity.** A family app
goes quiet — a week in Ramadan, a holiday — and the database sleeps. Waking it
is a click, but the app is down until someone notices.

Fix it on day one with a scheduled GitHub Action that pings the database weekly.
It costs nothing and it is three lines of YAML. Do not skip this and then be
surprised in November.

### Recommendation that changes the existing plan

The plan currently specifies **Expo + react-native-web**. Given you are building
a polished web app *now* and going native *next sprint*, I would use
**Vite + React for the web, then wrap it with Capacitor** for iOS and Android.

- **Capacitor** ships the same web app inside a native shell. The UI you build
  this sprint is the UI that ships on phones. Nothing is rewritten.
- **Expo** would mean rebuilding every screen in React Native primitives.
  `react-native-web` gets you a web build, but a glass-heavy design fights the
  RN styling model — no `backdrop-filter`, no CSS gradients as you'd write them.

Expo is the better choice *if* the app must eventually feel fully native
(gestures, native navigation, deep OS integration). For a family ledger that is
mostly forms, lists and charts, Capacitor gets you to phones for a fraction of
the work. **Decide this before you write a screen** — it is expensive to change
after.

---

## Phase 0 — Foundations (week 1)

Nothing user-facing ships this week. This is the week that decides whether the
next three months are pleasant.

### Day 1 — accounts and skeleton

1. Create the GitHub repo (this one), Supabase project, Cloudflare Pages project.
2. Connect Pages to the repo — every push to `main` deploys. Verify a hello-world
   deploy reaches a URL before writing any real code.
3. Add the Supabase keepalive cron.
4. `npm create vite@latest` — React + TypeScript. ESLint + Prettier.

**Checkpoint:** a blank page is live on the internet, auto-deploying from `main`.

### Days 2–3 — the schema

Write it as migration files from the first line, never by clicking in the
Supabase dashboard. The dashboard is for looking, not for changing.

Resolve these before the first migration, because retrofitting them is painful:

| Decision | Do this |
|---|---|
| **Double-entry** | `accounts` + `entries`, not `transactions(type, amount)`. Receivables ("Joe owes 347"), loans, cash-vs-bank and Phase 3 wallets are then all one mechanism. Retrofitting later means migrating live family money. |
| **Append-only** | Never `UPDATE` or `DELETE` a posted row. A correction is a reversing entry. This is what makes Ghada's auditor role real rather than decorative. |
| **Money** | `bigint` piastres, or `numeric(12,2)`. Never float. Write down that Marwa absorbs the odd piastre. |
| **Dates** | `date` for "which day he drove". `timestamptz` for "when it was recorded". They are different questions. |
| **Uniqueness** | `UNIQUE(family_id, drive_date)` on car days. `UNIQUE(recipient_id, period)` on allowances. Both are currently missing and both let money be counted twice. |
| **Rates by date** | Allowance rate = `ORDER BY effective_from DESC LIMIT 1`, never row order. |

### Days 4–5 — RLS, written and tested

This is the highest-consequence work in the project. Zeyad seeing Rewan's
spending is a family argument, not a bug report.

Write a policy per table per role, then write **tests that assert the denials**:

```
as Zeyad   → cannot read Rewan's member_expenses      MUST FAIL
as Zeyad   → cannot read family entries               MUST FAIL
as Joe     → can read own car_days                    MUST PASS
as Joe     → cannot read entries / allowances         MUST FAIL
as Ghada   → can read everything                      MUST PASS
as Ghada   → cannot insert or update anything         MUST FAIL
as Abdo    → can do everything, in his family only    MUST PASS
cross-family read of any table                        MUST FAIL
```

Run them in CI on every push. A permissions regression must break the build.

**Checkpoint:** the schema is deployed, the RLS suite is green, and you have
tried and failed to read someone else's data.

---

## Phase 1 — Auth and the shell (week 2)

Build the auth *model* before the login screen, or the screen is a lie.

- Supabase Auth, email + password, with phone OTP as the fallback for whoever
  finds email annoying.
- `auth.users.id` → `people.auth_user_id`. One human, one auth identity, one or
  more `people` rows across families.
- Session: what happens when someone is deactivated mid-session? Answer it now.
  A revoked person must lose access on their next request, not at token expiry.
- Recovery for someone like Grandma who will forget: Abdo can trigger a reset
  link; he can never see or set a password.
- Family context: sign in as yourself, then pick which family. One selector,
  stored per session.

Then the app shell: routing, the language switch, the theme switch, the
navigation that changes by role.

**Checkpoint:** five real people sign in with real credentials on real devices,
each sees their own navigation, and nobody can reach anyone else's screens.

---

## Phase 2 — The money (weeks 3–6)

Build in this order. Each step is demoable to the family on its own.

1. **Ledger + History** — record income and expense, see them listed, filter by
   person and source. Everything else is a special case of this.
2. **Allowances** — effective-dated rates, disbursement, per-person balances.
3. **Member submissions + approvals** — pending until Abdo decides.
   *Ship the notification with it.* Without a nudge the queue silently rots and
   the members' balances are quietly wrong.
4. **The car** — Joe's daily submission, worked days and days off, the
   direct/indirect classification, the split, settlement.
5. **Remittances** — multi-currency in, rate stored with the record.
6. **Loans.**
7. **Reports** — the four charts.
8. **Offline + sync.** Client-generated UUIDs, and a submit that **reuses the
   same id on retry** — otherwise Joe on bad signal submits Tuesday twice.

**Checkpoint after each:** the family uses it for a week on real numbers before
you build the next one.

---

## Phase 3 — Go live (week 7)

- Import real history. Set an **opening balance** at a chosen date rather than
  back-entering years; the ledger starts clean from a known number.
- Run old method and app side by side for one month. They must agree to the
  piastre before you retire the old method.
- PWA manifest, icons, offline shell. Everyone installs it to their home screen.
- Sentry connected, uptime check running.
- Back up: a scheduled Action dumps the database to a private repo or Storage,
  weekly. **Test a restore before you need one.**

**Definition of done:** two people on separate devices record transactions and
both see the same dashboard within seconds; it works offline for entry; and a
month of parallel running reconciled exactly.

---

## Maintenance

| Cadence | Task |
|---|---|
| Weekly | Automated backup runs. Check it actually produced a file. |
| Weekly | Supabase keepalive ping (automated — check it is still green). |
| Monthly | Period close: freeze the month, record the closing balance. |
| Monthly | Review Sentry. Fix what real people actually hit. |
| Quarterly | Restore a backup into a scratch project. An untested backup is not a backup. |
| Quarterly | Re-run the RLS suite against production schema. |
| Yearly | Dependency upgrades. Check free-tier terms have not changed. |

**Watch the free-tier ceilings:** 500 MB of Postgres is enormous for one family
— a decade of daily car records is a few MB. You will not approach the limits.
If you ever onboard many families, that changes, and Supabase Pro is $25/month.

---

## What to do first, in order

1. Decide **Capacitor or Expo**. It shapes every screen you write.
2. Decide **double-entry or not**. It shapes every row you store.
3. Create the three accounts, wire the auto-deploy, ship a blank page.
4. Add the keepalive cron.
5. Write the schema as migrations.
6. Write the RLS tests, and watch them fail before you make them pass.

Steps 1 and 2 have a closing window. Everything else can be reordered.

---

## Still open

- **A day where car costs exceed takings.** The demo now records the shortfall
  rather than flooring it silently, but nobody has decided *who absorbs it* —
  the family, or Joe's next day. Needs an answer before the car module ships.
- **Does Joe hand over cash daily, or does it accumulate?** If it accumulates,
  settlement must split into "I agree with the numbers" and "I have the money",
  and cash on hand must stop counting money still in his pocket.
