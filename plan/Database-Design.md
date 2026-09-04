# Database Design — Samboza Family Finance

**Design this before writing a line of application code.** Every defect found in
the demo blueprint traced back to a missing constraint, not to a missing
feature. Postgres on Supabase.

Conventions: `id uuid primary key default gen_random_uuid()`, every table
carries `family_id`, every table has `created_at timestamptz not null default
now()`. **Money is `bigint` piastres** — 1 EGP = 100 piastres. Never float,
never `money`.

---

## 1. Identity and tenancy

```sql
create table families (
  id            uuid primary key default gen_random_uuid(),
  code          text not null unique,          -- 'SMBZ-7420', permanent, public
  name          text not null,
  base_currency char(3) not null default 'EGP',
  created_by    uuid,
  created_at    timestamptz not null default now()
);

-- Rotatable, revocable, expiring. Deliberately NOT families.code: that
-- identifies, this grants access. Sharing one value would mean revoking a
-- leaked invite required changing the family's identity.
create table family_invites (
  id          uuid primary key default gen_random_uuid(),
  family_id   uuid not null references families on delete cascade,
  code        text not null unique,
  created_by  uuid not null,
  expires_at  timestamptz not null,
  max_uses    int not null default 1,
  used_count  int not null default 0,
  revoked_at  timestamptz,
  check (used_count <= max_uses)
);

create type person_role as enum ('admin','member','viewer','driver');

create table people (
  id             uuid primary key default gen_random_uuid(),
  family_id      uuid not null references families on delete cascade,
  member_no      int  not null,                -- 1..n, unique per family, never re-issued
  display_name   text not null,
  relationship   text not null,                -- mother|brother|son|daughter|aunt|
                                               -- grandmother|cousins|uncle_maternal|
                                               -- uncle_paternal|external
  is_user        boolean not null default false,
  auth_user_id   uuid unique references auth.users on delete set null,
  role           person_role,
  active         boolean not null default true,
  joined_at      date not null default current_date,
  created_at     timestamptz not null default now(),

  unique (family_id, member_no),
  -- a person who can log in must have a role and an auth identity
  check (not is_user or (role is not null)),
  -- a role without login is meaningless
  check (is_user or role is null)
);
```

**`relationship` carries which side of the family someone is on.** Arabic has no
single word for "uncle" — Joe is the mother's brother, so `uncle_maternal` →
الخال, never العم. A generic value produces wrong Arabic on every screen.

The member *code* (`SMBZ-7420·03`) is **derived at render time**, never stored.

---

## 2. The ledger — double-entry

This is the decision that everything else rests on. A single-entry
`transactions(type, amount)` table cannot express a receivable, and the same
gap keeps surfacing: *"Joe is holding EGP 1,725"*, *"the loan has 15,000
outstanding"*, *"how much is cash and how much is in the bank"*, and Phase 3
wallets are all the same missing concept — **an account**.

```sql
create type account_kind as enum ('asset','liability','income','expense','equity');

create table accounts (
  id         uuid primary key default gen_random_uuid(),
  family_id  uuid not null references families on delete cascade,
  kind       account_kind not null,
  name       text not null,
  person_id  uuid references people,   -- set for per-person accounts
  system_key text,                     -- 'cash', 'due_from_driver', 'wallet:<person>'
  active     boolean not null default true,
  unique (family_id, system_key)
);
```

Seeded per family: `cash` (asset), `due_from_driver` (asset), `remittances`
(income), `car_income` (income), plus one expense account per category and one
`wallet:<person>` liability per allowance recipient.

