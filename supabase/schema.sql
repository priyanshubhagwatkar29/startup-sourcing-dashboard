-- LvlUp sourcing dashboard + Founder CRM: private Supabase schema
-- ---------------------------------------------------------------
-- Run once in the Supabase SQL editor (or as a migration). Safe to re-run:
-- every statement is idempotent (IF NOT EXISTS / OR REPLACE / DROP POLICY IF EXISTS).
--
-- Security model
--  * Every table in `public` has Row Level Security enabled.
--  * The `anon` role (visitors who are not signed in) has NO privileges on any table.
--  * Signed-in users pass RLS only if their auth user id is in private.allowed_users.
--  * private.allowed_users is filled by public.claim_owner(): the FIRST signed-in user whose
--    confirmed email equals private.app_owner.owner_email is recorded; after that no one else
--    can claim access. The owner email is set in a separate statement (see bottom) and is not
--    stored in this public repository.
--  * Research tables are read-only from the browser. CRM tables allow select/insert/update.
--    There are no DELETE policies: the app soft-deletes (deleted_at) so records are recoverable.

create schema if not exists private;
revoke all on schema private from public, anon;
grant usage on schema private to authenticated;   -- needed so RLS can call private.is_owner()

create table if not exists private.app_owner (
  id          int primary key default 1 check (id = 1),
  owner_email text not null
);
create table if not exists private.allowed_users (
  user_id    uuid primary key references auth.users(id) on delete cascade,
  email      text,
  created_at timestamptz not null default now()
);
revoke all on all tables in schema private from public, anon, authenticated;

create or replace function private.is_owner()
returns boolean language sql stable security definer set search_path = ''
as $$
  select exists (select 1 from private.allowed_users where user_id = (select auth.uid()));
$$;
revoke all on function private.is_owner() from public, anon;
grant execute on function private.is_owner() to authenticated;

-- Called by the browser right after sign-in. Returns true when the caller is the authorised owner.
create or replace function public.claim_owner()
returns boolean language plpgsql security definer set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  u_email text;
  u_confirmed boolean;
  wanted text;
begin
  if uid is null then return false; end if;
  if exists (select 1 from private.allowed_users where user_id = uid) then return true; end if;
  lock table private.allowed_users in exclusive mode;
  if exists (select 1 from private.allowed_users) then return false; end if;   -- owner already claimed
  select lower(owner_email) into wanted from private.app_owner where id = 1;
  select lower(email), email_confirmed_at is not null into u_email, u_confirmed from auth.users where id = uid;
  if wanted is not null and u_confirmed and u_email = wanted then
    insert into private.allowed_users(user_id, email) values (uid, u_email);
    return true;
  end if;
  return false;
end $$;
revoke all on function public.claim_owner() from public, anon;
grant execute on function public.claim_owner() to authenticated;

-- version + updated_at maintenance for optimistic concurrency
create or replace function private.bump_version()
returns trigger language plpgsql set search_path = ''
as $$
begin
  new.version := coalesce(old.version, 0) + 1;
  new.updated_at := now();
  return new;
end $$;
create or replace function private.touch_updated_at()
returns trigger language plpgsql set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end $$;

-- ---------- research data (read-only from the browser) ----------
create table if not exists public.research_meta (
  key        text primary key,
  value      jsonb not null,
  updated_at timestamptz not null default now()
);
create table if not exists public.companies (
  id                text primary key,
  rank              int unique,
  company_name      text not null unique,
  country           text,
  region            text,
  research_batch_id text,
  program_fit_score numeric,
  data              jsonb not null,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);
create table if not exists public.research_runs (
  run_id     text primary key,
  run_date   text,
  status     text,
  sort_order int not null default 0,
  data       jsonb not null
);
create table if not exists public.research_exclusions (
  id         text primary key,
  company    text not null,
  run_id     text,
  country    text,
  sort_order int not null default 0,
  data       jsonb not null
);
create table if not exists public.founder_lists (
  id         text primary key,
  name       text not null,
  sort_order int not null default 0,
  data       jsonb not null
);

-- ---------- founders (research rows read-only; custom rows editable) ----------
create table if not exists public.founders (
  id         text primary key,
  list_id    text references public.founder_lists(id),
  name       text not null,
  country    text,
  is_custom  boolean not null default false,
  sort_order int not null default 0,
  data       jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  constraint founders_custom_has_no_list check (not is_custom or list_id is null)
);
create index if not exists founders_list_idx on public.founders(list_id);

