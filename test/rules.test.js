const test = require('node:test');
const assert = require('node:assert');
const R = require('../js/targa-rules.js');

test('accetta targhe auto valide', () => {
  assert.ok(R.validate('auto', 'GA 123 BC').valid);
  assert.strictEqual(R.validate('auto', 'ga123bc').formatted, 'GA 123 BC');
});

test('rifiuta lettere I, O, Q, U', () => {
  for (const p of ['IA123BC', 'GA123BO', 'QA123BC', 'GA123UC']) {
    assert.strictEqual(R.validate('auto', p).valid, false, p);
  }
});

test('rifiuta schema e lunghezza errati', () => {
  assert.strictEqual(R.validate('auto', 'GA12BC').valid, false);
  assert.strictEqual(R.validate('auto', '12ABC34').valid, false);
  assert.strictEqual(R.validate('moto', 'AB1234C').valid, false);
});

test('prefisso EE riservato', () => {
  assert.strictEqual(R.validate('auto', 'EE123AB').valid, false);
});

test('formati moto, ciclomotore e rimorchio', () => {
  assert.ok(R.validate('moto', 'EB12345').valid);
  assert.ok(R.validate('ciclomotore', 'X3B4CD').valid);
  assert.strictEqual(R.validate('ciclomotore', 'A3B4CD').valid, false);
  assert.ok(R.validate('rimorchio', 'XA123BC').valid);
  assert.strictEqual(R.validate('rimorchio', 'GA123BC').valid, false);
});

test('sequenza progressiva: numero, coppia finale, coppia iniziale', () => {
  assert.strictEqual(R.sequenceIndex('AA001AA'), 1);
  assert.strictEqual(R.sequenceIndex('AA999AA') + 1, R.sequenceIndex('AA000AB'));
  assert.strictEqual(R.sequenceIndex('AA999ZZ') + 1, R.sequenceIndex('AB000AA'));
  for (const p of ['GA123BC', 'HZ999ZZ', 'DX450KP']) {
    assert.strictEqual(R.plateFromIndex(R.sequenceIndex(p)), p);
  }
});

test('stima serie emessa', () => {
  const d = new Date('2026-10-30');
  assert.strictEqual(R.seriesInfo('AA001AA', d).issued, true);
  assert.strictEqual(R.seriesInfo('ZZ001AA', d).issued, false);
});

test('generazione casuale sempre valida', () => {
  for (const type of Object.keys(R.TYPES)) {
    for (let i = 0; i < 200; i++) {
      const p = R.randomPlate(type, { issuedOnly: true });
      assert.ok(R.validate(type, p).checks.every(c => c.ok), type + ' ' + p);
    }
  }
});

test('SVG contiene la targa formattata', () => {
  assert.match(R.toSVG('auto', 'GA123BC', { province: 'RM', year: 2026 }), /GA 123 BC/);
  assert.match(R.toSVG('moto', 'EB12345'), /12345/);
});
