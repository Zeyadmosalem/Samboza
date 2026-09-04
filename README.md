# Samboza Family Finance

A private ledger for one family: trace, label and categorise every movement of
money — income, expenses, allowances, the Uber car, and loans. Ledger currency
is EGP.

The mother earns abroad and sends money home; Abdo accounts for it; the younger
members log what they spend. The point is that everyone gets a truthful picture
of where money comes from and where it goes, and the accountant stops keeping it
in his head.

This repository currently holds **a plan and a clickable demo**. There is no
production application yet.

---

## What's here

```
plan/    Family-Finance-App-Plan.md      the planning document — actors, money
                                         model, data model, phases, roadmap
         Family-Finance-App-Mockups.html the original five phone screens

demo/    index.html + 5 files            a clickable desktop demo of the app
```

## Running the demo

Open `demo/index.html` in any browser. That's the whole procedure — vanilla
HTML, CSS and JavaScript, no build step, no dependencies, no server.

Everything runs in memory. Anything added during a demo disappears on reload,
which is what you want between sessions.

### What to try

| | |
|---|---|
| **Sign in as different people** | The sign-in screen doubles as a role switcher. Abdo (admin) sees everything; Mother (viewer) gets a read-only banner and no write controls anywhere; Zeyad and Rewan (members) see only their own screens and their own numbers; **Uncle Joe (driver)** sees only the car. |
| **Record a Day, as Joe** | Sign in as Uncle Joe. He picks the date he drove, enters the takings, and adds each cost as **direct** (fuel, tolls) or **indirect** (administration, the kārta permit, a fine). The split recomputes as he types. This is the screen that makes the case for the app. |
| **Approvals, as Abdo** | Zeyad's and Rewan's submissions queue up with a badge on the nav. Nothing moves their balance until Abdo approves it. |
| **EN / ع** | Flips the whole app to Arabic with a full RTL layout. Time-axis charts stay left-to-right, which is the normal convention. |
| **Light / dark** | Defaults to the machine's setting, remembers an explicit choice. |
| **Settings** | The nine decisions from §10 of the plan, each with what was agreed — a record rather than a settings page. |

The demo is seeded with six months of plausible sample data for the real cast of
family members. The numbers are illustrative, not real.

---

## Identity: family and member IDs

Fully specified in [§2.4 of the plan](plan/Family-Finance-App-Plan.md). The
short version, because it shapes everything else:

Identifiers come in **two separate layers**.

**Internal — a UUID.** The primary key. Never shown, never typed, never re-used.
It survives a rename, a role change, or a beneficiary being promoted to a full
user, so history stays attached to the right person. This is what row-level
security keys on.

**Public — a short code.** What people read out and type.

| Identifier | Example | Scope | Lifetime |
|---|---|---|---|
| Family code | `SMBZ-7420` | Global | Permanent — the family's public identity |
| Member number | `03` | Unique within the family | Permanent once assigned, never re-issued |
| Member code | `SMBZ-7420·03` | Global | Derived, not stored |
| Invite code | `JOIN-8K2M` | Global while valid | Rotatable and expiring |

**The invite code is deliberately not the family code.** They look alike, and
using one value for both is tempting. They do different jobs: the family code
*identifies*, the invite code *grants access*. Were they the same, revoking a
leaked invite would mean changing the family's identity and invalidating every
code anyone had written down. Kept apart, an invite rotates freely while the
family code never moves.

Neither is a secret. The family code is an address, not a password — holding it
grants nothing. Access comes from authentication plus a `people` row.

**"Logging in as a family"** means: you authenticate as *yourself* (email or
phone OTP), your auth identity resolves to one or more `people` rows each
carrying a `family_id`, and you pick which family to open. That choice sets the
session's family context and RLS filters everything from there.

The indirection earns its keep. One person can belong to several families, and
one family holds people who cannot log in at all. Binding auth to the person
rather than the family handles both without a special case.

**Multi-family from day one.** Every table carries `family_id` and every RLS
policy is scoped to it, so the schema is multi-tenant while only one family uses
it. A second family needs no restructuring — a new row, a new code, an isolated
set of records.

---

## Where this is going

The plan's [§5](plan/Family-Finance-App-Plan.md) recommends Expo (React Native +
react-native-web) on Supabase — one codebase for iOS, Android and web, with
Postgres row-level security mapping cleanly onto the family/role permissions.

| Phase | Milestone |
|---|---|
| 0 — Setup | Repo, Expo project, Supabase schema + RLS, auth working |
| 1 — MVP | Record and see transactions, history and charts on phone and web — in English and Arabic from day one (D9) |
| 2 — Quality of life | Budgets, recurring entries, receipts, export |
| 3 — Transfers | Wallets and an internal double-entry ledger |

The demo is a conversation piece for agreeing Phase 1, not the beginning of the
codebase. Nothing in `demo/` is meant to survive into the real app.

## How the car works

Worth stating plainly, because it holds the most money and it **changed** during
planning.

Joe drives and **submits each day himself**, choosing the date — there are days
off, so the app never assumes today. Every cost he records is classified as he
enters it: **direct** (fuel, tolls — what it cost to earn that day's fares) or
**indirect** (administration, the kārta permit, a traffic fine).

```
net           = gross − direct − indirect
joe_share     = net × 1/3
remaining     = net − joe_share
family_income = remaining × 0.75
marwa_share   = remaining × 0.25
```

Both classes come off **before** Joe's third. The original draft took his third
off the gross first, which meant he carried none of the car's running costs; the
family reversed that. On a day taking EGP 840 with EGP 160 of fuel and an EGP 200
permit, Joe receives 160 rather than 280. The direct/indirect label is what the
family reports on — it does not change anyone's split.

## Status

Planning. The nine questions in §10 of the plan were **settled with the family on
4 September 2026**, and every answer is built into the demo. One question came out
of that conversation and is still open: what happens on a day where expenses
exceed the takings. The demo floors the net at zero; carrying the deficit forward
is the alternative, and it needs deciding before Phase 0 starts.
