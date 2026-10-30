/*
 * Registro di tokenizzazione delle targhe.
 *
 * Un piccolo ledger a blocchi concatenati (hash SHA-256 + proof-of-work leggera)
 * che gestisce token non fungibili sullo stile ERC-721: ogni targa può essere
 * coniata una sola volta, poi trasferita, aggiornata o bruciata dal proprietario.
 * Lo stato è persistito nel browser (localStorage) ed esportabile in JSON.
 */
(function (root) {
  'use strict';

  var STORAGE_KEY = 'random-targa:ledger:v1';
  var DIFFICULTY = 3; // numero di zeri esadecimali iniziali richiesti all'hash

  // --- SHA-256 (implementazione sincrona, indipendente da crypto.subtle) ---
  var K = [
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
    0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
    0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
    0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
    0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
    0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
    0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2
  ];

  function utf8Bytes(str) {
    if (typeof TextEncoder !== 'undefined') return Array.from(new TextEncoder().encode(str));
    return unescape(encodeURIComponent(str)).split('').map(function (c) { return c.charCodeAt(0); });
  }

  function sha256(message) {
    var bytes = utf8Bytes(String(message));
    var bitLen = bytes.length * 8;
    bytes.push(0x80);
    while (bytes.length % 64 !== 56) bytes.push(0);
    var hi = Math.floor(bitLen / 0x100000000);
    for (var s = 3; s >= 0; s--) bytes.push((hi >>> (s * 8)) & 0xff);
    for (var t = 3; t >= 0; t--) bytes.push((bitLen >>> (t * 8)) & 0xff);

    var H = [0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19];
    var W = new Array(64);
    for (var off = 0; off < bytes.length; off += 64) {
      for (var i = 0; i < 16; i++) {
        W[i] = (bytes[off + i * 4] << 24) | (bytes[off + i * 4 + 1] << 16) |
          (bytes[off + i * 4 + 2] << 8) | bytes[off + i * 4 + 3];
      }
      for (i = 16; i < 64; i++) {
        var x = W[i - 15], y = W[i - 2];
        var s0 = rotr(x, 7) ^ rotr(x, 18) ^ (x >>> 3);
        var s1 = rotr(y, 17) ^ rotr(y, 19) ^ (y >>> 10);
        W[i] = (W[i - 16] + s0 + W[i - 7] + s1) | 0;
      }
      var a = H[0], b = H[1], c = H[2], d = H[3], e = H[4], f = H[5], g = H[6], h = H[7];
      for (i = 0; i < 64; i++) {
        var S1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
        var ch = (e & f) ^ (~e & g);
        var t1 = (h + S1 + ch + K[i] + W[i]) | 0;
        var S0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
        var maj = (a & b) ^ (a & c) ^ (b & c);
        var t2 = (S0 + maj) | 0;
        h = g; g = f; f = e; e = (d + t1) | 0;
        d = c; c = b; b = a; a = (t1 + t2) | 0;
      }
      H[0] = (H[0] + a) | 0; H[1] = (H[1] + b) | 0; H[2] = (H[2] + c) | 0; H[3] = (H[3] + d) | 0;
      H[4] = (H[4] + e) | 0; H[5] = (H[5] + f) | 0; H[6] = (H[6] + g) | 0; H[7] = (H[7] + h) | 0;
    }
    return H.map(function (v) { return ('00000000' + (v >>> 0).toString(16)).slice(-8); }).join('');
  }

  function rotr(x, n) { return (x >>> n) | (x << (32 - n)); }

  function randomHex(bytes) {
    var out = '';
    var c = root.crypto || (typeof globalThis !== 'undefined' && globalThis.crypto);
    if (c && c.getRandomValues) {
      var arr = new Uint8Array(bytes);
      c.getRandomValues(arr);
      for (var i = 0; i < arr.length; i++) out += ('0' + arr[i].toString(16)).slice(-2);
      return out;
    }
    for (var j = 0; j < bytes; j++) out += ('0' + Math.floor(Math.random() * 256).toString(16)).slice(-2);
    return out;
  }

  // --- Wallet ---
  function createWallet(name) {
    var privateKey = randomHex(32);
    return {
      name: name || 'Il mio garage',
      address: '0x' + sha256(privateKey).slice(24),
      privateKey: privateKey,
      createdAt: new Date().toISOString()
    };
  }

  // --- Blocchi ---
  function blockPayload(b) {
    return b.index + '|' + b.timestamp + '|' + b.prevHash + '|' + JSON.stringify(b.txs) + '|' + b.nonce;
  }

  function mine(block) {
    var target = new Array(DIFFICULTY + 1).join('0');
    block.nonce = 0;
    block.hash = sha256(blockPayload(block));
    while (block.hash.slice(0, DIFFICULTY) !== target) {
      block.nonce++;
      block.hash = sha256(blockPayload(block));
    }
    return block;
  }

  function genesis() {
    return mine({
      index: 0,
      timestamp: '2026-01-01T00:00:00.000Z',
      prevHash: '0'.repeat(64),
      txs: [{ type: 'GENESIS', note: 'Registro Targhe Italiane' }],
      nonce: 0
    });
  }

  function memoryStorage() {
    var data = {};
    return {
      getItem: function (k) { return Object.prototype.hasOwnProperty.call(data, k) ? data[k] : null; },
      setItem: function (k, v) { data[k] = String(v); },
      removeItem: function (k) { delete data[k]; }
    };
  }

  function defaultStorage() {
    try {
      var s = root.localStorage;
      s.setItem('__rt_test', '1');
      s.removeItem('__rt_test');
      return s;
    } catch (e) {
      return memoryStorage();
    }
  }

  function Ledger(options) {
    var opts = options || {};
    this.storage = opts.storage || defaultStorage();
    this.now = opts.now || function () { return new Date().toISOString(); };
    this.load();
  }

  Ledger.prototype.load = function () {
    var raw = null;
    try { raw = this.storage.getItem(STORAGE_KEY); } catch (e) { raw = null; }
    var state = raw ? safeParse(raw) : null;
    if (!state || !Array.isArray(state.chain)) {
      state = { chain: [genesis()], wallets: [], activeWallet: null };
    }
    this.state = state;
    this.rebuild();
  };

  Ledger.prototype.save = function () {
    try { this.storage.setItem(STORAGE_KEY, JSON.stringify(this.state)); } catch (e) { /* quota */ }
  };

  Ledger.prototype.reset = function () {
    try { this.storage.removeItem(STORAGE_KEY); } catch (e) { /* noop */ }
    this.load();
  };

  // Ricostruisce lo stato dei token rieseguendo tutte le transazioni.
  Ledger.prototype.rebuild = function () {
    var tokens = {};
    this.state.chain.forEach(function (block) {
      block.txs.forEach(function (tx) { applyTx(tokens, tx, block); });
    });
    this.tokens = tokens;
  };

  function applyTx(tokens, tx, block) {
    var tok = tokens[tx.tokenId];
    if (tx.type === 'MINT') {
      tokens[tx.tokenId] = {
        tokenId: tx.tokenId,
        plate: tx.plate,
        vehicleType: tx.vehicleType,
        owner: tx.to,
        metadata: tx.metadata,
        mintedAt: block.timestamp,
        mintBlock: block.index,
        burned: false,
        history: [{ type: 'MINT', to: tx.to, at: block.timestamp, block: block.index, txHash: tx.hash }]
      };
    } else if (tok && tx.type === 'TRANSFER') {
      tok.owner = tx.to;
      tok.history.push({ type: 'TRANSFER', from: tx.from, to: tx.to, at: block.timestamp, block: block.index, txHash: tx.hash });
    } else if (tok && tx.type === 'UPDATE') {
      tok.metadata = Object.assign({}, tok.metadata, tx.changes);
      tok.history.push({ type: 'UPDATE', by: tx.from, at: block.timestamp, block: block.index, txHash: tx.hash });
    } else if (tok && tx.type === 'BURN') {
      tok.burned = true;
      tok.owner = null;
      tok.history.push({ type: 'BURN', from: tx.from, at: block.timestamp, block: block.index, txHash: tx.hash });
    }
  }

  Ledger.prototype.lastBlock = function () {
    return this.state.chain[this.state.chain.length - 1];
  };

  Ledger.prototype.commit = function (tx) {
    tx.hash = '0x' + sha256(JSON.stringify(tx) + this.lastBlock().hash);
    var block = mine({
      index: this.state.chain.length,
      timestamp: this.now(),
      prevHash: this.lastBlock().hash,
      txs: [tx],
      nonce: 0
    });
    this.state.chain.push(block);
    this.rebuild();
    this.save();
    return { block: block, tx: tx };
  };

  Ledger.prototype.tokenIdFor = function (plate, vehicleType) {
    return '0x' + sha256('IT-PLATE:' + vehicleType + ':' + plate);
  };

  Ledger.prototype.findByPlate = function (plate, vehicleType) {
    var t = this.tokens[this.tokenIdFor(plate, vehicleType)];
    return t && !t.burned ? t : null;
  };

  Ledger.prototype.mint = function (params) {
    var wallet = this.requireWallet(params.owner);
    var tokenId = this.tokenIdFor(params.plate, params.vehicleType);
    if (this.tokens[tokenId] && !this.tokens[tokenId].burned) {
      throw new Error('La targa ' + params.plate + ' è già tokenizzata');
    }
    return this.commit({
      type: 'MINT',
      tokenId: tokenId,
      plate: params.plate,
      vehicleType: params.vehicleType,
      to: wallet.address,
      metadata: params.metadata || {},
      signature: this.sign(wallet, tokenId)
    });
  };

  Ledger.prototype.transfer = function (tokenId, fromAddress, toAddress) {
    var tok = this.requireOwned(tokenId, fromAddress);
    if (!/^0x[0-9a-f]{40}$/i.test(toAddress)) throw new Error('Indirizzo destinatario non valido');
    if (toAddress.toLowerCase() === tok.owner.toLowerCase()) throw new Error('Il destinatario è già il proprietario');
    var wallet = this.requireWallet(fromAddress);
    return this.commit({
      type: 'TRANSFER', tokenId: tokenId, from: fromAddress, to: toAddress.toLowerCase(),
      signature: this.sign(wallet, tokenId + toAddress)
    });
  };

  Ledger.prototype.update = function (tokenId, fromAddress, changes) {
    this.requireOwned(tokenId, fromAddress);
    var wallet = this.requireWallet(fromAddress);
    return this.commit({
      type: 'UPDATE', tokenId: tokenId, from: fromAddress, changes: changes,
      signature: this.sign(wallet, tokenId + JSON.stringify(changes))
    });
  };

  Ledger.prototype.burn = function (tokenId, fromAddress) {
    this.requireOwned(tokenId, fromAddress);
    var wallet = this.requireWallet(fromAddress);
    return this.commit({
      type: 'BURN', tokenId: tokenId, from: fromAddress,
      signature: this.sign(wallet, 'burn' + tokenId)
    });
  };

  Ledger.prototype.requireOwned = function (tokenId, address) {
    var tok = this.tokens[tokenId];
    if (!tok || tok.burned) throw new Error('Token inesistente o bruciato');
    if (tok.owner.toLowerCase() !== String(address).toLowerCase()) throw new Error('Non sei il proprietario di questo token');
    return tok;
  };

  Ledger.prototype.requireWallet = function (address) {
    var w = this.state.wallets.filter(function (x) { return x.address === address; })[0];
    if (!w) throw new Error('Wallet non trovato');
    return w;
  };

  // Firma simulata: HMAC-like con la chiave privata del wallet locale.
  Ledger.prototype.sign = function (wallet, payload) {
    return '0x' + sha256(wallet.privateKey + ':' + payload);
  };

  Ledger.prototype.addWallet = function (name) {
    var w = createWallet(name);
    this.state.wallets.push(w);
    if (!this.state.activeWallet) this.state.activeWallet = w.address;
    this.save();
    return w;
  };

  Ledger.prototype.setActiveWallet = function (address) {
    this.requireWallet(address);
    this.state.activeWallet = address;
    this.save();
  };

  Ledger.prototype.activeWallet = function () {
    var a = this.state.activeWallet;
    return this.state.wallets.filter(function (w) { return w.address === a; })[0] || null;
  };

  Ledger.prototype.tokensOf = function (address) {
    var self = this;
    return Object.keys(this.tokens).map(function (k) { return self.tokens[k]; })
      .filter(function (t) { return !t.burned && t.owner && t.owner.toLowerCase() === String(address).toLowerCase(); })
      .sort(function (a, b) { return b.mintBlock - a.mintBlock; });
  };

  Ledger.prototype.allTokens = function () {
    var self = this;
    return Object.keys(this.tokens).map(function (k) { return self.tokens[k]; });
  };

  // Verifica l'integrità della catena: hash, collegamenti e proof-of-work.
  Ledger.prototype.verify = function () {
    var chain = this.state.chain;
    var target = new Array(DIFFICULTY + 1).join('0');
    for (var i = 0; i < chain.length; i++) {
      var b = chain[i];
      if (sha256(blockPayload(b)) !== b.hash) return { ok: false, block: i, reason: 'Hash del blocco non corrispondente' };
      if (b.hash.slice(0, DIFFICULTY) !== target) return { ok: false, block: i, reason: 'Proof-of-work non valida' };
      if (i > 0 && b.prevHash !== chain[i - 1].hash) return { ok: false, block: i, reason: 'Collegamento al blocco precedente interrotto' };
    }
    return { ok: true, blocks: chain.length };
  };

  Ledger.prototype.exportJSON = function (includeKeys) {
    var copy = JSON.parse(JSON.stringify(this.state));
    if (!includeKeys) copy.wallets.forEach(function (w) { delete w.privateKey; });
    return JSON.stringify(copy, null, 2);
  };

  Ledger.prototype.importJSON = function (text) {
    var state = safeParse(text);
    if (!state || !Array.isArray(state.chain) || !Array.isArray(state.wallets)) throw new Error('File non valido');
    var previous = this.state;
    this.state = state;
    var check = this.verify();
    if (!check.ok) {
      this.state = previous;
      throw new Error('Registro corrotto al blocco ' + check.block + ': ' + check.reason);
    }
    this.rebuild();
    this.save();
  };

  function safeParse(text) {
    try { return JSON.parse(text); } catch (e) { return null; }
  }

  var api = { Ledger: Ledger, sha256: sha256, createWallet: createWallet, memoryStorage: memoryStorage, DIFFICULTY: DIFFICULTY };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.TargaLedger = api;
})(typeof window !== 'undefined' ? window : globalThis);