```sql
-- A journal is one balanced event. Nothing posts outside one.
create table journals (
  id           uuid primary key default gen_random_uuid(),
  family_id    uuid not null references families on delete cascade,
  occurred_on  date not null,             -- the day it happened
  recorded_at  timestamptz not null default now(),
  recorded_by  uuid not null references people,
  memo         text,
  source_table text,                      -- 'car_handovers', 'allowances', ...
  source_id    uuid,
  reverses     uuid references journals,  -- a correction points at what it undoes
  client_uuid  uuid unique                -- idempotency: same retry, same row
);

create table entries (
  id          uuid primary key default gen_random_uuid(),
  journal_id  uuid not null references journals on delete cascade,
  account_id  uuid not null references accounts,
  amount      bigint not null,            -- signed piastres; + debit, − credit
  person_id   uuid references people,     -- "on behalf of", for reporting
  category_id uuid references categories,
  check (amount <> 0)
);

create index on entries (account_id);
create index on entries (journal_id);
```

**Two rules enforced in the database, not in the app:**

```sql
-- 1. Every journal balances to zero.
create or replace function assert_balanced() returns trigger as $$
begin
  if (select coalesce(sum(amount),0) from entries
      where journal_id = coalesce(new.journal_id, old.journal_id)) <> 0 then
    raise exception 'journal % does not balance', coalesce(new.journal_id, old.journal_id);
  end if;
  return null;
end $$ language plpgsql;

create constraint trigger entries_balance
  after insert or update or delete on entries
  deferrable initially deferred
  for each row execute function assert_balanced();

-- 2. Posted journals are immutable. A mistake is corrected by a REVERSING
--    journal, never by an edit. This is what makes Ghada's auditor role real
--    rather than decorative — she can see that nothing was quietly changed.
create rule journals_no_update as on update to journals do instead nothing;
create rule journals_no_delete as on delete to journals do instead nothing;
```

**Balances are a view, never a stored column:**

```sql
create view account_balances as
  select a.family_id, a.id as account_id, a.system_key,
         coalesce(sum(e.amount), 0) as balance
  from accounts a left join entries e on e.account_id = a.id
  group by a.family_id, a.id, a.system_key;
```

### Period close

Balances derived from all history forever means a correction to March silently
moves today's number. Close each month with a stored opening balance:

```sql
create table period_closes (
  id          uuid primary key default gen_random_uuid(),
  family_id   uuid not null references families on delete cascade,
  closes_on   date not null,               -- last day included
  closed_by   uuid not null references people,
  closed_at   timestamptz not null default now(),
  balances    jsonb not null,              -- {account_id: balance} snapshot
  unique (family_id, closes_on)
);
```

---

## 3. Categories, remittances, allowances

```sql
create table categories (
  id         uuid primary key default gen_random_uuid(),
  family_id  uuid not null references families on delete cascade,
  name_en    text not null,
  name_ar    text not null,
  kind       text not null check (kind in ('income','expense')),
  account_id uuid not null references accounts,
  colour     text, icon text,
  is_default boolean not null default false,
  needs_recipient boolean not null default false,   -- D7: gifts
  active     boolean not null default true,
  unique (family_id, name_en)
);

create table remittances (
  id              uuid primary key default gen_random_uuid(),
  family_id       uuid not null references families on delete cascade,
  from_person     uuid not null references people,
  amount_original bigint not null check (amount_original > 0),
  currency        char(3) not null,
  fx_rate         numeric(12,6) not null check (fx_rate > 0),
  amount_egp      bigint not null,
  received_on     date not null,
  rate_set_by     uuid not null references people,   -- D4: Abdo types it
  visit_note      text,
  journal_id      uuid references journals
);
```

The original amount and the rate are **never overwritten** — the rate is part of
the record, so history stays auditable.

```sql
-- D3: effective-dated. The current amount is the latest row whose
-- effective_from has passed — ORDER BY effective_from DESC LIMIT 1, never
-- row order. Changing a rate never rewrites what was already paid.
create table allowance_rates (
  id             uuid primary key default gen_random_uuid(),
  family_id      uuid not null references families on delete cascade,
  recipient_id   uuid not null references people,
  amount_egp     bigint not null check (amount_egp >= 0),
  effective_from date not null,
  set_by         uuid not null references people,
  unique (recipient_id, effective_from)
);

create table allowances (
  id           uuid primary key default gen_random_uuid(),
  family_id    uuid not null references families on delete cascade,
  recipient_id uuid not null references people,
  period       date not null,                 -- first of the month
  amount_egp   bigint not null,
  paid_on      date not null,
  paid_by      uuid not null references people,
  journal_id   uuid not null references journals,
  unique (recipient_id, period)                -- pay a month once, ever
);
```

