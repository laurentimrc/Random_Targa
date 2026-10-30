const test = require('node:test');
const assert = require('node:assert');
const G = require('../js/game.js');
const { memoryStorage } = require('../js/ledger.js');
const { LocalStore } = require('../js/store-local.js');

test('rarità delle combinazioni', () => {
  assert.strictEqual(G.analyze('auto', 'GA 123 BC').tier, 'rara'); // scala
  assert.strictEqual(G.analyze('auto', 'GA 482 BC').tier, 'comune');
  assert.strictEqual(G.analyze('auto', 'AB 121 BA').tier, 'leggendaria'); // palindroma
  assert.strictEqual(G.analyze('auto', 'GA 777 BC').tier, 'epica');
  assert.strictEqual(G.analyze('auto', 'GA 777 GA').tier, 'leggendaria'); // 2 tratti rari: bonus
  assert.strictEqual(G.analyze('auto', 'GA 482 RM', { province: 'RM' }).tier, 'rara');
  assert.strictEqual(G.analyze('moto', 'EB 55555').tier, 'epica');
  assert.strictEqual(G.analyze('ciclomotore', 'X007AB').tier, 'epica');
});

test('livelli', () => {
  assert.strictEqual(G.levelFor(0).level, 1);
  assert.strictEqual(G.levelFor(150).level, 2);
  assert.strictEqual(G.levelFor(99999).next, null);
  assert.ok(Math.abs(G.levelFor(275).progress - 0.5) < 1e-9);
});

test('XP e trofei ricavati dagli eventi', async () => {
  const store = new LocalStore({ storage: memoryStorage() });
  await store.createGarage('B');
  const b = (await store.load()).me;
  await store.createGarage('A');
  let data = await store.load();
  const a = data.me;
  await store.mint('GA777BC', 'auto', {});
  data = await store.load();
  const plateId = data.plates[0].id;
  await store.update(plateId, { color: 'Rosso' });
  await store.transfer(plateId, b.code);
  data = await store.load();
  const s = G.stats({ id: a.id, events: data.events, owned: 0, spins: 3 });
  assert.strictEqual(s.xp, 400 + 20 + 75 + 6);
  const unlocked = G.achievements(s).filter(x => x.unlocked).map(x => x.id);
  assert.deepStrictEqual(unlocked.sort(), ['epic', 'first', 'gift', 'rare'].sort());
  assert.strictEqual(G.stats({ id: b.id, events: data.events }).xp, 25);
  assert.strictEqual(G.stats({ id: a.id, events: data.events, spins: 1000 }).xp, 400 + 20 + 75 + 200);
});
