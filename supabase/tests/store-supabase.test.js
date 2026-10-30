/*
 * Prova js/store-supabase.js contro lo schema reale su un Postgres locale.
 * Un finto client supabase-js traduce query e RPC in SQL eseguito con il ruolo
 * "authenticated" e l'utente della sessione, come farebbe PostgREST.
 * Avviato da supabase/tests/run.sh (serve PGDATABASE).
 */
const test = require('node:test');
const assert = require('node:assert');
const { execFileSync } = require('node:child_process');
const { SupabaseStore } = require('../../js/store-supabase.js');
const G = require('../../js/game.js');

function lit(v) {
  return v === null ? 'null' : '$v$' + String(v) + '$v$';
}

function sql(query, uid) {
  // SET non produce output: psql stampa solo il risultato JSON della query.
  const full = "set role authenticated; set request.jwt.claim.sub = '" + (uid || '') + "'; " + query;
  try {
    const out = execFileSync('psql', ['-qAtX', '-v', 'ON_ERROR_STOP=1', '-c', full], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    return { data: out.trim() ? JSON.parse(out.trim()) : null, error: null };
  } catch (e) {
    const m = /ERROR:\s+(.*)/.exec(e.stderr || '');
    return { data: null, error: { message: m ? m[1] : e.message } };
  }
}

function fakeClient() {
  let user = null;
  const client = {
    auth: {
      getSession: async () => ({ data: { session: user ? { user } : null } }),
      signInAnonymously: async () => {
        const id = execFileSync('psql', ['-qAtX', '-c', 'insert into auth.users default values returning id'], { encoding: 'utf8' }).trim().split('\n')[0];
        user = { id, is_anonymous: true, email: null };
        return { data: { user }, error: null };
      }
    },
    from(table) {
      const q = { where: [], cols: '*', order: '', limit: '', one: false };
      const b = {
        select(c) { q.cols = c; return b; },
        eq(c, v) { q.where.push(c + ' = ' + lit(v)); return b; },
        is(c) { q.where.push(c + ' is null'); return b; },
        order(c, o) { q.order = ' order by ' + c + (o && o.ascending === false ? ' desc' : ' asc'); return b; },
        range(a, z) { q.limit = ' limit ' + (z - a + 1) + ' offset ' + a; return b; },
        single() { q.one = true; return b; },
        then(resolve, reject) {
          const where = q.where.length ? ' where ' + q.where.join(' and ') : '';
          const r = sql("select coalesce(json_agg(t), '[]') from (select " + q.cols + ' from public.' + table + where + q.order + q.limit + ') t', user && user.id);
          if (q.one && r.data) r.data = r.data[0];
          return Promise.resolve(r).then(resolve, reject);
        }
      };
      return b;
    },
    rpc: async (name, args) => {
      const params = Object.keys(args).map(k => {
        const v = args[k];
        return k + ' => ' + (v !== null && typeof v === 'object' ? lit(JSON.stringify(v)) + '::jsonb' : lit(v));
      }).join(', ');
      const query = name === 'verify_chain'
        ? 'select json_agg(t) from public.verify_chain() t'
        : 'select to_json(public.' + name + '(' + params + '))';
      return sql(query, user && user.id);
    }
  };
  return client;
}

test('registro condiviso: due utenti, unicità globale, cessione e statistiche', { skip: !process.env.PGDATABASE }, async () => {
  const marco = new SupabaseStore(fakeClient());
  const luca = new SupabaseStore(fakeClient());

  assert.deepStrictEqual(await marco.init(), { needsOnboarding: true });
  await marco.createGarage('Il garage di Marco');
  assert.deepStrictEqual(await marco.init(), { needsOnboarding: false });
  await luca.init();
  await luca.createGarage('Garage di Luca');

  let m = await marco.load();
  assert.strictEqual(m.me.name, 'Il garage di Marco');
  assert.strictEqual(m.me.anonymous, true);
  assert.match(m.me.code, /^RT-[0-9A-F]{6}$/);

  await marco.mint('GA777GA', 'auto', { alias: 'La Saetta', province: 'RM', year: '' });
  await assert.rejects(luca.mint('ga 777 ga', 'auto', {}), /già stata certificata/);
  await assert.rejects(luca.mint('GI777GA', 'auto', {}), /non rispetta/);
  await marco.addSpin();

  const l = await luca.load();
  m = await marco.load();
  const plate = m.plates.find(p => p.plate === 'GA777GA');
  assert.strictEqual(plate.owner, m.me.id);
  assert.deepStrictEqual(plate.metadata, { alias: 'La Saetta', province: 'RM' });
  await assert.rejects(luca.transfer(plate.id, m.me.code), /non è nel tuo garage/);

  await marco.update(plate.id, { color: 'Rosso' });
  assert.strictEqual((await marco.findGarageByCode(l.me.code.toLowerCase())).name, 'Garage di Luca');
  assert.strictEqual(await marco.findGarageByCode('RT-000000'), null);
  await marco.transfer(plate.id, l.me.code);

  const after = await luca.load();
  assert.strictEqual(after.plates.find(p => p.id === plate.id).owner, after.me.id);
  assert.deepStrictEqual(after.events.map(e => [e.type, e.plate]), [
    ['MINT', 'GA777GA'], ['UPDATE', 'GA777GA'], ['TRANSFER', 'GA777GA']
  ]);

  const marcoGarage = after.garages.find(g => g.name === 'Il garage di Marco');
  const s = G.stats({ id: marcoGarage.id, events: after.events, owned: 0, spins: marcoGarage.spins });
  assert.strictEqual(s.xp, 850 + 20 + 75 + 2);
  assert.strictEqual(G.stats({ id: after.me.id, events: after.events }).xp, 25);

  await luca.burn(plate.id);
  assert.strictEqual((await luca.load()).plates.length, 0);
  assert.deepStrictEqual(await luca.verify(), { ok: true, total: 4, broken: null });
});
