const test = require('node:test');
const assert = require('node:assert');
const { memoryStorage } = require('../js/ledger.js');
const { LocalStore } = require('../js/store-local.js');

test('modalità demo: garage, conio, cessione per codice e giri della ruota', async () => {
  const store = new LocalStore({ storage: memoryStorage() });
  assert.deepStrictEqual(await store.init(), { needsOnboarding: true });
  await store.createGarage('Luca');
  const luca = (await store.load()).me;
  assert.match(luca.code, /^RT-[0-9A-F]{6}$/);
  await store.createGarage('Marco');
  await store.mint('GA123BC', 'auto', { alias: 'Panda' });
  await assert.rejects(store.mint('GA123BC', 'auto', {}), /già tokenizzata/);
  await assert.rejects(store.transfer('x', 'RT-000000'), /Nessun garage/);
  let data = await store.load();
  assert.strictEqual(data.plates[0].metadata.alias, 'Panda');
  await store.transfer(data.plates[0].id, luca.code.toLowerCase());
  await store.addSpin();
  data = await store.load();
  assert.strictEqual(data.plates[0].owner, luca.id);
  assert.deepStrictEqual(data.events.map(e => e.type), ['MINT', 'TRANSFER']);
  assert.strictEqual(data.garages.find(g => g.id === data.me.id).spins, 1);
  assert.strictEqual((await store.verify()).ok, true);
});
