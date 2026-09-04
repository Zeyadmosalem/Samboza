-- 0002 — the double-entry ledger.
--
-- The decision everything rests on. A single-entry transactions(type, amount)
-- table cannot express a receivable, and the same gap kept surfacing during
-- planning: "Joe is holding 1,725", "the loan has 15,000 outstanding",
-- "how much is cash and how much is bank", and Phase 3 wallets. All four are
-- one missing concept — an account.
--
-- Money is bigint PIASTRES throughout. 1 EGP = 100. Never float.

-- ---------------------------------------------------------------- accounts
create type account_kind as enum ('asset','liability','income','expense','equity');

create table accounts (
  id         uuid primary key default gen_random_uuid(),
  family_id  uuid not null references families on delete cascade,
  kind       account_kind not null,
  name       text not null,
  person_id  uuid references people,
  system_key text,          -- 'cash' | 'due_from_driver' | 'wallet:<person_id>'
  active     boolean not null default true,
  created_at timestamptz not null default now(),
  unique (family_id, system_key)
);

create index on accounts (family_id);

comment on column accounts.system_key is
  'due_from_driver is where "Joe is holding money he has not handed over" '
  'lives. Its balance IS the carried amount (D12) — no write-off account, '
  'no variance column anyone maintains by hand.';

-- ---------------------------------------------------------------- categories
-- Declared here rather than later because `entries` references it.
create table categories (
  id              uuid primary key default gen_random_uuid(),
  family_id       uuid not null references families on delete cascade,
  name_en         text not null,
  name_ar         text not null,
  kind            text not null check (kind in ('income','expense')),
  account_id      uuid not null references accounts,
  colour          text,
  icon            text,
  is_default      boolean not null default false,
  needs_recipient boolean not null default false,   -- D7: gifts record who
  active          boolean not null default true,
  unique (family_id, name_en)
);

create index on categories (family_id);

-- ---------------------------------------------------------------- journals
-- One journal is one balanced event. Nothing posts outside one.
create table journals (
  id           uuid primary key default gen_random_uuid(),
  family_id    uuid not null references families on delete cascade,
  occurred_on  date not null,                  -- the day it happened
  recorded_at  timestamptz not null default now(),   -- when we were told
  recorded_by  uuid not null references people,
  memo         text,
  source_table text,
  source_id    uuid,
  reverses     uuid references journals,       -- a correction points at its target
  client_uuid  uuid unique                     -- idempotency: same retry, same row
);

create index on journals (family_id, occurred_on);

comment on column journals.client_uuid is
  'The client generates this ONCE and reuses it on every retry. Joe on bad '
  'signal submitting Tuesday twice must not post Tuesday twice.';

create table entries (
  id          uuid   primary key default gen_random_uuid(),
  journal_id  uuid   not null references journals on delete cascade,
  account_id  uuid   not null references accounts,
  amount      bigint not null check (amount <> 0),   -- signed piastres
  person_id   uuid   references people,              -- "on behalf of"
  category_id uuid   references categories
);

create index on entries (account_id);
create index on entries (journal_id);
create index on entries (person_id) where person_id is not null;

-- ------------------------------------------------ rule 1: journals balance
-- Deferred, so a journal and its lines can be inserted in one transaction
-- and checked once at commit.
create or replace function assert_journal_balanced() returns trigger
language plpgsql as $$
declare
  j uuid := coalesce(new.journal_id, old.journal_id);
  total bigint;
begin
  select coalesce(sum(amount), 0) into total from entries where journal_id = j;
  if total <> 0 then
    raise exception 'journal % does not balance: sums to %', j, total
      using errcode = 'check_violation';
  end if;
  return null;
end $$;

create constraint trigger entries_must_balance
  after insert or update or delete on entries
  deferrable initially deferred
  for each row execute function assert_journal_balanced();

-- ------------------------------------------- rule 2: posted history is fixed
-- A mistake is corrected by a REVERSING journal, never by an edit. This is
-- what makes Ghada's auditor role real rather than decorative — she can see
-- that nothing was quietly changed behind her.
-- Enforced by PRIVILEGE, not by a DO INSTEAD NOTHING rule.
--
-- A rule would also swallow the cascade from `families on delete cascade`:
-- deleting a family would rewrite the child DELETE into nothing, and the
-- delete would either fail on the foreign key or leave orphaned journals
-- behind an operation that looked like it worked. Rules rewrite statements
-- indiscriminately; they cannot tell an application edit from a cascade.
--
-- Revoking the privilege refuses the write outright, and RLS denies it a
-- second time: neither table has an UPDATE or DELETE policy, and with RLS
-- enabled an operation with no matching policy is denied. Migrations and
-- SECURITY DEFINER functions run as the table owner, which bypasses RLS, so
-- post_journal() and reverse_journal() still work.
revoke update, delete on journals from authenticated, anon;
revoke update, delete on entries  from authenticated, anon;

