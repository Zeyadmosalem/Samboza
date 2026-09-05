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

**The full design is written: [Database-Design.md](Database-Design.md)** — every
table, constraint, trigger and RLS policy, in migration order. Build it exactly
as written before any application code exists.

The six decisions baked into that design, because retrofitting any of them is
painful:

| Decision | Why |
|---|---|
| **Double-entry** (`accounts` + `entries`) | "Joe is holding 1,725", the loan balance, cash-vs-bank and Phase 3 wallets are one missing concept — an account. Retrofitting means migrating live family money. |
| **Append-only** | A posted journal is never edited or deleted; a correction is a reversing journal. This is what makes Ghada's auditor role real rather than decorative. |
| **Money as `bigint` piastres** | Never float. Marwa absorbs the odd piastre, and a `check` constraint enforces that the parts sum to the net. |
| **`date` vs `timestamptz`** | "Which day he drove" and "when it was recorded" are different questions. |
| **Uniqueness in the database** | `(family_id, drive_date)`, `(recipient_id, period)`, `client_uuid`. Each blocked a way money was being counted twice. |
| **Rates by date** | `ORDER BY effective_from DESC LIMIT 1`, never row order. |

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
   person and source. Abdo's History shows all three stores in one feed — the
   family ledger, member submissions and car days — sliceable by person.
   Everything else is a special case of this. **DONE**, and three things worth
   recording from building it:

   - The admin's form and the member's form look similar and are not the same
     act. One calls `record_transaction` and posts a balanced journal
     immediately; the other writes a row to a sub-ledger that never touches the
     ledger at all, because the family already expensed the allowance when it
     was handed over. Counting the spending again would double-count it.
   - **A KPI must show a dash until its query returns, never a zero.** `sum([])`
     is 0, so a loading dashboard would say "Cash in hand: EGP 0" — a specific,
     wrong, believable claim about the family's money.
   - RLS denies by returning **no rows and no error**, so every screen has to
     treat "empty" as an answer. A member opening History sees an empty ledger
     and a note explaining it, not a failure — and the same emptiness must not
     be shown to a disconnected admin, which is why the loader distinguishes
     failed from empty.
2. **Allowances** — effective-dated rates, disbursement, per-person balances.
   **DONE.** Two things the schema had not settled, settled by building it:

   - **Which rate a month is paid at.** The first attempt asked for the rate in
     force on the 1st. The family's rates were set on the 4th of September, so
     September had no rate and paying it failed for six people who visibly had
     one on screen. The rule is now the rate in force at the END of the period:
     a rate set mid-month covers that month, a raise dated later does not, and
     paying March in June still pays March's rate. (0011)
   - **Pending is shown beside the balance, never inside it.** Subtracting a
     submission nobody has decided tells a member they have less than they
     have; ignoring it lets them spend the same money twice. Both numbers, or
     neither is honest.

3. **Member submissions + approvals** — pending until Abdo decides.
   **Approvals DONE**, brought forward because step 1 shipped the submitting
   half and left the queue with no way to be decided. *The notification is
   still outstanding* — without a nudge the queue silently rots and the
   members' balances are quietly wrong.
