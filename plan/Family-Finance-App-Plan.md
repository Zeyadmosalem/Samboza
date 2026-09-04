# Family Finance App — Planning Document

**Working name:** Samboza Family Finance
**Date:** September 2026
**Scope:** Trace, label and categorise every movement of family money — income, expenses, allowances, the Uber car, and loans. Ledger currency EGP. No investments. Money transfer between members planned as a later phase.

---

## 1. Vision

A private ledger for one family. The mother earns abroad and sends money home; Abdo accounts for it; the younger members log what they spend. Everyone gets a truthful picture of where money comes from and where it goes, and the accountant stops keeping it in his head.

## 2. Actors

### 2.1 System users (people who log in)

| Person | Role in family | App role | Permissions |
|---|---|---|---|
| **Ghada** (mother) | Breadwinner — works abroad, main income source | **Viewer / Auditor** | Read-only. Full visibility of all income, expenses, allowances, loans, car ledger and reports. Cannot add or edit. |
| **Abdo** (big brother) | Accountant | **Admin** | Full access. Records and edits every transaction, manages categories, disburses allowances, registers loans, runs the car settlement, sets FX rates, approves member submissions. |
| **Zeyad** (son) | Allowance recipient | **Member** | Submits his own expenses against his allowance; sees his own balance, history and spending-habit charts. No access to other members' detail. |
| **Rewan** (daughter) | Allowance recipient | **Member** | Same as Zeyad. |
| **Joe** | Maternal uncle — drives the family car for Uber | **Driver** | Submits each day he drives: the takings and what they cost. Sees his own days and his own earnings, and nothing of the family ledger. Cannot see or touch anyone else's money. |
| *(future)* | — | any role | The role model must stay open: new members can be added without schema change. |

### 2.2 Non-user actors (appear in records, do not log in — for now)

| Actor | Relationship | Appears as |
|---|---|---|
| **Mona** | Aunt | Allowance recipient |
| **Grandma** | Grandmother | Allowance recipient |
| **Marwa** | Aunt | Allowance recipient **and** 25% share of car profit |
| **Loaner** | External lender (name recorded per loan) | Loan counterparty |

> Design rule: every actor is a `person` record. Whether they can log in is a separate flag. That way a beneficiary (Grandma, Mona) can be promoted to a user later without rewriting history.

### 2.3 Actor properties

`id` (uuid), `family_id`, `member_no`, `display_name`, `relationship` (mother/brother/son/daughter/aunt/grandmother/cousins/uncle_maternal/external), `is_user` (can log in), `auth_user_id`, `role` (admin | member | viewer | driver), `is_allowance_recipient`, `active`, `joined_at`.

> **Relationship is not cosmetic.** Joe is the mother's brother, so he is a *maternal* uncle — `الخال` in Arabic, not `العم`. Mona and Marwa are maternal aunts (`الخالة`) for the same reason. Arabic has no single word for "uncle", so the field has to carry which side of the family a person is on; a generic value would produce wrong Arabic on every screen.

> **The allowance amount is not a column on `people`.** It moves over time (§3.3), so it lives in its own effective-dated table.

### 2.4 Identity: family and member IDs

Every family and every actor carries an identifier, in **two deliberately separate layers**.

**Internal — `uuid`.** The primary key of the row. Generated on creation, never shown, never typed, never re-used. It survives a rename, a role change, or a beneficiary being promoted to a full user, so history stays attached to the right person no matter what else changes about them. This is the column row-level security keys on.

**Public — a short code.** What people actually read out, write on a piece of paper, and type into a phone.

| Identifier | Example | Scope | Lifetime |
|---|---|---|---|
| **Family code** | `SMBZ-7420` | Global | Permanent. The family's public identity. |
| **Member number** | `03` | Unique within the family | Permanent once assigned; never re-issued, even if that person leaves. |
| **Member code** | `SMBZ-7420·03` | Global | Derived (family code + member number), not stored. |
| **Invite code** | `JOIN-8K2M` | Global while valid | Rotatable and expiring. |

**Why the invite code is not the family code.** They look alike and it is tempting to use one value for both. They must stay separate because they do different jobs: the family code *identifies*, the invite code *grants access*. If they were one value, revoking a leaked invite would mean changing the family's identity — invalidating every code anyone had already written down. Keeping them apart means an invite can be rotated or expired freely, as often as you like, while the family code never moves.

Neither code is a secret. The family code is an address, not a password; possession of it grants nothing. Access comes from authentication plus a `people` row, never from knowing a code.

