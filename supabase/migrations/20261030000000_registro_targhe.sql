-- Registro condiviso di Random Targa.
--
-- Ogni utente (anche anonimo) ha un garage (profiles). Le targhe (plates) sono uniche
-- a livello globale finché non vengono rottamate. Ogni operazione è registrata in
-- plate_events, una catena di eventi in cui ogni riga contiene l'impronta SHA-256
-- della precedente: qualsiasi modifica successiva viene rilevata da verify_chain().
--
-- Le tabelle sono in sola lettura per i client: tutte le scritture passano dalle
-- funzioni RPC qui sotto, che verificano proprietà e regole di composizione.

create extension if not exists pgcrypto with schema extensions;

-- ---------------------------------------------------------------------------
-- Tabelle
-- ---------------------------------------------------------------------------

create table public.profiles (
  id uuid primary key references auth.users on delete cascade,
  garage_name text not null default 'Il mio garage' check (char_length(garage_name) between 1 and 32),
  garage_code text not null unique,
  onboarded boolean not null default false,
  spins integer not null default 0,
  created_at timestamptz not null default now()
);

create table public.plates (
  id uuid primary key default gen_random_uuid(),
  plate text not null,
  vehicle_type text not null check (vehicle_type in ('auto', 'moto', 'ciclomotore', 'rimorchio')),
  owner_id uuid references public.profiles on delete set null,
  metadata jsonb not null default '{}'::jsonb,
  minted_at timestamptz not null default now(),
  burned_at timestamptz
);

-- Una targa attiva può esistere una sola volta.
create unique index plates_active_unique on public.plates (plate, vehicle_type) where burned_at is null;
create index plates_owner_idx on public.plates (owner_id) where burned_at is null;

create table public.plate_events (
  id bigint generated always as identity primary key,
  plate_id uuid not null references public.plates on delete cascade,
  type text not null check (type in ('MINT', 'TRANSFER', 'UPDATE', 'BURN')),
  from_id uuid,
  to_id uuid,
  data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  prev_hash text not null,
  hash text not null
);

create index plate_events_from_idx on public.plate_events (from_id);
create index plate_events_to_idx on public.plate_events (to_id);

-- ---------------------------------------------------------------------------
-- Sicurezza: lettura pubblica per gli utenti autenticati, nessuna scrittura diretta
-- ---------------------------------------------------------------------------

alter table public.profiles enable row level security;
alter table public.plates enable row level security;
alter table public.plate_events enable row level security;

create policy "profili visibili" on public.profiles for select to authenticated using (true);
create policy "targhe visibili" on public.plates for select to authenticated using (true);
create policy "eventi visibili" on public.plate_events for select to authenticated using (true);

revoke insert, update, delete, truncate on public.profiles, public.plates, public.plate_events from anon, authenticated;

-- ---------------------------------------------------------------------------
-- Funzioni di supporto
-- ---------------------------------------------------------------------------