4. **The car** — Joe's daily submission, worked days *and recorded days off*,
   the direct/indirect class he chooses himself, the split (which may be
   negative), and **handovers**: Joe records days, Abdo confirms receipt when the
   cash is actually in his hand, covering whatever span it covers. Until then the
   money sits in `due_from_driver` and is not counted as cash. **DONE**, and it
   closed a hole the schema had carried since Phase 0:

   - **Nothing ever debited `due_from_driver`.** `confirm_handover` cleared a
     receivable that was never created, so the first handover drove it negative
     — the books said the family owed Joe the money he had just handed over —
     and "With the driver" read zero however many days he recorded. A day now
     posts `due_from_driver +family_egp / car_income −family_egp` the moment it
     is recorded, which is what makes D12's carry work: the balance IS the
     amount still owed. (0012)
   - **The client no longer computes the split.** A day was inserted directly
     with a net and three shares the app worked out, and `cd_net_is_derived`
     only ever compared the day's own columns to each other — so
     `direct_egp` could disagree with the costs itemised beside it.
     `record_car_day()` derives both from the same lines.
   - **A day is voided, never edited.** Joe will mistype one. The journal is
     reversed and the date freed, so the correction is on the record.
   - **Marwa's share was assumed to be settled by Joe. It is not** (D14): it
     comes through Abdo with the family's share and goes out with her monthly
     allowance. So a day posts three lines, not two, and her quarter is a
     liability rather than income. (0013)
   - **A loss is not shared** (D13, replacing D10). It is recorded in full and
     posts nothing; Abdo settles it as a family expense with a note. Which
     also removed the rounding hazard the whole system was carrying — PG and
     JS only ever disagreed on negative halves, and no share can be negative
     now. (0013)
   - **Adding a foreign key broke sign-in for everybody.** `families.car_share_person`
     is a second relationship between `people` and `families`, so PostgREST
     refused the auth query's embed as ambiguous rather than guessing. The
     RLS suite could never have caught it — it is PostgREST behaviour, not
     database behaviour — and the browser check did, on the first run.
     The embed now names its foreign key.
   - **Abdo is nudged at ten days** and told plainly at thirty. The Car screen
     asks for 60 days at most: a month of daily records is 30 rows, and
     fetching the whole table on every visit is how a free tier gets slow.
5. **Remittances** — multi-currency in, rate stored with the record. **DONE.**
   The EGP figure used to arrive from the client and nothing compared it to
   the amount and the rate beside it, so a row could say 1,000 SAR at 12.9
   came to EGP 900 and be believed. It is derived once, in SQL, from the two
   numbers that ARE the record. Ghada reads the screen and cannot write to it:
   D4 puts the rate in the accountant's hands, and it is stored with the row
   so it still explains itself a year later. A mistyped rate is voided and
   reversed, never edited. (0014)

   And the one nobody would have found by reading: **the database was on UTC
   and the family is not.** Between midnight and 3am Cairo time, recording
   today came back "that day has not happened yet" — Joe finishing a late
   shift, Abdo entering the shopping after everyone went to bed. The database
   now runs on Africa/Cairo, the family carries its timezone as data, and the
   app asks the family rather than the device, so Ghada's phone in Saudi
   cannot record a day the rest of them have not reached. (0015)
6. **Loans.** **DONE.** §3.5 asks for them "registered separately from
   ordinary income so the family can see what it owes" — separately in the
   REPORT, and not separately from the ledger. Borrowing 10,000 puts 10,000
   of real cash in Abdo's hand and a debt beside it, and a dashboard showing
   the cash without the debt overstates what the family has. Lending needed
   its own account: money out is an asset, and sharing `loan_liability` with
   it would net the two into a number meaning nothing. Repaying more than is
   outstanding is refused — an extra zero would leave the loan reading as
   though the family were owed money it never lent. Status and balance stay
   derived, as 0005 insisted. (0016)
7. **Reports** — the four charts. **DONE**, and drawn rather than imported:
   the plan chose Victory for React-Native compatibility, and Capacitor
   removed that constraint by shipping this same web bundle, so it is ~300
   lines of SVG instead of 200KB of someone else's opinions.

   - **The palette was wrong and the validator said so.** Gifts and Other both
     used `#8a9490` — one hue for two categories, and a hue with almost no
     chroma, sitting 3.5 ΔE from Medical under protanopia. A donut of the
     family's spending had two identical slices and a third that a red-green
     colourblind reader could not separate from them. The seven now pass every
     check in both modes.
   - **The donut caps at six.** Past six, neighbouring slices stop being
     tellable apart and no palette rescues it, so the tail folds into one and
     the table lists everything.
   - **The table view is obliged, not offered.** Three light-mode slots fall
     below 3:1 on white; that warning requires visible labels or a table.
   - **Looking at it caught the bug reading it never would.** The tick scale
     could stop below the largest value, so a tall bar was drawn with a
     negative y, climbed out of its card and sat on top of the subtitle.