### Member submissions (D5)

```sql
create type submission_status as enum ('pending','approved','rejected');

create table member_expenses (
  id          uuid primary key default gen_random_uuid(),
  family_id   uuid not null references families on delete cascade,
  person_id   uuid not null references people,
  category_id uuid not null references categories,
  amount_egp  bigint not null check (amount_egp > 0),
  occurred_on date not null,
  description text,
  status      submission_status not null default 'pending',
  decided_by  uuid references people,
  decided_at  timestamptz,
  reason      text,
  client_uuid uuid unique,
  check (status = 'pending' or decided_by is not null)
);
```

A sub-ledger against the member's `wallet:` account. It never touches the family
ledger — the family already expensed the disbursement, so counting the member's
spending again would double-count it. **Only `approved` rows move the balance.**

### Personal books (§3.6)

A person's **own** money, which was never family money. Not the family ledger,
and not a member sub-ledger either — that one tracks an allowance the family
gave, which is why it needs approval. This needs none, because it is nobody
else's business.

```sql
create table personal_entries (
  id          uuid primary key default gen_random_uuid(),
  family_id   uuid not null references families on delete cascade,
  person_id   uuid not null references people,
  direction   text not null check (direction in ('in','out')),
  category    text not null,          -- own list, not the family's categories
  amount      bigint not null check (amount > 0),
  currency    char(3) not null,       -- she lives in SAR; her book is SAR
  occurred_on date not null,
  description text,
  family_ref  uuid references remittances,   -- the one place the books touch
  client_uuid uuid unique,
  created_at  timestamptz not null default now()
);

create index on personal_entries (person_id, occurred_on);
```

**No `account_id` and no `journal_id`.** This is deliberately *outside* the
family's double-entry ledger — it is a different entity's money. Putting it in
`entries` would make it reachable by a family balance query, which is precisely
what must never happen.

`family_ref` records the one event that appears in both books: a remittance is
income to the family and the largest outgoing in her own book. Same event, two
books, each recording its own half.

**Private, including from the admin:**

```sql
alter table personal_entries enable row level security;

-- Not "admin can see everything". Abdo is the family's accountant, not hers.
create policy pe_owner_only on personal_entries for all
  using      (person_id = (my_person(family_id)).id)
  with check (person_id = (my_person(family_id)).id);
```

That policy is the whole feature. If it ever grows an `or my_role(...) = 'admin'`
the book stops being personal.

Add to the RLS suite:

| As | Action | Expected |
|---|---|---|
| Abdo | read Ghada's `personal_entries` | **DENY** |
| Ghada | read own `personal_entries` | ALLOW |
| Ghada | insert into `entries` (family ledger) | **DENY** |
| Ghada | read `entries` | ALLOW (she is the auditor) |

---

## 4. The car

```sql
create type car_day_status as enum ('recorded','settled','off');

create table car_days (
  id           uuid primary key default gen_random_uuid(),
  family_id    uuid not null references families on delete cascade,
  drive_date   date not null,
  worked       boolean not null default true,
  gross_egp    bigint not null default 0 check (gross_egp >= 0),
  -- computed and stored so history is immune to a later rule change
  direct_egp   bigint not null default 0,
  indirect_egp bigint not null default 0,
  net_egp      bigint not null default 0,      -- MAY BE NEGATIVE
  driver_egp   bigint not null default 0,
  family_egp   bigint not null default 0,
  marwa_egp    bigint not null default 0,
  status       car_day_status not null default 'recorded',
  submitted_by uuid not null references people,
  handover_id  uuid references car_handovers,
  client_uuid  uuid unique,

  unique (family_id, drive_date),                    -- one row per day, ever
  check (drive_date <= current_date),                -- no future days
  check (not worked or gross_egp >= 0),
  check (worked or (gross_egp = 0 and net_egp = 0)), -- a day off has no money
  check (driver_egp + family_egp + marwa_egp = net_egp)  -- the split is exact
);

create table car_expenses (
  id          uuid primary key default gen_random_uuid(),
  car_day_id  uuid not null references car_days on delete cascade,
  label       text not null check (label in
                ('fuel','tolls','permit','admin','ticket','other')),
  class       text not null check (class in ('direct','indirect')),
  amount_egp  bigint not null check (amount_egp > 0),
  description text                                    -- what makes 'other' usable
);
```