-- Regole di composizione (stesse di js/targa-rules.js). Lettere ammesse: tutte tranne I, O, Q, U.
create or replace function public.is_valid_plate(p_plate text, p_type text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select case p_type
    when 'auto' then p_plate ~ '^[A-HJ-NPR-TV-Z]{2}[0-9]{3}[A-HJ-NPR-TV-Z]{2}$' and left(p_plate, 2) <> 'EE'
    when 'moto' then p_plate ~ '^[A-HJ-NPR-TV-Z]{2}[0-9]{5}$' and left(p_plate, 2) <> 'EE'
    when 'ciclomotore' then p_plate ~ '^X[A-HJ-NPR-TV-Z0-9]{5}$'
    when 'rimorchio' then p_plate ~ '^X[A-HJ-NPR-TV-Z][0-9]{3}[A-HJ-NPR-TV-Z]{2}$'
    else false
  end;
$$;

-- Impronta di un evento: dipende dall'impronta precedente e da tutti i campi significativi.
create or replace function public.event_hash(
  p_prev text, p_plate_id uuid, p_type text, p_from uuid, p_to uuid, p_data jsonb, p_created_at timestamptz
)
returns text
language sql
immutable
set search_path = ''
as $$
  select encode(extensions.digest(
    p_prev || '|' || p_plate_id::text || '|' || p_type || '|' || coalesce(p_from::text, '') || '|' ||
    coalesce(p_to::text, '') || '|' || p_data::text || '|' || extract(epoch from p_created_at)::text,
    'sha256'), 'hex');
$$;

create or replace function public.append_event(p_plate_id uuid, p_type text, p_from uuid, p_to uuid, p_data jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_prev text;
  v_now timestamptz := now();
begin
  -- Serializza le scritture così la catena resta lineare.
  perform pg_advisory_xact_lock(hashtext('random-targa:plate_events'));
  select e.hash into v_prev from public.plate_events e order by e.id desc limit 1;
  v_prev := coalesce(v_prev, repeat('0', 64));
  insert into public.plate_events (plate_id, type, from_id, to_id, data, created_at, prev_hash, hash)
  values (p_plate_id, p_type, p_from, p_to, p_data, v_now, v_prev,
          public.event_hash(v_prev, p_plate_id, p_type, p_from, p_to, p_data, v_now));
end;
$$;

-- Tiene solo i campi previsti, con lunghezze limitate.
create or replace function public.clean_metadata(p jsonb, p_with_band boolean)
returns jsonb
language sql
immutable
set search_path = ''
as $$
  select jsonb_strip_nulls(jsonb_build_object(
    'alias', nullif(left(trim(p ->> 'alias'), 40), ''),
    'make', nullif(left(trim(p ->> 'make'), 40), ''),
    'model', nullif(left(trim(p ->> 'model'), 40), ''),
    'color', nullif(left(trim(p ->> 'color'), 30), ''),
    'province', case when p_with_band and (p ->> 'province') ~ '^[A-Z]{2}$' then p ->> 'province' end,
    'year', case when p_with_band and (p ->> 'year') ~ '^(19|20)[0-9]{2}$' then (p ->> 'year')::int end
  ));
$$;

create or replace function public.require_user()
returns uuid
language plpgsql
stable
set search_path = ''
as $$
declare
  v uuid := auth.uid();
begin
  if v is null then
    raise exception 'Accesso richiesto' using errcode = '28000';
  end if;
  return v;
end;
$$;

-- Crea il garage per ogni nuovo utente (anche anonimo) con un codice univoco.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_code text;
begin
  loop
    v_code := 'RT-' || upper(encode(extensions.gen_random_bytes(3), 'hex'));
    exit when not exists (select 1 from public.profiles where garage_code = v_code);
  end loop;
  insert into public.profiles (id, garage_code) values (new.id, v_code);
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------------------------------------------------------------------------
-- API (RPC)
-- ---------------------------------------------------------------------------

create or replace function public.rename_garage(p_name text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := public.require_user();
  v_name text := left(trim(coalesce(p_name, '')), 32);
begin
  if v_name = '' then
    raise exception 'Il nome del garage non può essere vuoto';
  end if;
  update public.profiles set garage_name = v_name, onboarded = true where id = v_uid;
end;
$$;

create or replace function public.add_spin()
returns void
language sql
security definer
set search_path = ''
as $$
  update public.profiles set spins = spins + 1 where id = public.require_user();
$$;

create or replace function public.mint_plate(p_plate text, p_type text, p_metadata jsonb default '{}'::jsonb)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := public.require_user();
  v_plate text := upper(regexp_replace(coalesce(p_plate, ''), '[^A-Za-z0-9]', '', 'g'));
  v_meta jsonb := public.clean_metadata(coalesce(p_metadata, '{}'::jsonb), p_type in ('auto', 'rimorchio'));
  v_id uuid;
begin
  if not public.is_valid_plate(v_plate, p_type) then
    raise exception 'La combinazione % non rispetta le regole italiane', v_plate;
  end if;
  begin
    insert into public.plates (plate, vehicle_type, owner_id, metadata)
    values (v_plate, p_type, v_uid, v_meta)
    returning id into v_id;
  exception when unique_violation then
    raise exception 'La targa % è già stata certificata da un altro garage', v_plate;
  end;
  perform public.append_event(v_id, 'MINT', null, v_uid,
    jsonb_build_object('plate', v_plate, 'vehicle_type', p_type, 'metadata', v_meta));
  return v_id;
end;
$$;

create or replace function public.owned_plate(p_plate_id uuid, p_uid uuid)
returns public.plates
language plpgsql
set search_path = ''
as $$
declare
  v public.plates;
begin
  select * into v from public.plates where id = p_plate_id and burned_at is null for update;
  if not found then
    raise exception 'Targa inesistente o rottamata';
  end if;
  if v.owner_id is distinct from p_uid then
    raise exception 'Questa targa non è nel tuo garage';
  end if;
  return v;
end;
$$;

create or replace function public.transfer_plate(p_plate_id uuid, p_to_code text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := public.require_user();
  v_plate public.plates := public.owned_plate(p_plate_id, v_uid);
  v_to uuid;
begin
  select id into v_to from public.profiles where garage_code = upper(trim(p_to_code));
  if v_to is null then
    raise exception 'Nessun garage con il codice %', upper(trim(p_to_code));
  end if;
  if v_to = v_uid then
    raise exception 'La targa è già nel tuo garage';
  end if;
  update public.plates set owner_id = v_to where id = v_plate.id;
  perform public.append_event(v_plate.id, 'TRANSFER', v_uid, v_to, '{}'::jsonb);
end;
$$;

create or replace function public.update_plate(p_plate_id uuid, p_metadata jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := public.require_user();
  v_plate public.plates := public.owned_plate(p_plate_id, v_uid);
  -- Le bande (provincia, anno) restano quelle della certificazione.
  v_changes jsonb := public.clean_metadata(coalesce(p_metadata, '{}'::jsonb), false);
  v_meta jsonb := (v_plate.metadata - 'alias' - 'make' - 'model' - 'color') || v_changes;
begin
  update public.plates set metadata = v_meta where id = v_plate.id;
  perform public.append_event(v_plate.id, 'UPDATE', v_uid, null, jsonb_build_object('changes', v_changes));
end;
$$;

create or replace function public.burn_plate(p_plate_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := public.require_user();
  v_plate public.plates := public.owned_plate(p_plate_id, v_uid);
begin
  update public.plates set burned_at = now(), owner_id = null where id = v_plate.id;
  perform public.append_event(v_plate.id, 'BURN', v_uid, null, '{}'::jsonb);
end;
$$;

-- Ricalcola tutta la catena: restituisce il primo evento alterato, se c'è.
create or replace function public.verify_chain()
returns table (ok boolean, broken_id bigint, total integer)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  e record;
  v_prev text := repeat('0', 64);
  v_total integer := 0;
begin
  for e in select * from public.plate_events order by id loop
    v_total := v_total + 1;
    if e.prev_hash <> v_prev
       or e.hash <> public.event_hash(e.prev_hash, e.plate_id, e.type, e.from_id, e.to_id, e.data, e.created_at) then
      return query select false, e.id, v_total;
      return;
    end if;
    v_prev := e.hash;
  end loop;
  return query select true, null::bigint, v_total;
end;
$$;

-- Solo le API pubbliche sono richiamabili dai client autenticati.
revoke execute on all functions in schema public from public, anon, authenticated;
grant execute on function
  public.rename_garage(text),
  public.add_spin(),
  public.mint_plate(text, text, jsonb),
  public.transfer_plate(uuid, text),
  public.update_plate(uuid, jsonb),
  public.burn_plate(uuid),
  public.verify_chain(),
  public.is_valid_plate(text, text)
to authenticated;

-- Notifiche in tempo reale (es. targa ricevuta da un altro garage).
alter publication supabase_realtime add table public.plate_events;