-- ---------------------------------------------------------------- balances
-- Derived, never a stored column that can drift from its own entries.
create view account_balances as
  select a.family_id,
         a.id  as account_id,
         a.system_key,
         a.kind,
         coalesce(sum(e.amount), 0) as balance
    from accounts a
    left join entries e on e.account_id = a.id
   group by a.family_id, a.id, a.system_key, a.kind;

-- ------------------------------------------------------------ period close
-- Balances derived from all history forever means a correction to March
-- silently moves today's number. A close stores the opening balance so the
-- ledger has a known-good starting point.
create table period_closes (
  id        uuid primary key default gen_random_uuid(),
  family_id uuid not null references families on delete cascade,
  closes_on date not null,
  closed_by uuid not null references people,
  closed_at timestamptz not null default now(),
  balances  jsonb not null,
  unique (family_id, closes_on)
);

-- ------------------------------------------------------------ posting API
-- Entries are never written directly (see 0006_rls.sql). Everything goes
-- through here, so "balanced" and "authorised" are decided in one place.
create or replace function post_journal(
  p_family       uuid,
  p_occurred_on  date,
  p_memo         text,
  p_lines        jsonb,          -- [{account_id, amount, person_id?, category_id?}]
  p_source_table text default null,
  p_source_id    uuid default null,
  p_client_uuid  uuid default null
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_me      people;
  v_journal uuid;
  v_line    jsonb;
  v_total   bigint := 0;
begin
  v_me := my_person(p_family);
  if v_me.id is null then
    raise exception 'not a member of this family' using errcode = 'insufficient_privilege';
  end if;
  if v_me.role <> 'admin' then
    raise exception 'only the family admin posts to the ledger'
      using errcode = 'insufficient_privilege';
  end if;

  -- Idempotent: a retry with the same client_uuid returns the first journal
  -- rather than posting a second one.
  if p_client_uuid is not null then
    select id into v_journal from journals where client_uuid = p_client_uuid;
    if v_journal is not null then return v_journal; end if;
  end if;

  if jsonb_array_length(p_lines) < 2 then
    raise exception 'a journal needs at least two lines';
  end if;

  insert into journals (family_id, occurred_on, recorded_by, memo,
                        source_table, source_id, client_uuid)
       values (p_family, p_occurred_on, v_me.id, p_memo,
               p_source_table, p_source_id, p_client_uuid)
    returning id into v_journal;

  for v_line in select * from jsonb_array_elements(p_lines) loop
    insert into entries (journal_id, account_id, amount, person_id, category_id)
    values (
      v_journal,
      (v_line->>'account_id')::uuid,
      (v_line->>'amount')::bigint,
      nullif(v_line->>'person_id','')::uuid,
      nullif(v_line->>'category_id','')::uuid
    );
    v_total := v_total + (v_line->>'amount')::bigint;
  end loop;

  if v_total <> 0 then
    raise exception 'journal does not balance: lines sum to %', v_total
      using errcode = 'check_violation';
  end if;

  return v_journal;
end $$;

-- The only way to undo anything. The original stays exactly as posted.
create or replace function reverse_journal(p_journal uuid, p_memo text)
returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_src     journals;
  v_me      people;
  v_journal uuid;
begin
  select * into v_src from journals where id = p_journal;
  if v_src.id is null then raise exception 'no such journal'; end if;

  v_me := my_person(v_src.family_id);
  if v_me.role <> 'admin' then
    raise exception 'only the family admin reverses a journal'
      using errcode = 'insufficient_privilege';
  end if;

  insert into journals (family_id, occurred_on, recorded_by, memo, reverses)
       values (v_src.family_id, current_date, v_me.id,
               coalesce(p_memo, 'reversal'), p_journal)
    returning id into v_journal;

  insert into entries (journal_id, account_id, amount, person_id, category_id)
  select v_journal, account_id, -amount, person_id, category_id
    from entries where journal_id = p_journal;

  return v_journal;
end $$;