8. **Offline + sync.** Client-generated UUIDs, and a submit that **reuses the
   same id on retry** — otherwise Joe on bad signal submits Tuesday twice.
   **DONE.** The ids were there from the first migration; this is what finally
   uses them for the thing they were for. Three parts, and each was necessary:

   - **An outbox.** A write that cannot go out is kept and retried. The
     distinction that makes it work rather than loop: a request that never
     arrived is worth retrying forever, and one the server *refused* is not —
     "that month has already been paid" will be refused identically at every
     future attempt, so it is surfaced instead.
   - **An offline shell**, its precache list generated from the real bundle at
     build time. A hardcoded list rots on the next build and a stale worker
     serves a bundle that no longer exists, silently, and only for the people
     who already had the app open.
   - **A remembered identity.** Without it the app opened offline, showed
     "Loading…" for ten seconds while getSession retried a token refresh that
     could not succeed, and then said the server could not check the account.
     Joe never reached the form. The wait is now bounded by TIME rather than
     by `navigator.onLine`, because a phone on wifi with no route out reports
     itself online.

   Proved by driving Chrome genuinely offline: record a day, nothing reaches
   the database, it waits in the outbox, the signal returns, it sends itself
   exactly once, the queue empties, and a reload with no connection still
   opens the app — saying it is showing what the phone last knew.

**Checkpoint after each:** the family uses it for a week on real numbers before
you build the next one.

### The checks, and their expiry date

`app/` has no test framework and is not getting one for two smoke tests. What it
has instead is three scripts in `scripts/`, run against the live project:

```
npm run check:guards     the security invariants — what 0008 and 0009 fixed
npm run check:screens    every query each screen makes, as each real person
npm run check:browser    the screens in a real browser; records money and reads
                         it back  (needs: cd app && npm run build && npm run preview)
```

`check:guards` exists because `supabase test db` needs Docker and Docker is
often not there. The pgTAP suite in CI is the real gate; this asks the same
questions of the deployed database.

**They refuse to run once the ledger has anything in it.** They seed and delete
rows, and a cleanup that deletes by memo would take a real row with the same
memo. The moment the family starts recording, these scripts stop working — which
is correct, and not something to work around. Point them at a scratch project or
delete them.

---

## The visual pass — glass (week 6, after the screens exist)

Deliberately **after** the money works. A restyle applied to a half-finished
screen set gets done twice.

The look is Apple's frosted-glass idiom: translucent surfaces that pick up what
is behind them, thin bright borders, deep soft shadows, generous rounding.

**The technique.** A glass surface is four things together, and it fails if any
one is missing:

```css
.glass {
  background: rgba(255,255,255,.62);          /* translucent, not solid */
  backdrop-filter: blur(24px) saturate(180%); /* what actually makes it glass */
  -webkit-backdrop-filter: blur(24px) saturate(180%);
  border: 1px solid rgba(255,255,255,.7);     /* the bright top edge */
  box-shadow: 0 8px 32px rgba(0,0,0,.12);
  border-radius: 22px;
}
```

Dark mode is **not** these values inverted: use `rgba(28,30,32,.66)` with a
`rgba(255,255,255,.10)` border. Glass over a dark ground needs a dimmer fill and
a much fainter edge, or it reads as plastic.

**Five things that will bite:**

1. **Glass needs something behind it.** On a flat background it is just a grey
   box. Put a soft colour wash or gradient on the page ground first, then float
   the panels over it. Skip this and the whole effect is wasted.
2. **`backdrop-filter` is expensive.** Every blurred surface is its own
   compositor layer. Use it on chrome — sidebar, topbar, modals, hero cards —
   and never on every row of a 500-row history. Frames will drop on a
   mid-range Android.
