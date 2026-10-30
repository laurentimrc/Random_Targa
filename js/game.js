/*
 * Meccaniche di gioco: rarità delle combinazioni, punti esperienza, livelli e trofei.
 * Tutto è derivato dal registro, così i progressi seguono il garage anche dopo un ripristino.
 */
(function (root) {
  'use strict';

  var TIERS = [
    { id: 'comune', label: 'Comune', bonus: 0 },
    { id: 'non-comune', label: 'Non comune', bonus: 40 },
    { id: 'rara', label: 'Rara', bonus: 120 },
    { id: 'epica', label: 'Epica', bonus: 300 },
    { id: 'leggendaria', label: 'Leggendaria', bonus: 750 }
  ];

  var XP = { MINT: 100, TRANSFER_OUT: 75, TRANSFER_IN: 25, UPDATE: 20, BURN: 10, SPIN: 2, SPIN_CAP: 200 };

  var LEVELS = [
    [0, 'Foglio rosa'], [150, 'Neopatentato'], [400, 'Automobilista'], [800, 'Pilota'],
    [1400, 'Collezionista'], [2200, 'Intenditore'], [3200, 'Campione'], [4500, 'Maestro del volante'],
    [6000, 'Leggenda'], [8000, 'Mito su quattro ruote']
  ];

  function normalize(text) {
    return String(text || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  }

  function isPalindrome(s) {
    return s.length > 1 && s === s.split('').reverse().join('');
  }

  function allSame(s) {
    return s.length > 1 && s.split('').every(function (c) { return c === s[0]; });
  }

  function isSequence(s) {
    if (!/^\d+$/.test(s) || s.length < 3) return false;
    var up = true, down = true;
    for (var i = 1; i < s.length; i++) {
      var d = s.charCodeAt(i) - s.charCodeAt(i - 1);
      if (d !== 1) up = false;
      if (d !== -1) down = false;
    }
    return up || down;
  }

  /*
   * Caratteristiche speciali di una combinazione. Ogni tratto ha un livello di rarità (0-4);
   * la rarità finale è quella del tratto migliore, +1 se ci sono almeno due tratti rari.
   */
  function analyze(type, text, options) {
    var opts = options || {};
    var p = normalize(text);
    var traits = [];

    function add(label, tier) { traits.push({ label: label, tier: tier }); }

    if (type === 'auto' || type === 'rimorchio') {
      var head = p.slice(0, 2), num = p.slice(2, 5), tail = p.slice(5, 7);
      if (p.length === 7) {
        if (isPalindrome(p)) add('Palindroma', 4);
        if (num === '777') add('Jackpot 777', 3);
        else if (num === '007') add('Agente segreto', 3);
        else if (num === '001') add('Numero uno', 3);
        else if (allSame(num)) add('Tris di ' + num[0], 2);
        else if (isSequence(num)) add('Scala', 2);
        else if (/^[1-9]00$/.test(num)) add('Cifra tonda', 1);
        else if (['112', '113', '115', '118'].indexOf(num) !== -1) add("Numero d'emergenza", 1);
        if (head === tail) add('Coppie gemelle', 2);
        else if (allSame(head) && allSame(tail)) add('Doppia coppia', 2);
        else if (allSame(head) || allSame(tail)) add('Lettere doppie', 1);
        if (opts.province && (tail === opts.province || head === opts.province)) add('Orgoglio locale', 2);
        if (opts.issued === false) add('Dal futuro', 1);
        if (type === 'auto' && head === 'AA') add("Vintage '94", 1);
      }
    } else if (type === 'moto') {
      var digits = p.slice(2);
      if (p.length === 7) {
        if (allSame(digits)) add('Cinquina', 3);
        else if (isSequence(digits)) add('Scala reale', 3);
        else if (isPalindrome(digits)) add('Specchio', 2);
        else if (/000$/.test(digits)) add('Cifra tonda', 1);
        if (allSame(p.slice(0, 2))) add('Lettere doppie', 1);
      }
    } else if (type === 'ciclomotore') {
      var rest = p.slice(1);
      if (p.length === 6) {
        if (allSame(rest)) add('Monocromo', 3);
        else if (rest.indexOf('007') !== -1) add('Agente segreto', 3);
        else if (isPalindrome(rest)) add('Specchio', 2);
      }
    }

    var best = traits.reduce(function (m, t) { return Math.max(m, t.tier); }, 0);
    var rareCount = traits.filter(function (t) { return t.tier >= 2; }).length;
    if (rareCount >= 2) best = Math.min(4, best + 1);
    var tier = TIERS[best];
    return { tier: tier.id, rank: best, label: tier.label, bonus: tier.bonus, xp: XP.MINT + tier.bonus, traits: traits };
  }

  function levelFor(xp) {
    var i = 0;
    while (i < LEVELS.length - 1 && xp >= LEVELS[i + 1][0]) i++;
    var min = LEVELS[i][0];
    var next = LEVELS[i + 1] ? LEVELS[i + 1][0] : null;
    return {
      level: i + 1,
      name: LEVELS[i][1],
      min: min,
      next: next,
      nextName: LEVELS[i + 1] ? LEVELS[i + 1][1] : null,
      progress: next ? (xp - min) / (next - min) : 1
    };
  }

  // Statistiche di un garage ricavate dalle operazioni nel registro.
  function stats(ledger, address, extra) {
    var addr = String(address || '').toLowerCase();
    var s = {
      xp: 0, minted: 0, transfers: 0, received: 0, updates: 0, burns: 0,
      spins: (extra && extra.spins) || 0, types: {}, bestRank: 0, rarities: [0, 0, 0, 0, 0], owned: 0
    };
    ledger.state.chain.forEach(function (block) {
      block.txs.forEach(function (tx) {
        var from = String(tx.from || '').toLowerCase();
        var to = String(tx.to || '').toLowerCase();
        if (tx.type === 'MINT' && to === addr) {
          var r = analyze(tx.vehicleType, tx.plate, { province: tx.metadata && tx.metadata.province });
          s.minted++;
          s.xp += r.xp;
          s.types[tx.vehicleType] = true;
          s.rarities[r.rank]++;
          s.bestRank = Math.max(s.bestRank, r.rank);
        } else if (tx.type === 'TRANSFER' && from === addr) {
          s.transfers++; s.xp += XP.TRANSFER_OUT;
        } else if (tx.type === 'TRANSFER' && to === addr) {
          s.received++; s.xp += XP.TRANSFER_IN;
        } else if (tx.type === 'UPDATE' && from === addr) {
          s.updates++; s.xp += XP.UPDATE;
        } else if (tx.type === 'BURN' && from === addr) {
          s.burns++; s.xp += XP.BURN;
        }
      });
    });
    s.xp += Math.min(s.spins * XP.SPIN, XP.SPIN_CAP);
    s.typeCount = Object.keys(s.types).length;
    s.owned = ledger.tokensOf(address).length;
    s.level = levelFor(s.xp);
    return s;
  }

  var ACHIEVEMENTS = [
    { id: 'first', icon: '🔑', title: 'Primo giro di chiave', desc: 'Certifica la tua prima targa', goal: function (s) { return [s.minted, 1]; } },
    { id: 'spin10', icon: '🎰', title: 'Giocatore', desc: 'Gira la ruota 10 volte', goal: function (s) { return [s.spins, 10]; } },
    { id: 'tuner', icon: '🔧', title: 'Tuner', desc: 'Personalizza i dati di un veicolo 3 volte', goal: function (s) { return [s.updates, 3]; } },
    { id: 'collector5', icon: '🚗', title: 'Collezionista', desc: 'Certifica 5 targhe', goal: function (s) { return [s.minted, 5]; } },
    { id: 'rare', icon: '💎', title: 'Colpo di fortuna', desc: 'Ottieni una targa rara o migliore', goal: function (s) { return [s.bestRank >= 2 ? 1 : 0, 1]; } },
    { id: 'allTypes', icon: '🏁', title: 'Parco completo', desc: 'Certifica auto, moto, ciclomotore e rimorchio', goal: function (s) { return [s.typeCount, 4]; } },
    { id: 'gift', icon: '🎁', title: 'Generoso', desc: 'Cedi una targa a un altro garage', goal: function (s) { return [s.transfers, 1]; } },
    { id: 'epic', icon: '🔥', title: 'Epico', desc: 'Ottieni una targa epica', goal: function (s) { return [s.bestRank >= 3 ? 1 : 0, 1]; } },
    { id: 'scrap', icon: '♻️', title: 'Rottamatore', desc: 'Rottama una targa', goal: function (s) { return [s.burns, 1]; } },
    { id: 'collector10', icon: '🏆', title: 'Grande collezione', desc: 'Certifica 10 targhe', goal: function (s) { return [s.minted, 10]; } },
    { id: 'legend', icon: '👑', title: 'Leggendario', desc: 'Ottieni una targa leggendaria', goal: function (s) { return [s.bestRank >= 4 ? 1 : 0, 1]; } },
    { id: 'level5', icon: '⭐', title: 'Intenditore', desc: 'Raggiungi il livello 5', goal: function (s) { return [s.level.level, 5]; } }
  ];

  function achievements(s) {
    return ACHIEVEMENTS.map(function (a) {
      var g = a.goal(s);
      var cur = Math.min(g[0], g[1]);
      return { id: a.id, icon: a.icon, title: a.title, desc: a.desc, current: cur, target: g[1], unlocked: g[0] >= g[1] };
    });
  }

  var api = {
    TIERS: TIERS, XP: XP, LEVELS: LEVELS,
    analyze: analyze, levelFor: levelFor, stats: stats, achievements: achievements
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.TargaGame = api;
})(typeof window !== 'undefined' ? window : globalThis);
