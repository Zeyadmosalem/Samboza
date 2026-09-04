-- 0004 — the car: days Joe records, handovers Abdo confirms.
--
-- D1  Daily. Joe picks the date himself; the car does not run every day and
--     today must never be assumed.
-- D2  Every cost comes off the takings BEFORE Joe's third. He chooses the
--     class himself; the label only suggests one. This has always been the
--     arrangement — an early draft of the plan wrote it up as a third of the
--     gross, so there is no historical data computed the other way.
-- D10 A day may be NEGATIVE and is not floored. A loss is shared in exactly
--     the ratios a profit is.
-- D11 Handovers are irregular. He records; Abdo confirms when the cash is
--     actually in his hand.
-- D12 A short handover is CARRIED. due_from_driver holds the remainder.

-- Handovers first: car_days references them.
create table car_handovers (
  id           uuid   primary key default gen_random_uuid(),
  family_id    uuid   not null references families on delete cascade,
  received_on  date   not null,
  amount_egp   bigint not null,            -- computed from the days covered
  counted_egp  bigint not null,            -- what was ACTUALLY handed over
  confirmed_by uuid   not null references people,
  journal_id   uuid   not null references journals,
  note         text,
  client_uuid  uuid   unique,
  created_at   timestamptz not null default now(),
  constraint handover_not_future check (received_on <= current_date)
);

comment on column car_handovers.counted_egp is
  'D12. If 1,725 is due and 1,700 arrives, the journal posts 1,700 and the '
  '25 simply stays in due_from_driver — carried to his next handover, not '
  'written off. No variance account, because the balance IS the variance.';

create type car_day_status as enum ('recorded','settled','off');

create table car_days (
  id           uuid   primary key default gen_random_uuid(),
  family_id    uuid   not null references families on delete cascade,
  drive_date   date   not null,
  worked       boolean not null default true,

  gross_egp    bigint not null default 0 check (gross_egp >= 0),
  direct_egp   bigint not null default 0 check (direct_egp >= 0),
  indirect_egp bigint not null default 0 check (indirect_egp >= 0),
  net_egp      bigint not null default 0,       -- MAY BE NEGATIVE
  driver_egp   bigint not null default 0,
  family_egp   bigint not null default 0,
  marwa_egp    bigint not null default 0,

  status       car_day_status not null default 'recorded',
  submitted_by uuid   not null references people,
  handover_id  uuid   references car_handovers,
  client_uuid  uuid   unique,
  created_at   timestamptz not null default now(),

  -- One row per calendar day, ever. Without this the same day is submitted
  -- twice and the family's income is counted twice.
  unique (family_id, drive_date),

  constraint cd_not_future check (drive_date <= current_date),

  -- A day off is a RECORDED row, not an absent one: "Joe rested" and "Joe
  -- has not sent it in yet" must not look identical.
  constraint cd_off_has_no_money check (worked or (gross_egp = 0 and net_egp = 0)),
  constraint cd_off_status       check (worked or status = 'off'),
  constraint cd_worked_status    check (not worked or status in ('recorded','settled')),

  -- The split is exact, including when the net is negative. The driver
  -- rounds, the family rounds, Marwa takes the remainder — she absorbs the
  -- odd piastre, and this constraint is what stops that rule drifting.
  constraint cd_split_is_exact check (driver_egp + family_egp + marwa_egp = net_egp),
  constraint cd_net_is_derived  check (net_egp = gross_egp - direct_egp - indirect_egp),

  -- Settled means handed over. The two cannot disagree.
  constraint cd_settled_has_handover
    check ((status = 'settled') = (handover_id is not null))
);

create index on car_days (family_id, drive_date desc);
create index on car_days (status) where status = 'recorded';

create table car_expenses (
  id          uuid   primary key default gen_random_uuid(),
  car_day_id  uuid   not null references car_days on delete cascade,
  label       text   not null check (label in
                ('fuel','tolls','permit','admin','ticket','other')),
  class       text   not null check (class in ('direct','indirect')),
  amount_egp  bigint not null check (amount_egp > 0),
  description text
);

