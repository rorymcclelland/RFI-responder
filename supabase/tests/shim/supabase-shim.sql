-- Minimal stand-in for the parts of Supabase that the migrations depend on, so the
-- database tests can run against plain Postgres (in this repo's CI service container
-- and anywhere Docker images for the full Supabase stack are unavailable).
--
-- It mirrors Supabase's own definitions for:
--   * the API roles: anon, authenticated, service_role (bypasses RLS);
--   * the auth schema: auth.users (the columns the migrations and seed use),
--     auth.flow_state, and auth.uid() / auth.role() / auth.jwt();
--   * Supabase's default grants on the public schema (table privileges for the API
--     roles, with row-level security doing the real work).
--
-- It does NOT emulate GoTrue (sign-up, invites, passwords) or PostgREST. Those are
-- covered by the CI job that applies the same migrations to the real Supabase stack.


do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then
    create role anon nologin noinherit;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then
    create role authenticated nologin noinherit;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then
    create role service_role nologin noinherit bypassrls;
  end if;
end $$;

-- Extensions live in their own schema, as on Supabase (search_path includes it).
create schema if not exists extensions;
create extension if not exists pgcrypto schema extensions;
grant usage on schema extensions to anon, authenticated, service_role;

create schema if not exists auth;
grant usage on schema auth to anon, authenticated, service_role;

create table if not exists auth.users (
  instance_id uuid,
  id uuid primary key,
  aud varchar(255),
  role varchar(255),
  email varchar(255),
  encrypted_password varchar(255),
  email_confirmed_at timestamptz,
  raw_app_meta_data jsonb,
  raw_user_meta_data jsonb,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  confirmation_token varchar(255),
  recovery_token varchar(255),
  email_change_token_new varchar(255),
  email_change varchar(255)
);

create table if not exists auth.identities (
  id uuid primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  provider_id text not null,
  provider text not null,
  identity_data jsonb not null,
  last_sign_in_at timestamptz,
  created_at timestamptz,
  updated_at timestamptz
);

create table if not exists auth.flow_state (
  id uuid primary key default gen_random_uuid(),
  auth_code_issued_at timestamptz
);

-- Same definitions as Supabase (reads the JWT claims PostgREST puts in the session).
create or replace function auth.uid() returns uuid language sql stable as $$
  select coalesce(
    nullif(current_setting('request.jwt.claim.sub', true), ''),
    (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')
  )::uuid
$$;

create or replace function auth.role() returns text language sql stable as $$
  select coalesce(
    nullif(current_setting('request.jwt.claim.role', true), ''),
    (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role')
  )::text
$$;

create or replace function auth.jwt() returns jsonb language sql stable as $$
  select coalesce(
    nullif(current_setting('request.jwt.claim', true), ''),
    nullif(current_setting('request.jwt.claims', true), '')
  )::jsonb
$$;

grant execute on function auth.uid(), auth.role(), auth.jwt() to anon, authenticated, service_role;

-- Supabase's default privileges on the public schema.
grant usage on schema public to anon, authenticated, service_role;
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant all on functions to anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
