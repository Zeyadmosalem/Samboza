-- 0001 — families, invites, people, and the two functions every policy uses.
--
-- Everything downstream depends on this file. The helper functions are
-- SECURITY DEFINER on purpose: a policy on `people` that queried `people`
-- through RLS would recurse forever. Owned by postgres, which bypasses RLS,
-- so the lookup terminates.

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------- families
create table families (
  id            uuid primary key default gen_random_uuid(),
  code          text        not null unique,   -- 'SMBZ-7420' — permanent, public
  name          text        not null,
  base_currency char(3)     not null default 'EGP',
  created_by    uuid,
  created_at    timestamptz not null default now(),
  constraint families_code_shape check (code ~ '^[A-Z]{4}-[0-9]{4}$')
);

comment on column families.code is
  'The family''s permanent public identity. An address, not a password: '
  'holding it grants nothing. Access comes from auth plus a people row.';

-- An invite GRANTS ACCESS, so it must be revocable without changing who the
-- family is. That is the entire reason it is not families.code.
create table family_invites (
  id         uuid        primary key default gen_random_uuid(),
  family_id  uuid        not null references families on delete cascade,
  code       text        not null unique,
  created_by uuid        not null,
  expires_at timestamptz not null,
  max_uses   int         not null default 1 check (max_uses > 0),
  used_count int         not null default 0 check (used_count >= 0),
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  check (used_count <= max_uses)
);

create index on family_invites (family_id);

-- ---------------------------------------------------------------- people
create type person_role as enum ('admin','member','viewer','driver');

create table people (
  id           uuid        primary key default gen_random_uuid(),
  family_id    uuid        not null references families on delete cascade,
  member_no    int         not null check (member_no > 0),
  display_name text        not null,

  -- Which SIDE of the family someone is on, not merely "uncle". Arabic has
  -- no single word for it: the mother's brother is الخال, the father's is
  -- العم. A generic value produces wrong Arabic on every screen.
  relationship text        not null check (relationship in (
                 'mother','father','brother','sister','son','daughter',
                 'aunt_maternal','aunt_paternal','uncle_maternal','uncle_paternal',
                 'grandmother','grandfather','cousins','external')),

  is_user      boolean     not null default false,
  auth_user_id uuid        unique references auth.users on delete set null,
  role         person_role,
  active       boolean     not null default true,
  joined_at    date        not null default current_date,
  created_at   timestamptz not null default now(),

  -- member_no is unique WITHIN a family and never re-issued, even if the
  -- person leaves. The public member code (SMBZ-7420·03) is derived from it
  -- at render time and never stored.
  unique (family_id, member_no),

  constraint people_user_has_role   check (not is_user or role is not null),
  constraint people_role_needs_user check (is_user or role is null)
);

create index on people (family_id);
create index on people (auth_user_id) where auth_user_id is not null;

-- ------------------------------------------------- who am I, in this family
-- `active` is checked here so a person deactivated mid-session loses access
-- on their NEXT REQUEST, not whenever their token happens to expire.
create or replace function my_person(p_family uuid)
returns people
language sql stable security definer set search_path = public as $$
  select * from people
   where auth_user_id = auth.uid()
     and family_id    = p_family
     and active
   limit 1
$$;

create or replace function my_role(p_family uuid)
returns person_role
language sql stable security definer set search_path = public as $$
  select role from people
   where auth_user_id = auth.uid()
     and family_id    = p_family
     and active
   limit 1
$$;

comment on function my_person(uuid) is
  'SECURITY DEFINER so policies on people can call it without recursing.';