**`net_egp` may be negative and is not floored.** A big fine on a quiet day costs
more than it earned, and the same ratios apply to a loss as to a profit: the
driver carries a third, the family three quarters of the rest, Marwa a quarter.
Nobody is shielded. The ledger runs over time, so a bad Tuesday nets off against
a good Wednesday.

**Rounding rule, written down because it is a decision:** the driver's share
rounds, the family's share rounds, **Marwa takes the remainder** — she absorbs
the odd piastre. The `check` constraint above enforces that the parts sum
exactly to the net.

### Handovers — the recording and tracking part

```sql
-- Joe hands over when it suits him: daily, every ten days, whenever. The app
-- does not guess. He RECORDS days; Abdo CONFIRMS a handover when the cash is
-- actually in his hand, covering however many days it covers.
--
-- Until confirmed, the family's share is money Joe is HOLDING, not money the
-- family HAS. It sits in `due_from_driver`, and cash on hand must not count it.
create table car_handovers (
  id             uuid primary key default gen_random_uuid(),
  family_id      uuid not null references families on delete cascade,
  received_on    date not null,
  amount_egp     bigint not null,          -- may be negative across bad days
  counted_egp    bigint,                   -- what was ACTUALLY handed over
  confirmed_by   uuid not null references people,
  journal_id     uuid not null references journals,
  note           text
);
```

`counted_egp` is the honest field: if the computed amount is 1,725 and Joe hands
over 1,700, the 25 difference is visible instead of silently vanishing.

**The difference is CARRIED, not written off** (decision D10). Joe still owes it,
and it is added to what is due at his next handover.

In the double-entry model this needs no extra machinery, which is a good sign
the model is right. Recording days debits `due_from_driver`; a handover credits
it by whatever was *actually counted*:

```
recording 8 days   debit  due_from_driver   1,725
                   credit car_income        1,725

handover of 1,700  debit  cash              1,700
                   credit due_from_driver   1,700

              →  due_from_driver still holds 25
```

The balance of `due_from_driver` **is** the carried amount. Nothing is written
off, no variance account is needed, and "what Joe still owes" is a query against
one account rather than a number somebody maintains by hand.

`amount_egp` stays as the computed figure so the arithmetic remains auditable;
`counted_egp` is what moved. Post the journal against `counted_egp`.

Income posts on `received_on`, **not** on the drive date — that is when the
family actually got the money.

---

## 5. Loans

```sql
create table loans (
  id          uuid primary key default gen_random_uuid(),
  family_id   uuid not null references families on delete cascade,
  direction   text not null check (direction in ('borrowed','lent')),
  counterparty text not null,
  principal_egp bigint not null check (principal_egp > 0),
  taken_on    date not null,
  description text,
  journal_id  uuid not null references journals
);

create table loan_payments (
  id         uuid primary key default gen_random_uuid(),
  loan_id    uuid not null references loans on delete cascade,
  amount_egp bigint not null check (amount_egp > 0),
  paid_on    date not null,
  journal_id uuid not null references journals
);
```

**No `status` column and no `balance_remaining`.** Both are derived — storing
them was a real defect in the blueprint, where one code path wrote a status and
another ignored it and recomputed.

---

## 6. Row-level security

