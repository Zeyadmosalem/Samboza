# Family Finance App — Planning Document

**Working name:** Samboza Family Finance
**Date:** September 2026
**Scope:** Record and track family income/expenses with history and charts. No investments. Money transfer between members planned as a later phase.

---

## 1. Vision

A private app for one family. Every member records their income and expenses; the family sees a shared picture of where money comes from and where it goes. Simple enough for daily use, structured enough to grow into member-to-member money transfers later.

## 2. Users & Roles

| Role | Who | Permissions |
|---|---|---|
| **Admin** | Parents | Manage members and invites, manage categories, view/edit all transactions, all reports |
| **Member** | Older kids / adults | Record own transactions, view family dashboard, history, and reports |
| **Viewer** (optional) | Young kids | View only — no recording |

Each person has their own login. Every transaction is tagged with who recorded it.

## 3. Features by Phase

### Phase 1 — MVP
- Sign up / sign in (email or phone OTP); create family; join via invite code
- Record **income** or **expense**: amount, category, date, note
- Default category set + custom categories (admin)
- **History**: list grouped by day; filter by member, category, type, date range; search notes
- **Dashboard**: current-month income, expenses, net; recent transactions
- **Charts**: income vs expense by month (bar), spending by category (donut), 6-month trend (line), per-member comparison
- Multi-device realtime sync; offline entry that syncs when back online
- Currency: SAR default, configurable

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

## 4. Recommended Tech Stack

| Layer | Choice | Why |
|---|---|---|
| App (iOS + Android + Web) | **Expo (React Native + react-native-web), TypeScript** | One codebase for all three platforms you chose |
| Backend | **Supabase** (Postgres, Auth, Realtime, Storage) | Built-in auth; **Row-Level Security** maps perfectly to family/role permissions; SQL is ideal for report queries; free tier covers a family easily |
| Charts | Victory | Works on both native and web |
| Data/state | TanStack Query + Zustand | Caching, offline-friendly |
| Deployment | EAS (app stores) + Vercel (web) | Simple CI for a solo developer |

**Why this fits Phase 3:** transfers become Supabase Edge Functions wrapping Postgres transactions — a safe, atomic ledger without a new backend.

**Alternative considered:** Flutter + Firebase. Solid, but Flutter web output is heavier and Firestore is weaker than SQL for the reporting/chart queries this app is built around.

## 5. Data Model

```
profiles         id (=auth user), name, avatar_url, locale
families         id, name, currency, created_by
family_members   family_id, user_id, role (admin|member|viewer), joined_at
categories       id, family_id, name, type (income|expense), color, icon, is_default
transactions     id, family_id, user_id, type (income|expense), amount,
                 category_id, note, occurred_at, receipt_url, created_at
budgets          id, family_id, category_id, month, limit_amount        -- Phase 2
recurring_rules  id, family_id, template fields, schedule               -- Phase 2
wallets          id, family_id, user_id, balance                        -- Phase 3
transfers        id, family_id, from_user, to_user, amount, status      -- Phase 3
```

**Security model:** every table carries `family_id`; RLS policies allow access only to rows of your family, with role checks (e.g., only admins update categories; members update only their own transactions).

## 6. Screens

See `Family-Finance-App-Mockups.html` for visuals.

1. **Auth** — sign in / sign up, create or join family
2. **Dashboard** — month summary card, recent transactions, quick-add
3. **Add Transaction** — income/expense toggle, amount, category grid, date, note
4. **History** — searchable, filterable, grouped by day
5. **Reports** — bar, donut, trend, per-member charts
6. **Family** — members, roles, invite code
7. **Settings** — categories, currency, export, profile

## 7. Roadmap

| Phase | Duration | Milestone |
|---|---|---|
| 0 — Setup | 1 wk | Repo, Expo project, Supabase schema + RLS, auth working |
| 1 — MVP | 4–6 wk | Family can record and see transactions, history, charts on phone + web |
| 2 — QoL | 3–4 wk | Budgets, recurring, receipts, export, Arabic/RTL |
| 3 — Transfers | scope later | Wallets + internal ledger |

**Definition of done for MVP:** two members on separate devices record transactions and both see the same dashboard/history/charts within seconds; works offline for entry.

## 8. Costs

- Supabase free tier + web hosting free tier: **$0/month** to start
- Google Play: $25 one-time · Apple: $99/year (or skip stores initially — use the web app + Android APK)

## 9. Open Questions

1. Do young kids need access (Viewer role), or only parents + older members?
2. Track separate accounts (cash vs bank cards) per member, or one pool per person?
3. Hijri calendar display alongside Gregorian?
4. Should members see *each other's* individual transactions, or only family totals? (affects RLS policies)