-- ---------- CRM ----------
create table if not exists public.crm_records (
  founder_id      text primary key references public.founders(id) on delete cascade,
  stage           text not null default 'Sourced',
  warmth          text not null default 'Cold',
  star            boolean not null default false,
  tags            jsonb not null default '[]'::jsonb,
  next_action     text not null default '',
  next_due        text not null default '',
  last_contact    text not null default '',
  contact_channel text not null default '',
  contacts        jsonb not null default '{}'::jsonb,
  extra           jsonb not null default '{}'::jsonb,
  version         int not null default 1,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  deleted_at      timestamptz
);
create table if not exists public.crm_activities (
  id         text primary key,
  founder_id text not null references public.founders(id) on delete cascade,
  ts         timestamptz not null,
  type       text not null,
  text       text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);
create index if not exists crm_activities_founder_idx on public.crm_activities(founder_id);
create table if not exists public.crm_settings (
  key        text primary key,
  value      jsonb not null,
  version    int not null default 1,
  updated_at timestamptz not null default now()
);
create table if not exists public.company_pipeline (
  company_id text primary key references public.companies(id) on delete cascade,
  status     text not null default 'New',
  notes      text not null default '',
  priority   boolean not null default false,
  version    int not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

drop trigger if exists bump_version on public.crm_records;
create trigger bump_version before update on public.crm_records for each row execute function private.bump_version();
drop trigger if exists bump_version on public.crm_settings;
create trigger bump_version before update on public.crm_settings for each row execute function private.bump_version();
drop trigger if exists bump_version on public.company_pipeline;
create trigger bump_version before update on public.company_pipeline for each row execute function private.bump_version();
drop trigger if exists touch on public.founders;
create trigger touch before update on public.founders for each row execute function private.touch_updated_at();
drop trigger if exists touch on public.crm_activities;
create trigger touch before update on public.crm_activities for each row execute function private.touch_updated_at();
drop trigger if exists touch on public.companies;
create trigger touch before update on public.companies for each row execute function private.touch_updated_at();

-- ---------- privileges: nothing for anon; least privilege for authenticated ----------
do $$
declare t text;
begin
  foreach t in array array['research_meta','companies','research_runs','research_exclusions','founder_lists',
                           'founders','crm_records','crm_activities','crm_settings','company_pipeline']
  loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from public, anon, authenticated', t);
  end loop;
end $$;

grant select on public.research_meta, public.companies, public.research_runs,
                public.research_exclusions, public.founder_lists to authenticated;
grant select, insert, update on public.founders, public.crm_records, public.crm_activities,
                public.crm_settings, public.company_pipeline to authenticated;

-- ---------- RLS policies (owner only) ----------
do $$
declare t text;
begin
  foreach t in array array['research_meta','companies','research_runs','research_exclusions','founder_lists',
                           'founders','crm_records','crm_activities','crm_settings','company_pipeline']
  loop
    execute format('drop policy if exists owner_select on public.%I', t);
    execute format('create policy owner_select on public.%I for select to authenticated using ((select private.is_owner()))', t);
  end loop;
  foreach t in array array['crm_records','crm_activities','crm_settings','company_pipeline']
  loop
    execute format('drop policy if exists owner_insert on public.%I', t);
    execute format('create policy owner_insert on public.%I for insert to authenticated with check ((select private.is_owner()))', t);
    execute format('drop policy if exists owner_update on public.%I', t);
    execute format('create policy owner_update on public.%I for update to authenticated using ((select private.is_owner())) with check ((select private.is_owner()))', t);
  end loop;
end $$;
-- founders: the owner may add and edit only founders they created in the CRM (is_custom)
drop policy if exists owner_insert on public.founders;
create policy owner_insert on public.founders for insert to authenticated
  with check ((select private.is_owner()) and is_custom and list_id is null);
drop policy if exists owner_update on public.founders;
create policy owner_update on public.founders for update to authenticated
  using ((select private.is_owner()) and is_custom)
  with check ((select private.is_owner()) and is_custom and list_id is null);

-- ---------- realtime (changes stream to the owner's other devices; RLS still applies) ----------
do $$
declare t text;
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    foreach t in array array['founders','crm_records','crm_activities','crm_settings','company_pipeline']
    loop
      if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t) then
        execute format('alter publication supabase_realtime add table public.%I', t);
      end if;
    end loop;
  end if;
end $$;

-- ---------- owner email (run separately; not committed with a real value) ----------
-- insert into private.app_owner(id, owner_email) values (1, 'you@example.com')
--   on conflict (id) do update set owner_email = excluded.owner_email;
