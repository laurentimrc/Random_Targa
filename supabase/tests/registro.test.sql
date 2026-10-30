-- Scenari del registro: eseguire dopo stub-supabase.sql e la migrazione.
\set ON_ERROR_STOP on
\o /dev/null

insert into auth.users (id) values
  ('00000000-0000-0000-0000-00000000000a'),
  ('00000000-0000-0000-0000-00000000000b');

create function pg_temp.as_user(p uuid) returns void language sql as $$
  select set_config('request.jwt.claim.sub', coalesce(p::text, ''), false)
$$;

create function pg_temp.expect_error(p_sql text, p_like text) returns void language plpgsql as $$
begin
  execute p_sql;
  raise exception 'ATTESO ERRORE (%): %', p_like, p_sql;
exception when others then
  if sqlerrm not ilike '%' || p_like || '%' then
    raise exception 'Errore inatteso per %: % (atteso %)', p_sql, sqlerrm, p_like;
  end if;
end $$;

grant execute on all functions in schema pg_temp to authenticated;

set role authenticated;

-- Profili creati in automatico
select pg_temp.as_user('00000000-0000-0000-0000-00000000000a');
do $$ begin
  assert (select count(*) from public.profiles) = 2, 'due profili';
  assert (select garage_code from public.profiles limit 1) ~ '^RT-[0-9A-F]{6}$', 'codice garage';
end $$;
select public.rename_garage('Garage di Marco');
select public.add_spin();
do $$ begin
  assert (select garage_name || onboarded::text || spins from public.profiles where id = auth.uid()) = 'Garage di Marcotrue1';
end $$;

-- Conio, unicità e regole
select public.mint_plate('ga 777 ga', 'auto', '{"alias":"La Saetta","province":"RM","year":2021,"hack":"x"}');
do $$ begin
  assert (select metadata from public.plates where plate = 'GA777GA') = '{"alias":"La Saetta","province":"RM","year":2021}'::jsonb, 'metadati puliti';
end $$;
select pg_temp.expect_error($$select public.mint_plate('GA777GA', 'auto')$$, 'già stata certificata');
select pg_temp.expect_error($$select public.mint_plate('GI777GA', 'auto')$$, 'non rispetta');
select pg_temp.expect_error($$select public.mint_plate('EE123AB', 'auto')$$, 'non rispetta');
select pg_temp.expect_error($$select public.mint_plate('GA123BC', 'rimorchio')$$, 'non rispetta');
select public.mint_plate('EB12345', 'moto');
select public.mint_plate('X3B4CD', 'ciclomotore');
select public.mint_plate('XA123BC', 'rimorchio');

-- Nessuna scrittura diretta
select pg_temp.expect_error($$insert into public.plates (plate, vehicle_type) values ('AB123CD', 'auto')$$, 'permission denied');
select pg_temp.expect_error($$update public.profiles set spins = 999$$, 'permission denied');
select pg_temp.expect_error($$delete from public.plate_events$$, 'permission denied');
select pg_temp.expect_error($$select public.append_event(gen_random_uuid(), 'MINT', null, null, '{}')$$, 'permission denied');

-- Personalizzazione: le bande restano quelle originali
select public.update_plate((select id from public.plates where plate = 'GA777GA'), '{"color":"Rosso","province":"MI"}');
do $$ begin
  assert (select metadata from public.plates where plate = 'GA777GA') = '{"color":"Rosso","province":"RM","year":2021}'::jsonb, 'update';
end $$;

-- Cessione
select pg_temp.expect_error($$select public.transfer_plate((select id from public.plates where plate = 'GA777GA'), 'RT-000000')$$, 'Nessun garage');
select public.transfer_plate((select id from public.plates where plate = 'GA777GA'),
  (select lower(garage_code) from public.profiles where id = '00000000-0000-0000-0000-00000000000b'));

-- L'utente A non può più agire sulla targa; B sì
select pg_temp.expect_error($$select public.burn_plate((select id from public.plates where plate = 'GA777GA'))$$, 'non è nel tuo garage');
select pg_temp.as_user('00000000-0000-0000-0000-00000000000b');
select public.burn_plate((select id from public.plates where plate = 'GA777GA'));
select pg_temp.expect_error($$select public.update_plate((select id from public.plates where plate = 'GA777GA'), '{}')$$, 'rottamata');

-- Dopo la rottamazione la combinazione torna libera
select public.mint_plate('GA777GA', 'auto');

-- Utente non autenticato
select pg_temp.as_user(null);
select pg_temp.expect_error($$select public.mint_plate('AB123CD', 'auto')$$, 'Accesso richiesto');

-- Catena integra
do $$ begin
  assert (select ok from public.verify_chain()), 'catena valida';
  assert (select total from public.verify_chain()) = 8, 'otto eventi';
end $$;

-- Manomissione rilevata (come amministratore)
reset role;
update public.plate_events set data = '{"plate":"ZZ999ZZ"}' where id = 2;
do $$ begin
  assert not (select ok from public.verify_chain()), 'manomissione rilevata';
  assert (select broken_id from public.verify_chain()) = 2, 'evento alterato';
end $$;

\o
\echo 'TUTTI I TEST DEL DATABASE SONO PASSATI'
