-- 0014 — the money Ghada brings home.
--
-- D4: Abdo types the rate himself, per remittance. No rate API, no daily fix,
-- no "we'll look it up later" — the rate that was actually agreed is part of
-- the record, so a year from now the row still explains itself.
--
-- The original amount is NEVER overwritten (§3.7). A remittance stores what
-- arrived, in what currency, at what rate, what that came to in EGP, and who
-- set the rate. Recomputing the EGP figure from a newer rate would silently
-- rewrite history, so the EGP figure is stored too — derived once, at the
-- moment it was true.
--
-- AMOUNTS ARE MINOR UNITS OF THE ORIGINAL CURRENCY. 1,000 SAR is 100000, and
-- at 12.9 EGP/SAR that is 1,290,000 piastres. The same convention as
-- everywhere else in this schema, applied per currency rather than assuming
-- everything is Egyptian.
--
-- WHY A FUNCTION AT ALL. `remittances_write` let the admin insert directly,
-- which meant amount_egp arrived from the client and nothing checked it
-- against amount_original × fx_rate. A row could say 1,000 SAR at 12.9 came
-- to EGP 900 and the database would keep it. Same class of hole as the car
-- day computing its own split.

alter table remittances add column if not exists voided_at   timestamptz;
alter table remittances add column if not exists void_reason text;

comment on column remittances.voided_at is
  'Abdo types the rate by hand, so he will eventually type it wrong. A '
  'remittance is voided and its journal reversed, never edited — the '
  'correction stays visible, which is the whole point of Ghada being able '
  'to audit this.';

create or replace function record_remittance(
  p_family          uuid,
  p_from_person     uuid,
  p_amount_original bigint,        -- MINOR UNITS of p_currency: 1,000 SAR = 100000
  p_currency        char(3),
  p_fx_rate         numeric,       -- EGP per 1 unit of p_currency; 1 for EGP
  p_received_on     date,
  p_visit_note      text default null,
  p_client_uuid     uuid default null
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_me     people;
  v_cash   uuid;
  v_income uuid;
  v_egp    bigint;
  v_journal uuid;
  v_id     uuid;
begin
  v_me := my_person(p_family);
  if v_me.id is null or v_me.role is distinct from 'admin' then
    raise exception 'only the family admin records a remittance'
      using errcode = 'insufficient_privilege';
  end if;

  if p_client_uuid is not null then
    select id into v_id from remittances where client_uuid = p_client_uuid;
    if v_id is not null then return v_id; end if;
  end if;

  if p_currency not in ('EGP','SAR','USD') then
    raise exception 'currency must be EGP, SAR or USD, got %', p_currency;
  end if;
  if p_amount_original is null or p_amount_original <= 0 then
    raise exception 'an amount must be a positive number of minor units';
  end if;
  if p_fx_rate is null or p_fx_rate <= 0 then
    raise exception 'a rate must be greater than zero';
  end if;
  if p_currency = 'EGP' and p_fx_rate <> 1 then
    raise exception 'EGP converts to EGP at 1, not %', p_fx_rate;
  end if;
  if p_received_on > current_date then
    raise exception 'that day has not happened yet';
  end if;
  if not exists (select 1 from people
                  where id = p_from_person and family_id = p_family) then
    raise exception 'that person is not in this family'
      using errcode = 'insufficient_privilege';
  end if;

  -- Derived ONCE, here, from the two numbers that are the record. The client
  -- shows the same arithmetic so nobody is surprised, but it never supplies
  -- the answer.
  v_egp := round(p_amount_original * p_fx_rate)::bigint;
  if v_egp <= 0 then
    raise exception 'that comes to nothing in EGP — check the rate';
  end if;

  select id into v_cash   from accounts where family_id = p_family and system_key = 'cash';
  select id into v_income from accounts where family_id = p_family and system_key = 'remittance_income';
  if v_cash is null or v_income is null then
    raise exception 'this family has no cash or remittance account — run the bootstrap';
  end if;

  v_journal := post_journal_as(
    p_family, v_me.id, p_received_on,
    coalesce(p_visit_note, 'remittance'),
    jsonb_build_array(
      jsonb_build_object('account_id', v_cash,   'amount',  v_egp),
      jsonb_build_object('account_id', v_income, 'amount', -v_egp,
                         'person_id', p_from_person)
    ),
    'remittances', null, p_client_uuid);

  insert into remittances (family_id, from_person, amount_original, currency,
                           fx_rate, amount_egp, received_on, rate_set_by,
                           visit_note, journal_id, client_uuid)
       values (p_family, p_from_person, p_amount_original, p_currency,
               p_fx_rate, v_egp, p_received_on, v_me.id,
               p_visit_note, v_journal, p_client_uuid)
    returning id into v_id;

  return v_id;
end $$;

-- ------------------------------------------------------------- correcting
create or replace function void_remittance(p_id uuid, p_reason text)
returns boolean
language plpgsql security definer set search_path = public as $$
declare
  v_row remittances;
  v_me  people;
begin
  select * into v_row from remittances where id = p_id;
  if v_row.id is null then return false; end if;

  v_me := my_person(v_row.family_id);
  if v_me.id is null or v_me.role is distinct from 'admin' then
    raise exception 'only the family admin voids a remittance'
      using errcode = 'insufficient_privilege';
  end if;
  if v_row.voided_at is not null then return false; end if;

  if v_row.journal_id is not null then
    perform post_journal_as(
      v_row.family_id, v_me.id, current_date,
      coalesce(p_reason, 'voided remittance'),
      (select jsonb_agg(jsonb_build_object(
                'account_id', e.account_id, 'amount', -e.amount,
                'person_id',  e.person_id,  'category_id', e.category_id))
         from entries e where e.journal_id = v_row.journal_id),
      'remittances', p_id, null);
  end if;

  update remittances set voided_at = now(), void_reason = p_reason where id = p_id;
  return true;
end $$;

-- ------------------------------------------------------------ the door in
-- Read stays as it was: Abdo and Ghada. Writing goes through the function, so
-- amount_egp can never disagree with the amount and the rate beside it, and a
-- posted remittance can never be quietly edited afterwards.
drop policy if exists remittances_write on remittances;
create policy remittances_no_direct_write on remittances for insert with check (false);

comment on table remittances is
  'What Ghada brings home, at the rate that was actually agreed. Written only '
  'by record_remittance(). The one event that belongs in two books: family '
  'income here, and the largest thing she spends in her own.';