**Logging in as a family.** Authentication is per-person; the family is the *context* you then work in:

1. The person signs in as themselves — email or phone OTP.
2. Their `auth_user_id` resolves to one or more `people` rows, each carrying a `family_id`.
3. If they belong to more than one family, they choose which to open. That choice sets the family context for the session.
4. Everything from then on is filtered by that `family_id` through RLS.

The indirection matters: one human can belong to several families (Marwa receives from this family and may keep her own), and one family holds people who cannot log in at all. Tying auth to the person rather than the family keeps both cases working without a special case.

**Multi-family from day one.** Every table already carries `family_id` (§6) and every RLS policy is scoped to it, so the schema is multi-tenant while only one family is using it. A second family signing up needs no restructuring: a new family row, a new code, and a fully isolated set of records.

## 3. Money Model

Everything in the system is a **traced, labelled, categorised movement of money**. Each movement records: amount, currency, EGP value, direction (in/out), category, actor(s) involved, date, and an optional free-text description. Nothing is entered without a category and an owner.

### 3.1 Income sources

| Source | Description | Properties |
|---|---|---|
| **Breadwinner remittance** | The mother hands over a lump sum, typically **when she visits home** — so it arrives irregularly, in large amounts, and must last until the next visit. | amount, original currency (EGP/SAR/USD), FX rate used, EGP value, received_on, visit reference, note |
| **Car profit share** | 75% of the net profit of the Uber car (see §3.4). | period, computed amount (EGP), link to car settlement |
| **Loan received** | Money borrowed from a named lender (see §3.5). | lender name, amount, date, optional description |

> Because income is lumpy and tied to visits, the dashboard should show **"cash on hand" and "days since last remittance"**, not just a monthly total.

### 3.2 Expense categories

Default set, extendable by Abdo:

- **Rent** — recurring, fixed
- **Food** — recurring, variable
- **Allowance** — disbursements to recipients (see §3.3)
- **Gifts** — occasional / irregular, should be flagged as non-recurring so it doesn't distort trend charts
- **Educational fees** — school/university, seasonal
- **Prescriptions / medical** — pharmacy and treatment
- **Car expenses** — fuel, maintenance, licensing (settled inside the car module, §3.4)
- **Other** — catch-all, requires a description

Each expense carries: amount, category, sub-label/tag (free tagging on top of the category), date, paid_by, on_behalf_of (optional — e.g. a prescription bought for Grandma), recurring flag, description, receipt (Phase 2).

### 3.3 Allowance

A recurring outflow to named recipients: **Zeyad, Rewan, Mona (aunt), Grandma, Marwa (aunt)**.

- **The monthly figure is fixed but not frozen** (decision D3). It can be raised or lowered at any time. A change is *effective-dated* rather than written over the old value, so raising Zeyad from EGP 2,500 to 3,000 in June leaves March–May reading 2,500 for ever. The current amount is simply the latest rate whose `effective_from` has passed.
- Each disbursement: recipient, amount, period (e.g. month), date paid, paid_by (Abdo), note.
- Zeyad and Rewan then **log their own expenses against their allowance**, giving each of them a personal balance (allowance received − expenses logged) and spending-habit charts by category.
- **Every submission needs Abdo's approval** (decision D5). A submitted expense sits as `pending`: the member can see it, but it does not move their balance until Abdo approves it. Rejecting it leaves the record and the reason, so nothing quietly disappears.
- Mona, Grandma and Marwa currently receive allowance without submitting expenses — the disbursement itself is the end of the trail. If they become users later, the same expense-submission flow applies unchanged.

### 3.4 Car module (Uber)

The family owns a car; **Uncle Joe** drives it for Uber. He is a user of the app, not just a name in a record — he submits his own days.

**Settled daily** (decision D1). Joe records one submission per day he drives, and **picks the date himself**: there are days off, so the app never assumes the submission is for today. A day he did not drive is simply a day with no record.

**Joe classifies every expense himself** (decision D2). Picking a label *suggests* a class, but the class is his to set and he can override the suggestion:

| Class | What it covers |
|---|---|
| **Direct** | Fuel, tolls — what it cost to earn that day's fares |
| **Indirect** | Administration, the **kārta** permit, a traffic fine |

The labels are Fuel, Tolls, Permit (kārta), Administration, Traffic fine, and **Other**. Every line also takes an **optional free-text note** — which is what makes *Other* usable rather than a black hole: an unclassifiable cost gets recorded with a description instead of being forced into a category that misrepresents it, or left out of the ledger entirely.