create index on car_expenses (car_day_id);

comment on column car_expenses.class is
  'Chosen by the driver, not derived from the label. The same cost is not '
  'always the same kind of cost, and a fixed mapping would make that call '
  'for him silently on every row.';

comment on column car_expenses.description is
  'What makes the "other" label usable rather than a black hole: an '
  'unclassifiable cost is recorded with a description instead of being '
  'forced into a category that misrepresents it.';

-- ------------------------------------------------------ the split, in SQL
-- One definition, used by the app and by any backfill, so the arithmetic
-- cannot drift between them.
--
-- ROUNDING, and why it is spelled out: Postgres round() on numeric is
-- half-AWAY-FROM-ZERO, while JavaScript Math.round is half-UP (toward
-- positive infinity). They agree on every positive value and disagree on
-- exact negative halves — round(-1.5) is -2 here and -1 in JS.
--
-- Days can now be negative (D10), so this is not theoretical: across a
-- +/-5000 range, 833 nets split differently under the two rules. The client
-- MUST round half-away-from-zero — sign(x) * round(abs(x)) — or the app and
-- the ledger will quietly disagree on roughly one losing day in twelve.
create or replace function car_split(p_net bigint)
returns table (driver_egp bigint, family_egp bigint, marwa_egp bigint)
language sql immutable as $$
  select d, f, (p_net - d) - f
    from (select round(p_net / 3.0)::bigint as d) s,
         lateral (select round((p_net - s.d) * 0.75)::bigint as f) t
$$;

-- ------------------------------------------------- confirming a handover
-- Guarded on the CURRENT status, so two devices confirming the same days
-- cannot both post. This is the shape the app must never replace with an
-- `if` it read off the screen.
create or replace function confirm_handover(
  p_family      uuid,
  p_day_ids     uuid[],
  p_received_on date,
  p_counted_egp bigint,
  p_cash_account uuid,
  p_due_account  uuid,
  p_note        text default null,
  p_client_uuid uuid default null
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_me       people;
  v_amount   bigint;
  v_journal  uuid;
  v_handover uuid;
  v_count    int;
begin
  v_me := my_person(p_family);
  if v_me.role <> 'admin' then
    raise exception 'only the family admin confirms a handover'
      using errcode = 'insufficient_privilege';
  end if;

  if p_client_uuid is not null then
    select id into v_handover from car_handovers where client_uuid = p_client_uuid;
    if v_handover is not null then return v_handover; end if;
  end if;

  select coalesce(sum(family_egp), 0), count(*)
    into v_amount, v_count
    from car_days
   where family_id = p_family
     and id = any (p_day_ids)
     and status = 'recorded';          -- the guard

  if v_count = 0 then
    raise exception 'no unsettled days in that selection';
  end if;

  -- Cash in for what was actually counted; the receivable clears by the same
  -- amount, so any shortfall simply stays in due_from_driver (D12).
  v_journal := post_journal(
    p_family, p_received_on, coalesce(p_note, 'car handover'),
    jsonb_build_array(
      jsonb_build_object('account_id', p_cash_account, 'amount',  p_counted_egp),
      jsonb_build_object('account_id', p_due_account,  'amount', -p_counted_egp)
    ),
    'car_handovers', null, p_client_uuid
  );

  insert into car_handovers (family_id, received_on, amount_egp, counted_egp,
                             confirmed_by, journal_id, note, client_uuid)
       values (p_family, p_received_on, v_amount, p_counted_egp,
               v_me.id, v_journal, p_note, p_client_uuid)
    returning id into v_handover;

  update car_days
     set status = 'settled', handover_id = v_handover
   where family_id = p_family and id = any (p_day_ids) and status = 'recorded';

  return v_handover;
end $$;
