/*
 * Archivio locale (modalità demo): registro nel browser, più garage sullo stesso dispositivo.
 * Espone la stessa interfaccia asincrona di store-supabase.js.
 */
(function (root) {
  'use strict';

  var Ledger = (root.TargaLedger || (typeof require !== 'undefined' && require('./ledger.js'))).Ledger;
  var SPINS_KEY = 'random-targa:spins';

  function LocalStore(options) {
    var opts = options || {};
    this.ledger = new Ledger({ storage: opts.storage });
    this.storage = this.ledger.storage;
    this.caps = { shared: false, multiGarage: true, backup: true, account: false };
  }

  function codeFor(address) {
    return 'RT-' + address.slice(2, 8).toUpperCase();
  }

  LocalStore.prototype.init = function () {
    return Promise.resolve({ needsOnboarding: !this.ledger.state.wallets.length });
  };

  LocalStore.prototype.readSpins = function () {
    try { return JSON.parse(this.storage.getItem(SPINS_KEY)) || {}; } catch (e) { return {}; }
  };

  LocalStore.prototype.load = function () {
    var self = this;
    var ledger = this.ledger;
    var spins = this.readSpins();
    var active = ledger.activeWallet();
    var events = [];
    ledger.state.chain.forEach(function (b) {
      b.txs.forEach(function (tx) {
        var tok = ledger.tokens[tx.tokenId];
        if (!tok) return;
        events.push({
          id: b.index, type: tx.type, plateId: tx.tokenId, plate: tok.plate, vehicleType: tok.vehicleType,
          from: tx.from || null, to: tx.to || null,
          metadata: tx.type === 'MINT' ? tx.metadata : tx.changes, at: b.timestamp
        });
      });
    });
    return Promise.resolve({
      me: active ? { id: active.address, name: active.name, code: codeFor(active.address) } : null,
      garages: ledger.state.wallets.map(function (w) {
        return { id: w.address, name: w.name, code: codeFor(w.address), spins: spins[w.address] || 0 };
      }),
      plates: ledger.allTokens().filter(function (t) { return !t.burned; }).map(function (t) {
        return { id: t.tokenId, plate: t.plate, vehicleType: t.vehicleType, owner: t.owner, metadata: t.metadata || {}, mintedAt: t.mintedAt };
      }),
      events: events
    }).then(function (data) { self.cache = data; return data; });
  };

  LocalStore.prototype.wrap = function (fn) {
    try { return Promise.resolve(fn()); } catch (e) { return Promise.reject(e); }
  };

  LocalStore.prototype.me = function () {
    var w = this.ledger.activeWallet();
    if (!w) throw new Error('Apri prima un garage');
    return w;
  };

  LocalStore.prototype.createGarage = function (name) {
    var self = this;
    return this.wrap(function () {
      var w = self.ledger.addWallet(name);
      self.ledger.setActiveWallet(w.address);
    });
  };

  LocalStore.prototype.switchGarage = function (id) {
    var self = this;
    return this.wrap(function () { self.ledger.setActiveWallet(id); });
  };

  LocalStore.prototype.renameGarage = function (name) {
    var self = this;
    return this.wrap(function () { self.ledger.renameWallet(self.me().address, name); });
  };

  LocalStore.prototype.garageByCode = function (code) {
    var c = String(code || '').trim().toUpperCase();
    var w = this.ledger.state.wallets.filter(function (x) { return codeFor(x.address) === c; })[0];
    return w ? { id: w.address, name: w.name, code: c } : null;
  };

  LocalStore.prototype.findGarageByCode = function (code) {
    return Promise.resolve(this.garageByCode(code));
  };

  LocalStore.prototype.mint = function (plate, vehicleType, metadata) {
    var self = this;
    return this.wrap(function () {
      self.ledger.mint({ plate: plate, vehicleType: vehicleType, owner: self.me().address, metadata: metadata });
    });
  };

  LocalStore.prototype.transfer = function (plateId, toCode) {
    var self = this;
    return this.wrap(function () {
      var to = self.garageByCode(toCode);
      if (!to) throw new Error('Nessun garage con il codice ' + String(toCode).toUpperCase());
      self.ledger.transfer(plateId, self.me().address, to.id);
    });
  };

  LocalStore.prototype.update = function (plateId, changes) {
    var self = this;
    return this.wrap(function () { self.ledger.update(plateId, self.me().address, changes); });
  };

  LocalStore.prototype.burn = function (plateId) {
    var self = this;
    return this.wrap(function () { self.ledger.burn(plateId, self.me().address); });
  };

  LocalStore.prototype.addSpin = function () {
    var self = this;
    return this.wrap(function () {
      var all = self.readSpins();
      var id = self.me().address;
      all[id] = (all[id] || 0) + 1;
      try { self.storage.setItem(SPINS_KEY, JSON.stringify(all)); } catch (e) { /* noop */ }
    });
  };

  LocalStore.prototype.verify = function () {
    var v = this.ledger.verify();
    return Promise.resolve({ ok: v.ok, total: v.blocks || this.ledger.state.chain.length, broken: v.ok ? null : v.block });
  };

  LocalStore.prototype.exportBackup = function () {
    return this.ledger.exportJSON(true);
  };

  LocalStore.prototype.importBackup = function (text) {
    var self = this;
    return this.wrap(function () { self.ledger.importJSON(text); });
  };

  LocalStore.prototype.reset = function () {
    var self = this;
    return this.wrap(function () {
      self.ledger.reset();
      try { self.storage.removeItem(SPINS_KEY); } catch (e) { /* noop */ }
    });
  };

  LocalStore.prototype.onEvent = function () { /* nessun aggiornamento remoto */ };

  if (typeof module !== 'undefined' && module.exports) module.exports = { LocalStore: LocalStore };
  else root.LocalStore = LocalStore;
})(typeof window !== 'undefined' ? window : globalThis);