3. **Contrast still applies.** Text on a translucent surface must clear 4.5:1
   against the *worst* thing that can pass behind it. Keep the token system and
   re-run the contrast audit; do not eyeball it.
4. **Firefox and older WebViews.** Ship an `@supports (backdrop-filter: blur(1px))`
   guard with an opaque fallback, and never let the fallback be unreadable.
5. **Keep the tokens.** The palette, the validated chart hues and the RTL logical
   properties all survive. Glass changes surfaces and borders, not the colour
   system.

Apply to: sidebar, topbar, cards, sign-in panel, modals, the mobile tab bar.
Leave table and list rows opaque — they are the dense parts.

**Checkpoint:** contrast audit green in both themes and both languages, and
History scrolling at 60fps on a real phone.

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

## Phase 4 — Import the record (week 8)

**After the app is live and running, before the phones.** That order is
deliberate:

- **After go-live**, because the import must land in the schema people are
  actually using, with the constraints switched on. Importing into a schema
  still being changed means importing twice.
- **Before the phones**, because the family should be looking at their real
  history when they first open it on a handset. An app full of their own past
  is a different thing from an empty one.

The record is an Excel sheet — the thing that prompted this project. It is not
retyped; it is imported by a script in the repo, re-runnable, idempotent
through `client_uuid` so a half-finished run can simply be run again.

1. **Read the sheet and map it.** Its columns to categories, its people to
   `people` rows, its dates to real dates. Written down before any code, because
   the mapping is where the judgement is.
2. **Pick a cut-over date.** Set an **opening balance** at it rather than
   back-filling years. Import roughly 6–12 months behind it — enough for the
   charts to show something true, not so much that you are reconciling 2023.
3. **Dry run.** The importer reports what it *would* write and every row it
   would reject, changing nothing.
4. **Fix the sheet, not the importer.** Every rejection is a real error in the
   record: a journal that does not balance, the same car day twice, a month's
   allowance paid twice, a date that will not parse.
5. **Import, then reconcile.** The closing balance must equal the sheet's, to
   the piastre. If it does not, stop — do not adjust it to fit.

> Importing into a constrained double-entry schema is the best audit that
> spreadsheet will ever get. It will find things. That is the point, and it is
> the reason this is its own phase rather than a footnote to go-live.

Everything before the cut-over enters as **journals only** — the money
movements. No historical row becomes a `car_day`, an `allowance` or a
`member_expense`. Those tables then only ever hold rows produced by the current
rules, and nothing old has to satisfy a constraint that post-dates it.

Note there is no restatement problem: the car has always been split the way it
is split now, so the sheet's figures stand as they are.

---

## Phase 5 — Phones (next sprint)

Capacitor wraps the web app that is already live. The UI is not rewritten.

```bash
npm install @capacitor/core @capacitor/cli
npx cap init && npx cap add ios && npx cap add android
```

- A PWA first: it installs to the home screen on both platforms and costs
  nothing. Only go to the stores if something actually requires it —
  Google Play $25 once, Apple $99/year.
- Test the glass on a real mid-range Android before shipping. `backdrop-filter`
  is where the frames go.

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

## Decisions made once the demo made them concrete

Both earlier questions are settled and built:

- **A losing day goes negative**, shared in the same ratios as a profit — the
  driver a third, the family three quarters of the rest, Marwa a quarter. Not
  floored, because the ledger runs over time: a bad Tuesday nets off against a
  good Wednesday.
- **Handovers are irregular by design.** Joe hands over when it suits him; the
  app records and tracks rather than assuming a rhythm, and Abdo confirms
  receipt.

- **A handover shortfall is carried, not written off.** If the computed share is
  1,725 and Joe hands over 1,700, he still owes the 25 and it is added to his
  next handover. In the double-entry model this is free: the balance of
  `due_from_driver` *is* the carried amount.
- **Grandma stays "Grandma".** It is what the family calls her, so it is her
  display name. `relationship` still records `grandmother` for Arabic.

Nothing is open. Everything needed to start Phase 0 is decided.
