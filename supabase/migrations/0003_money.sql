-- 0003 — remittances, allowances, and the member sub-ledger.

-- ------------------------------------------------------------ remittances
-- The original amount and the rate are NEVER overwritten. The rate is part of
-- the record, so a year later you can still see what was actually agreed.
create table remittances (
  id              uuid   primary key default gen_random_uuid(),
  family_id       uuid   not null references families on delete cascade,
  from_person     uuid   not null references people,
  amount_original bigint not null check (amount_original > 0),
  currency        char(3) not null,
  fx_rate         numeric(12,6) not null check (fx_rate > 0),
  amount_egp      bigint not null check (amount_egp > 0),
  received_on     date   not null,
  rate_set_by     uuid   not null references people,   -- D4: Abdo, by hand
  visit_note      text,
  journal_id      uuid   references journals,
  client_uuid     uuid   unique,
  created_at      timestamptz not null default now()
);

create index on remittances (family_id, received_on);

-- -------------------------------------------------------- allowance rates
-- D3: a fixed monthly figure that can be raised or lowered. Effective-dated
-- rather than overwritten, so raising Zeyad in June leaves March–May reading
-- what he actually got.
--
-- The rate in force is the LATEST ROW BY DATE — never the last row inserted.
-- Scanning in insertion order silently returns the wrong figure the moment
-- somebody backdates a change.
create table allowance_rates (
  id             uuid   primary key default gen_random_uuid(),
  family_id      uuid   not null references families on delete cascade,
  recipient_id   uuid   not null references people,
  amount_egp     bigint not null check (amount_egp >= 0),
  effective_from date   not null,
  set_by         uuid   not null references people,
  created_at     timestamptz not null default now(),
  unique (recipient_id, effective_from)
);

create or replace function allowance_rate_on(p_recipient uuid, p_when date)
returns bigint
language sql stable as $$
  select amount_egp from allowance_rates
   where recipient_id = p_recipient
     and effective_from <= p_when
   order by effective_from desc
   limit 1
$$;

-- A month is paid ONCE, ever. The period is derived from the date being paid,
-- never assumed to be "this month".
create table allowances (
  id           uuid   primary key default gen_random_uuid(),
  family_id    uuid   not null references families on delete cascade,
  recipient_id uuid   not null references people,
  period       date   not null,             -- always the 1st of the month
  amount_egp   bigint not null check (amount_egp > 0),
  paid_on      date   not null,
  paid_by      uuid   not null references people,
  journal_id   uuid   not null references journals,
  client_uuid  uuid   unique,
  unique (recipient_id, period),
  constraint allowances_period_is_month_start check (extract(day from period) = 1)
);

-- ------------------------------------------------------ member sub-ledger
-- D5: a member's own spending against the allowance the family gave them.
-- Still family money, which is why it needs approval — unlike a personal
-- book (0005), which is the person's own money and needs none.
create type submission_status as enum ('pending','approved','rejected');

create table member_expenses (
  id          uuid   primary key default gen_random_uuid(),
  family_id   uuid   not null references families on delete cascade,
  person_id   uuid   not null references people,
  category_id uuid   not null references categories,
  amount_egp  bigint not null check (amount_egp > 0),
  occurred_on date   not null,
  description text,
  status      submission_status not null default 'pending',
  decided_by  uuid   references people,
  decided_at  timestamptz,
  reason      text,
  client_uuid uuid   unique,
  created_at  timestamptz not null default now(),

  constraint me_not_future check (occurred_on <= current_date),
  constraint me_decided_has_decider
    check (status = 'pending' or (decided_by is not null and decided_at is not null)),
  constraint me_pending_has_no_decider
    check (status <> 'pending' or (decided_by is null and decided_at is null))
);

create index on member_expenses (person_id, occurred_on);
create index on member_expenses (family_id, status);

comment on table member_expenses is
  'Only approved rows move the member''s balance. It never touches the family '
  'ledger: the family already expensed the disbursement, so counting the '
  'spending again would double-count it.';

-- Approving is guarded on the CURRENT status, not on what the screen last
-- rendered — two admins deciding the same row must not both succeed.
create or replace function decide_member_expense(
  p_id uuid, p_status submission_status, p_reason text default null
) returns boolean
language plpgsql security definer set search_path = public as $$
declare
  v_row member_expenses;
  v_me  people;
begin
  select * into v_row from member_expenses where id = p_id;
  if v_row.id is null then return false; end if;

  v_me := my_person(v_row.family_id);
  if v_me.role <> 'admin' then
    raise exception 'only the family admin decides submissions'
      using errcode = 'insufficient_privilege';
  end if;
  if p_status = 'pending' then
    raise exception 'cannot move a submission back to pending';
  end if;

  update member_expenses
     set status = p_status, decided_by = v_me.id, decided_at = now(), reason = p_reason
   where id = p_id and status = 'pending';

  return found;
end $$;