The highest-consequence work in the project. Zeyad seeing Rewan's spending is a
family argument, not a bug report.

```sql
create or replace function my_person(fid uuid) returns people as $$
  select * from people
   where auth_user_id = auth.uid() and family_id = fid and active limit 1
$$ language sql stable security definer;

create or replace function my_role(fid uuid) returns person_role as $$
  select role from people
   where auth_user_id = auth.uid() and family_id = fid and active limit 1
$$ language sql stable security definer;
```

`active` in both. A person deactivated mid-session loses access on their **next
request**, not at token expiry.

```sql
alter table entries enable row level security;

-- Only admin and viewer see the family ledger. Members and the driver never do.
create policy entries_read on entries for select using (
  exists (select 1 from journals j
           where j.id = entries.journal_id
             and my_role(j.family_id) in ('admin','viewer'))
);

-- Nothing is written directly. Everything goes through a SECURITY DEFINER
-- function that posts a balanced journal.
create policy entries_no_direct_write on entries for all using (false);

alter table member_expenses enable row level security;

create policy me_read on member_expenses for select using (
  person_id = (my_person(family_id)).id            -- my own
  or my_role(family_id) in ('admin','viewer')      -- or the accountant/auditor
);

create policy me_insert on member_expenses for insert with check (
  person_id = (my_person(family_id)).id
  and my_role(family_id) = 'member'
  and status = 'pending'                            -- cannot self-approve
);

alter table car_days enable row level security;

create policy cd_read on car_days for select using (
  submitted_by = (my_person(family_id)).id
  or my_role(family_id) in ('admin','viewer')
);

create policy cd_insert on car_days for insert with check (
  my_role(family_id) = 'driver'
  and submitted_by = (my_person(family_id)).id
  and status = 'recorded'                           -- cannot settle his own days
);
```

### The RLS test suite — write it before the policies pass

Run in CI on every push. A permissions regression must break the build.

| As | Action | Expected |
|---|---|---|
| Zeyad | read Rewan's `member_expenses` | **DENY** |
| Zeyad | read `entries` | **DENY** |
| Zeyad | insert own expense as `approved` | **DENY** |
| Joe | read own `car_days` | ALLOW |
| Joe | read `entries` / `allowances` | **DENY** |
| Joe | insert a `car_day` as `settled` | **DENY** |
| Ghada | read everything in her family | ALLOW |
| Ghada | insert or update anything | **DENY** |
| Abdo | everything, his family only | ALLOW |
| anyone | read another family's rows | **DENY** |
| deactivated person | read anything | **DENY** |

---

## 7. Constraint checklist

Every one of these existed as a defect in the demo blueprint. Each is now a
database constraint, not an application `if`.

| Constraint | Prevents |
|---|---|
| `unique (family_id, drive_date)` | The same day submitted twice, income doubled |
| `unique (recipient_id, period)` | An allowance month paid twice |
| `unique (recipient_id, effective_from)` | Two rates from the same date |
| `unique (client_uuid)` | An offline retry posting twice |
| `check (driver + family + marwa = net)` | A rounding change silently losing a piastre |
| `check (drive_date <= current_date)` | A day submitted before it happened |
| `check (worked or gross = 0)` | A day off carrying money |
| balanced-journal trigger | A one-sided posting |
| immutability rules | A silent edit to posted history |
| status guard in the update | Two devices settling the same handover |

---

## 8. Migration order

1. `families`, `family_invites`, `people` + the two helper functions
2. `accounts`, `journals`, `entries`, balance trigger, immutability rules
3. `categories` + the per-family seed
4. `remittances`, `allowance_rates`, `allowances`, `member_expenses`
5. `car_handovers`, `car_days`, `car_expenses` *(handovers first — car_days references it)*
6. `loans`, `loan_payments`
7. `period_closes`
8. RLS policies, last, with the test suite already written and failing

Migrations are files in the repo from the first line. **The Supabase dashboard
is for looking, not for changing.**
