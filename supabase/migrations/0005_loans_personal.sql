-- 0005 — loans, and personal books.

-- ---------------------------------------------------------------- loans
-- No `status` column and no `balance_remaining`. Both are derived. Storing
-- them was a real defect in the blueprint: one code path wrote a status and
-- another ignored it and recomputed, and the two had already diverged.
create table loans (
  id            uuid   primary key default gen_random_uuid(),
  family_id     uuid   not null references families on delete cascade,
  direction     text   not null check (direction in ('borrowed','lent')),
  counterparty  text   not null,
  principal_egp bigint not null check (principal_egp > 0),
  taken_on      date   not null,
  description   text,
  journal_id    uuid   not null references journals,
  client_uuid   uuid   unique
);

create table loan_payments (
  id         uuid   primary key default gen_random_uuid(),
  loan_id    uuid   not null references loans on delete cascade,
  amount_egp bigint not null check (amount_egp > 0),
  paid_on    date   not null,
  journal_id uuid   not null references journals,
  client_uuid uuid  unique
);

create index on loan_payments (loan_id);

create view loan_balances as
  select l.id as loan_id,
         l.family_id,
         l.counterparty,
         l.principal_egp,
         coalesce(sum(p.amount_egp), 0)                    as repaid_egp,
         l.principal_egp - coalesce(sum(p.amount_egp), 0)  as remaining_egp,
         case
           when coalesce(sum(p.amount_egp), 0) >= l.principal_egp then 'repaid'
           when coalesce(sum(p.amount_egp), 0) > 0               then 'partial'
           else 'outstanding'
         end as status
    from loans l
    left join loan_payments p on p.loan_id = l.id
   group by l.id;

-- ------------------------------------------------------- personal books
-- §3.6. A person's OWN money, which was never family money.
--
-- Not the family ledger, and not a member sub-ledger either — that one
-- tracks an allowance the family GAVE, which is why it needs approval.
-- This needs none, because it is nobody else's business.
--
-- Ghada earns abroad. Her salary, her rent in Riyadh, her groceries there:
-- she views the family books and contributes nothing to them, and this is
-- the other direction entirely.
create table personal_entries (
  id          uuid   primary key default gen_random_uuid(),
  family_id   uuid   not null references families on delete cascade,
  person_id   uuid   not null references people,
  direction   text   not null check (direction in ('in','out')),
  category    text   not null,          -- her own list, not the family's
  amount      bigint not null check (amount > 0),
  currency    char(3) not null,         -- she is paid in SAR; her book is SAR
  occurred_on date   not null,
  description text,
  family_ref  uuid   references remittances,  -- the ONE place the books touch
  client_uuid uuid   unique,
  created_at  timestamptz not null default now(),
  constraint pe_not_future check (occurred_on <= current_date)
);

create index on personal_entries (person_id, occurred_on desc);

comment on table personal_entries is
  'Deliberately OUTSIDE the family double-entry ledger. Putting these rows '
  'in `entries` would make them reachable by a family balance query, which '
  'is precisely what must never happen.';

comment on column personal_entries.currency is
  'Recording her Riyadh rent in EGP would misstate what she actually paid.';

comment on column personal_entries.family_ref is
  'A remittance is income to the family and the largest outgoing in her own '
  'book. Same event, two books, each recording its own half.';