Deriving the class from the label alone was rejected: the same cost is not always the same kind of cost, and a fixed mapping would quietly make that decision for him on every row.

**Both classes come off the takings before Joe's third.** The classification is what the family reports on; it does not change anyone's split.

```
gross            = the day's takings
direct           = fuel, tolls
indirect         = administration, kārta, fines
net              = gross − direct − indirect
joe_share        = net × 1/3            → paid to Joe
remaining        = net − joe_share
family_income    = remaining × 0.75     → recorded as family income
marwa_share      = remaining × 0.25     → paid to Marwa
```

> **This reverses the earlier draft**, which took Joe's third off the gross *before* any expense. Under the old rule Joe carried none of the running costs; under this one he shares every cost of the car, direct or indirect, before taking his cut. On a day taking EGP 840 with EGP 160 of fuel and an EGP 200 permit, Joe receives 160 rather than 280.

Properties per day: date, gross, itemised expenses each with its class, computed net, Joe's share, family share, Marwa's share, status (submitted / settled), submitted_by (Joe), settled_by (Abdo). Joe enters only the takings and the costs; the app does the arithmetic.

**A day can be negative** (decision D10). A large fine on a quiet day costs more than it earned, and the loss is shared in exactly the ratios a profit is: Joe a third, the family three quarters of the rest, Marwa a quarter. It is not floored at zero — the ledger runs over time, so a bad Tuesday nets off against a good Wednesday.

**Joe hands over when it suits him** (D11) — daily, every ten days, no fixed rhythm. He *records* days; Abdo *confirms* a handover when the cash is in his hand. Until then the family share is money Joe holds, not money the family has. A handover that comes up short is **carried** (D12): the balance still owed simply stays owed.

### 3.5 Loans

Loans are registered separately from ordinary income so the family can see what it owes.

Properties: **lender name (required)**, **amount (required)**, description (optional), currency, date taken, direction (borrowed / lent out), status (outstanding / partially repaid / repaid), repayments (date + amount), balance remaining.

### 3.6 Currency

- **Internal ledger currency: EGP.** All internal transactions, reports and balances are in EGP.
- Remittances from the mother arrive in **EGP, SAR or USD**.
- A foreign-currency income record stores: original amount, original currency, FX rate applied, resulting EGP amount, and who set the rate. The original amount is never overwritten — the rate is part of the record, so history stays auditable.

---

## 4. Features by Phase

### Phase 1 — MVP
- Sign up / sign in (email or phone OTP); create a family (issued a permanent family code); join an existing one with a rotatable invite code; switch families if you belong to more than one (§2.4)
- Record **income** or **expense**: amount, category, date, note, on_behalf_of
- Default category set (§3.2) + custom categories (Abdo only)
- **Multi-currency income**: enter in EGP/SAR/USD, store rate + EGP value
- **Allowance disbursement**: pay recipients, track per-recipient balances
- **Member expense submission**: Zeyad and Rewan log spending against their allowance
- **Loan register**: lender, amount, optional description, repayments
- **Car, settled daily**: Joe submits each day he drives — date, takings, and expenses classified direct or indirect; the app computes the net, his third, and the family / Marwa split (§3.4)
- **Approval queue**: Zeyad's and Rewan's submissions wait for Abdo before they move a balance
- **History**: grouped by day; filter by person, category, type, date range; search notes
- **Dashboard**: cash on hand, current-period income vs expenses, days since last remittance, recent transactions
- **Charts**: income vs expense by month (bar), spending by category (donut), 6-month trend (line), per-person comparison, per-member spending habits
- Read-only auditor view for the mother
- **English and Arabic from day one, with a full RTL layout** (decision D9) — not deferred to Phase 2
- Multi-device realtime sync; offline entry that syncs when back online
- Ledger currency: EGP; **Gregorian dates only** (decision D9)

### Phase 2 — Quality of life
- Monthly budgets per category with progress bars and alerts
- Recurring transactions (salary, rent, subscriptions)
- Receipt photo attachments
- CSV/Excel export
- Push notifications (budget alerts, weekly family digest)

### Phase 3 — Money transfer (future)
- Internal wallet per member; member-to-member transfers recorded in a **double-entry ledger**
- Request/approve flow (kid requests, parent approves)
- If moving *real* money (bank/wallet integration): requires a licensed payment gateway and regulatory review — scope separately when the time comes

