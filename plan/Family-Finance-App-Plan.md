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
| **Mother** | Breadwinner — works abroad, main income source | **Viewer / Auditor** | Read-only. Full visibility of all income, expenses, allowances, loans, car ledger and reports. Cannot add or edit. |
| **Abdo** (big brother) | Accountant | **Admin** | Full access. Records and edits every transaction, manages categories, disburses allowances, registers loans, runs the car settlement, sets FX rates, approves member submissions. |
| **Zeyad** (son) | Allowance recipient | **Member** | Submits his own expenses against his allowance; sees his own balance, history and spending-habit charts. No access to other members' detail. |
| **Rewan** (daughter) | Allowance recipient | **Member** | Same as Zeyad. |
| *(future)* | — | any role | The role model must stay open: new members can be added without schema change. |

### 2.2 Non-user actors (appear in records, do not log in — for now)

| Actor | Relationship | Appears as |
|---|---|---|
| **Mona** | Aunt | Allowance recipient |
| **Grandma** | Grandmother | Allowance recipient |
| **Marwa** | Aunt | Allowance recipient **and** 25% share of car profit |
| **Uncle** | Uber driver of the family car | Takes 1/3 of car gross income |
| **Loaner** | External lender (name recorded per loan) | Loan counterparty |

> Design rule: every actor is a `person` record. Whether they can log in is a separate flag. That way a beneficiary (Grandma, Mona) can be promoted to a user later without rewriting history.

### 2.3 Actor properties

`id`, `display_name`, `relationship` (mother/brother/son/daughter/aunt/grandmother/uncle/external), `is_user` (can log in), `role` (admin | member | viewer), `is_allowance_recipient`, `default_allowance_amount`, `active`, `joined_at`.

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

- Each disbursement: recipient, amount, period (e.g. month), date paid, paid_by (Abdo), note.
- Zeyad and Rewan then **log their own expenses against their allowance**, giving each of them a personal balance (allowance received − expenses logged) and spending-habit charts by category.
- Mona, Grandma and Marwa currently receive allowance without submitting expenses — the disbursement itself is the end of the trail. If they become users later, the same expense-submission flow applies unchanged.

### 3.4 Car module (Uber)

The family owns a car; the **uncle** drives it for Uber. Settlement rule:

```
gross            = car income for the period
uncle_share      = gross × 1/3            → paid to uncle
operating_pool   = gross × 2/3            → covers car expenses
profit           = operating_pool − car_expenses
family_income    = profit × 0.75          → recorded as family income
marwa_share      = profit × 0.25          → paid to Marwa
```

Properties per settlement: period start/end, gross income, uncle share, itemised car expenses, computed profit, family share, Marwa share, status (open/settled), settled_by, notes. Individual trips/expenses roll up into the settlement; the app computes the splits rather than asking Abdo to do the arithmetic.

**Needs a decision:** settlement period (daily / weekly / monthly), and what happens when `car_expenses > operating_pool` (negative profit — carry the deficit forward, or absorb it from family funds?).

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
- Sign up / sign in (email or phone OTP); create family; join via invite code
- Record **income** or **expense**: amount, category, date, note, on_behalf_of
- Default category set (§3.2) + custom categories (Abdo only)
- **Multi-currency income**: enter in EGP/SAR/USD, store rate + EGP value
- **Allowance disbursement**: pay recipients, track per-recipient balances
- **Member expense submission**: Zeyad and Rewan log spending against their allowance
- **Loan register**: lender, amount, optional description, repayments
- **Car settlement**: enter gross + car expenses, app computes uncle / family / Marwa splits
- **History**: grouped by day; filter by person, category, type, date range; search notes
- **Dashboard**: cash on hand, current-period income vs expenses, days since last remittance, recent transactions
- **Charts**: income vs expense by month (bar), spending by category (donut), 6-month trend (line), per-person comparison, per-member spending habits
- Read-only auditor view for the mother
- Multi-device realtime sync; offline entry that syncs when back online
- Ledger currency: EGP

### Phase 2 — Quality of life
- Monthly budgets per category with progress bars and alerts
- Recurring transactions (salary, rent, subscriptions)
- Receipt photo attachments
- CSV/Excel export
- Push notifications (budget alerts, weekly family digest)
- Arabic localization + RTL layout

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
families          id, name, base_currency ('EGP'), created_by

people            id, family_id, display_name, relationship,
                  is_user, auth_user_id (nullable), role (admin|member|viewer),
                  is_allowance_recipient, default_allowance_amount, active, joined_at

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

allowances        id, family_id, recipient_id, period, amount_egp,
                  paid_on, paid_by, note
                  -- creates an expense transaction in category 'Allowance'

loans             id, family_id, direction (borrowed|lent), lender_name,
                  amount_original, currency, amount_egp, taken_on,
                  description (nullable), status, balance_remaining

loan_payments     id, loan_id, amount_egp, paid_on, note

car_settlements   id, family_id, period_start, period_end, gross_egp,
                  uncle_share_egp, operating_pool_egp, car_expenses_egp,
                  profit_egp, family_share_egp, marwa_share_egp,
                  status (open|settled), settled_by, note

car_expenses      id, settlement_id, category (fuel|maintenance|licensing|other),
                  amount_egp, occurred_at, description

budgets           id, family_id, category_id, month, limit_amount      -- Phase 2
recurring_rules   id, family_id, template fields, schedule             -- Phase 2
wallets           id, family_id, person_id, balance                    -- Phase 3
transfers         id, family_id, from_person, to_person, amount, status -- Phase 3
```

**Derived values (computed, not stored):** member balance = allowances received − expenses submitted; cash on hand = total income EGP − total expenses EGP; car profit and its two splits.

**Security model:** every table carries `family_id`; RLS policies allow access only to rows of your family, with role checks — Abdo (admin) writes everything; Zeyad and Rewan insert only expense rows where `recorded_by = self` and read only their own rows plus family totals; the mother has SELECT on everything and INSERT/UPDATE on nothing.

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
| **People** | Abdo | Add members and beneficiaries, set roles, invite |
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

## 10. Open Questions

1. **Car settlement period** — daily, weekly or monthly? And if car expenses exceed the 2/3 operating pool, is the deficit carried forward or covered from family funds?
2. **Uncle's third** — calculated on gross income before any expense, confirmed? Does he also pay for fuel out of his own share, or does all fuel come from the operating pool?
3. **Allowance cadence** — monthly fixed amounts per recipient, or ad-hoc when the mother visits?
4. **FX rate source** — manual entry by Abdo per remittance, or pulled from a rate API?
5. **Do Zeyad and Rewan's submissions need Abdo's approval**, or do they post directly to the ledger?
6. **Should Zeyad and Rewan see family totals** (rent, food, other people's allowances), or strictly their own numbers?
7. **Gifts** — track the recipient of each gift as well as the amount?
8. Track separate accounts (cash vs bank/wallet), or one pool?
9. Hijri calendar display alongside Gregorian? Arabic UI from day one?
