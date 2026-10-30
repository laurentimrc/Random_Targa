-- Ambiente minimo che imita Supabase, per provare la migrazione su un Postgres locale.
-- I ruoli sono condivisi da tutto il cluster: creali solo se mancano.
do $$ begin
  create role anon nologin;
exception when duplicate_object then null;
end $$;
do $$ begin
  create role authenticated nologin;
exception when duplicate_object then null;
end $$;
create schema auth;
create schema extensions;
create table auth.users (id uuid primary key default gen_random_uuid(), email text, is_anonymous boolean default true);
create function auth.uid() returns uuid language sql stable as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
$$;
grant usage on schema auth, extensions, public to anon, authenticated;
grant execute on function auth.uid() to anon, authenticated;
alter default privileges in schema public grant all on tables to anon, authenticated;
alter default privileges in schema public grant execute on functions to anon, authenticated;
create publication supabase_realtime;