> Phase 1–2 data model is designed so Phase 3 bolts on without restructuring.

## 5. Recommended Tech Stack

| Layer | Choice | Why |
|---|---|---|
| App (iOS + Android + Web) | **Expo (React Native + react-native-web), TypeScript** | One codebase for all three platforms you chose |
| Backend | **Supabase** (Postgres, Auth, Realtime, Storage) | Built-in auth; **Row-Level Security** maps perfectly to family/role permissions; SQL is ideal for report queries; free tier covers a family easily |
| Charts | Victory | Works on both native and web |
| Data/state | TanStack Query + Zustand | Caching, offline-friendly |
| Deployment | EAS (app stores) + Vercel (web) | Simple CI for a solo developer |

**Why this fits Phase 3:** transfers become Supabase Edge Functions wrapping Postgres transactions — a safe, atomic ledger without a new backend.

**Alternative considered:** Flutter + Firebase. Solid, but Flutter web output is heavier and Firestore is weaker than SQL for the reporting/chart queries this app is built around.

## 6. Data Model

```
families          id (uuid pk), code (unique, e.g. 'SMBZ-7420'), name,
                  base_currency ('EGP'), created_by, created_at

family_invites    id, family_id, code (unique), created_by, expires_at,
                  max_uses, used_count, revoked_at
                  -- rotatable; separate from families.code by design (§2.4)

people            id (uuid pk), family_id, member_no (unique per family),
                  display_name, relationship,
                  is_user, auth_user_id (nullable), role (admin|member|viewer),
                  is_allowance_recipient, default_allowance_amount, active, joined_at
                  -- member_code is derived (families.code + '·' + member_no), never stored

categories        id, family_id, name, kind (income|expense),
                  is_occasional, color, icon, is_default

transactions      id, family_id, type (income|expense), amount_original,
                  currency ('EGP'|'SAR'|'USD'), fx_rate, amount_egp,
                  category_id, recorded_by, on_behalf_of (nullable),
                  occurred_at, description, tags[], source_ref (nullable),
                  receipt_url, created_at

remittances       id, family_id, from_person (mother), amount_original, currency,
                  fx_rate, amount_egp, received_on, visit_note
                  -- creates an income transaction

allowance_rates   id, family_id, recipient_id, amount_egp, effective_from
                  -- D3: effective-dated, never overwritten. The current
                  -- amount is the latest row whose effective_from has passed

allowances        id, family_id, recipient_id, period, amount_egp,
                  paid_on, paid_by, note
                  -- creates an expense transaction in category 'Allowance'

member_expenses   id, family_id, person_id, category_id, amount_egp,
                  occurred_at, description,
                  status (pending|approved|rejected), decided_by, decided_at
                  -- D5: a sub-ledger. Only approved rows move the member's
                  -- balance; they never touch the family ledger, which
                  -- already expensed the disbursement

loans             id, family_id, direction (borrowed|lent), lender_name,
                  amount_original, currency, amount_egp, taken_on,
                  description (nullable), status, balance_remaining

loan_payments     id, loan_id, amount_egp, paid_on, note

car_days          id, family_id, drive_date (unique per family), gross_egp,
                  direct_egp, indirect_egp, net_egp, driver_share_egp,
                  family_share_egp, marwa_share_egp,
                  status (submitted|settled), submitted_by, settled_by, note
                  -- D1: one row per day driven. drive_date is chosen by the
                  -- driver, never defaulted to today: there are days off

car_expenses      id, car_day_id, label (fuel|tolls|permit|admin|ticket|other),
                  class (direct|indirect), amount_egp, description
                  -- D2: the driver sets class himself; the label only
                  -- suggests a default. Deducted before the driver's third
                  -- either way — class is a reporting label, not a split.
                  -- description is optional, and is how 'other' stays useful

budgets           id, family_id, category_id, month, limit_amount      -- Phase 2
recurring_rules   id, family_id, template fields, schedule             -- Phase 2
wallets           id, family_id, person_id, balance                    -- Phase 3
transfers         id, family_id, from_person, to_person, amount, status -- Phase 3
```

**Derived values (computed, not stored):** member balance = allowances received − expenses submitted; cash on hand = total income EGP − total expenses EGP; car profit and its two splits.

**Security model:** every table carries `family_id` (§2.4); RLS policies allow access only to rows of your family, with role checks — Abdo (admin) writes everything; Zeyad and Rewan insert only expense rows where `recorded_by = self` and read only their own rows plus family totals; the mother has SELECT on everything and INSERT/UPDATE on nothing.

