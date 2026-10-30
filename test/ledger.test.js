const test = require('node:test');
const assert = require('node:assert');
const crypto = require('node:crypto');
const { Ledger, sha256, memoryStorage } = require('../js/ledger.js');

function setup() {
  const ledger = new Ledger({ storage: memoryStorage() });
  const a = ledger.addWallet('A');
  const b = ledger.addWallet('B');
  return { ledger, a, b };
}

test('sha256 coincide con node:crypto', () => {
  for (const s of ['', 'abc', 'targa è €'.repeat(40)]) {
    assert.strictEqual(sha256(s), crypto.createHash('sha256').update(s).digest('hex'));
  }
});

test('conio, unicità e garage', () => {
  const { ledger, a } = setup();
  ledger.mint({ plate: 'GA123BC', vehicleType: 'auto', owner: a.address, metadata: { make: 'Fiat' } });
  assert.strictEqual(ledger.tokensOf(a.address).length, 1);
  assert.throws(() => ledger.mint({ plate: 'GA123BC', vehicleType: 'auto', owner: a.address }), /già tokenizzata/);
  assert.ok(ledger.verify().ok);
});

test('trasferimento, aggiornamento e burn', () => {
  const { ledger, a, b } = setup();
  const { tx } = ledger.mint({ plate: 'GA123BC', vehicleType: 'auto', owner: a.address });
  assert.throws(() => ledger.transfer(tx.tokenId, b.address, a.address), /proprietario/);
  ledger.transfer(tx.tokenId, a.address, b.address);
  assert.strictEqual(ledger.tokensOf(b.address).length, 1);
  ledger.update(tx.tokenId, b.address, { color: 'Blu' });
  assert.strictEqual(ledger.tokens[tx.tokenId].metadata.color, 'Blu');
  ledger.burn(tx.tokenId, b.address);
  assert.strictEqual(ledger.tokensOf(b.address).length, 0);
  // Dopo il burn la targa può essere coniata di nuovo.
  ledger.mint({ plate: 'GA123BC', vehicleType: 'auto', owner: a.address });
  assert.ok(ledger.verify().ok);
});

test('la manomissione viene rilevata e persiste tra istanze', () => {
  const storage = memoryStorage();
  const ledger = new Ledger({ storage });
  const a = ledger.addWallet('A');
  ledger.mint({ plate: 'GA123BC', vehicleType: 'auto', owner: a.address });
  const reloaded = new Ledger({ storage });
  assert.strictEqual(reloaded.tokensOf(a.address).length, 1);
  reloaded.state.chain[1].txs[0].plate = 'GA999BC';
  assert.strictEqual(reloaded.verify().ok, false);
});

test('export/import', () => {
  const { ledger, a } = setup();
  ledger.mint({ plate: 'GA123BC', vehicleType: 'auto', owner: a.address });
  const other = new Ledger({ storage: memoryStorage() });
  other.importJSON(ledger.exportJSON(true));
  assert.strictEqual(other.tokensOf(a.address).length, 1);
  const bad = JSON.parse(ledger.exportJSON(true));
  bad.chain[1].prevHash = 'x';
  assert.throws(() => other.importJSON(JSON.stringify(bad)), /corrotto/);
});