## 7. Screens

See `Family-Finance-App-Mockups.html` for visuals.

| Screen | Who sees it | Contents |
|---|---|---|
| **Auth** | all | Sign in / sign up, join family |
| **Dashboard** | all | Cash on hand, period income vs expenses, days since last remittance, recent activity |
| **Add Transaction** | Abdo, Zeyad, Rewan | Income/expense toggle, amount + currency, category grid, date, on-behalf-of, note |
| **Remittance** | Abdo (Mother views) | Log a visit remittance: amount, currency, rate, EGP result |
| **Allowance** | Abdo (recipients view own) | Recipients list, amounts, mark as paid, per-recipient balance |
| **My Spending** | Zeyad, Rewan | Allowance balance, own history, habit charts |
| **Car** | Abdo (Mother views) | Gross income, car expenses, computed uncle / family / Marwa splits, settle |
| **Loans** | Abdo (Mother views) | Lender, amount, description, status, repayments |
| **History** | all (scoped) | Searchable, filterable, grouped by day |
| **Reports** | Abdo, Mother | Bar, donut, trend, per-person comparison |
| **People** | Abdo | Add members and beneficiaries, set roles, member IDs, family code and invite |
| **Settings** | Abdo | Categories, FX rates, export, profile |

## 8. Roadmap

| Phase | Duration | Milestone |
|---|---|---|
| 0 — Setup | 1 wk | Repo, Expo project, Supabase schema + RLS, auth working |
| 1 — MVP | 4–6 wk | Family can record and see transactions, history, charts on phone + web |
| 2 — QoL | 3–4 wk | Budgets, recurring, receipts, export, Arabic/RTL |
| 3 — Transfers | scope later | Wallets + internal ledger |

**Definition of done for MVP:** two members on separate devices record transactions and both see the same dashboard/history/charts within seconds; works offline for entry.

## 9. Costs

- Supabase free tier + web hosting free tier: **$0/month** to start
- Google Play: $25 one-time · Apple: $99/year (or skip stores initially — use the web app + Android APK)

## 10. Decisions

Settled with the family on 4 September 2026. These were the nine open questions; each now has an answer, and each answer is built into the demo.

| # | Question | Decision |
|---|---|---|
| **D1** | Car settlement period | **Daily.** Joe submits one record per day he drives and **picks the date himself** — there are days off, so the app never assumes today. |
| **D2** | When is Joe's third taken? | **After expenses, not before.** Every cost comes off the day's takings first; Joe then takes a third of the net. He classifies each expense **direct** (fuel, tolls) or **indirect** (administration, the kārta permit, a fine) as he enters it — a reporting label, not a different split. *This reverses the original draft; see §3.4.* |
| **D3** | Allowance cadence | **A fixed monthly amount per person, which can be raised or lowered over time.** Changes are effective-dated, so they never rewrite what was already paid. |
| **D4** | FX rate source | **Abdo types it himself** per remittance. No rate API. The rate is stored with the record. |
| **D5** | Do member submissions need approval? | **Yes.** Zeyad's and Rewan's expenses sit as `pending` and do not move their balance until Abdo approves. |
| **D6** | Do members see family totals? | **No.** Strictly their own numbers. |
| **D7** | Gifts | **Record the recipient**, with an optional note. |
| **D8** | Cash vs bank/wallet | **One pot.** No account separation. |
| **D9** | Calendar and language | **Gregorian dates only.** **English and Arabic from day one**, switchable in the UI as the demo does it — Arabic moves out of Phase 2 into Phase 1. |

### Later decisions

Three more were settled once the demo made them concrete:

| # | Question | Decision |
|---|---|---|
| **D10** | A day where costs exceed takings | **It goes negative**, and the loss is shared in the same ratios as a profit — Joe a third, the family three quarters of the rest, Marwa a quarter. Not floored: the ledger runs over time, so a bad day nets off against a good one. |
| **D11** | When does Joe hand cash over? | **Whenever suits him** — daily, every ten days, no fixed rhythm. He *records* days; Abdo *confirms* a handover when the money is in his hand. Until then it is money Joe holds, not money the family has. |
| **D12** | A handover that comes up short | **Carried, not written off.** If 1,725 is due and 1,700 arrives, Joe still owes 25 and it is added to his next handover. The balance of `due_from_driver` is the carried amount. |

Nothing is open.
