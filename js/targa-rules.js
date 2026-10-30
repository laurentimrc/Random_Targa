/*
 * Regole di composizione delle targhe italiane (sistema dal 1994).
 *
 * - Autoveicoli:  AA 000 AA  (2 lettere, 3 cifre, 2 lettere)
 * - Motoveicoli:  AA 00000   (2 lettere, 5 cifre)
 * - Ciclomotori:  X0000A     (6 caratteri, inizia con X)
 * - Rimorchi:     XA 000 AA  (come gli autoveicoli, prima lettera X)
 *
 * Lettere ammesse: le 22 lettere dell'alfabeto escluse I, O, Q, U
 * (confondibili con 1, 0 e V). La serie avanza incrementando prima il
 * numero (000-999), poi la coppia finale (AA-ZZ) e infine la coppia iniziale.
 */
(function (root) {
  'use strict';

  var LETTERS = 'ABCDEFGHJKLMNPRSTVWXYZ';
  var FORBIDDEN_LETTERS = 'IOQU';
  var DIGITS = '0123456789';

  var PROVINCE = {
    AG: 'Agrigento', AL: 'Alessandria', AN: 'Ancona', AO: 'Aosta', AP: 'Ascoli Piceno',
    AQ: "L'Aquila", AR: 'Arezzo', AT: 'Asti', AV: 'Avellino', BA: 'Bari', BG: 'Bergamo',
    BI: 'Biella', BL: 'Belluno', BN: 'Benevento', BO: 'Bologna', BR: 'Brindisi',
    BS: 'Brescia', BT: 'Barletta-Andria-Trani', BZ: 'Bolzano', CA: 'Cagliari',
    CB: 'Campobasso', CE: 'Caserta', CH: 'Chieti', CL: 'Caltanissetta', CN: 'Cuneo',
    CO: 'Como', CR: 'Cremona', CS: 'Cosenza', CT: 'Catania', CZ: 'Catanzaro', EN: 'Enna',
    FC: 'Forlì-Cesena', FE: 'Ferrara', FG: 'Foggia', FI: 'Firenze', FM: 'Fermo',
    FR: 'Frosinone', GE: 'Genova', GO: 'Gorizia', GR: 'Grosseto', IM: 'Imperia',
    IS: 'Isernia', KR: 'Crotone', LC: 'Lecco', LE: 'Lecce', LI: 'Livorno', LO: 'Lodi',
    LT: 'Latina', LU: 'Lucca', MB: 'Monza e Brianza', MC: 'Macerata', ME: 'Messina',
    MI: 'Milano', MN: 'Mantova', MO: 'Modena', MS: 'Massa-Carrara', MT: 'Matera',
    NA: 'Napoli', NO: 'Novara', NU: 'Nuoro', OR: 'Oristano', PA: 'Palermo',
    PC: 'Piacenza', PD: 'Padova', PE: 'Pescara', PG: 'Perugia', PI: 'Pisa',
    PN: 'Pordenone', PO: 'Prato', PR: 'Parma', PT: 'Pistoia', PU: 'Pesaro e Urbino',
    PV: 'Pavia', PZ: 'Potenza', RA: 'Ravenna', RC: 'Reggio Calabria', RE: 'Reggio Emilia',
    RG: 'Ragusa', RI: 'Rieti', RM: 'Roma', RN: 'Rimini', RO: 'Rovigo', SA: 'Salerno',
    SI: 'Siena', SO: 'Sondrio', SP: 'La Spezia', SR: 'Siracusa', SS: 'Sassari',
    SU: 'Sud Sardegna', SV: 'Savona', TA: 'Taranto', TE: 'Teramo', TN: 'Trento',
    TO: 'Torino', TP: 'Trapani', TR: 'Terni', TS: 'Trieste', TV: 'Treviso', UD: 'Udine',
    VA: 'Varese', VB: 'Verbano-Cusio-Ossola', VC: 'Vercelli', VE: 'Venezia',
    VI: 'Vicenza', VR: 'Verona', VT: 'Viterbo', VV: 'Vibo Valentia'
  };

  // Prefissi non assegnati alla serie ordinaria.
  var RESERVED_PREFIXES = {
    EE: 'Riservato ai veicoli per Escursionisti Esteri'
  };

  var TYPES = {
    auto: {
      label: 'Autoveicolo',
      pattern: 'LL DDD LL',
      example: 'GA 123 BC',
      description: '2 lettere, 3 cifre, 2 lettere'
    },
    moto: {
      label: 'Motoveicolo',
      pattern: 'LL DDDDD',
      example: 'EB 12345',
      description: '2 lettere, 5 cifre'
    },
    ciclomotore: {
      label: 'Ciclomotore',
      pattern: 'X AAAAA',
      example: 'X3B4CD',
      description: 'X seguita da 5 caratteri alfanumerici'
    },
    rimorchio: {
      label: 'Rimorchio',
      pattern: 'XL DDD LL',
      example: 'XA 123 BC',
      description: 'come gli autoveicoli, ma la prima lettera è sempre X'
    }
  };

  // Ancore approssimative (coppia iniziale -> anno decimale di prima emissione)
  // per stimare l'anno d'immatricolazione degli autoveicoli.
  var AUTO_YEAR_ANCHORS = [
    ['AA', 1994.0], ['BA', 1998.6], ['CA', 2002.6], ['DA', 2006.6],
    ['EA', 2010.9], ['FA', 2015.8], ['GA', 2020.9], ['HA', 2025.4]
  ];

  function normalize(text) {
    return String(text || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  }

  function isLetter(c) { return LETTERS.indexOf(c) !== -1; }
  function isDigit(c) { return DIGITS.indexOf(c) !== -1; }
  function letterIndex(c) { return LETTERS.indexOf(c); }

  function pairIndex(pair) {
    return letterIndex(pair[0]) * LETTERS.length + letterIndex(pair[1]);
  }

  function pairFromIndex(i) {
    return LETTERS[Math.floor(i / LETTERS.length)] + LETTERS[i % LETTERS.length];
  }

  function format(type, text) {
    var t = normalize(text);
    if (type === 'auto' || type === 'rimorchio') {
      return [t.slice(0, 2), t.slice(2, 5), t.slice(5, 7)].filter(Boolean).join(' ');
    }
    if (type === 'moto') {
      return [t.slice(0, 2), t.slice(2, 7)].filter(Boolean).join(' ');
    }
    return t;
  }

  // Controlla un carattere rispetto al tipo atteso nello schema (L, D, A, X).
  function checkChar(expected, c) {
    if (expected === 'L') return isLetter(c);
    if (expected === 'D') return isDigit(c);
    if (expected === 'A') return isLetter(c) || isDigit(c);
    if (expected === 'X') return c === 'X';
    return false;
  }

  function schemaOf(type) {
    return TYPES[type].pattern.replace(/ /g, '');
  }

  /*
   * Valida una targa e restituisce l'elenco dei controlli effettuati.
   * Ogni controllo: { id, ok, level: 'error'|'warning'|'info', message }.
   */
  function validate(type, text) {
    if (!TYPES[type]) throw new Error('Tipo veicolo sconosciuto: ' + type);
    var plate = normalize(text);
    var schema = schemaOf(type);
    var checks = [];

    function add(id, ok, level, message) {
      checks.push({ id: id, ok: ok, level: level, message: message });
    }

    add('length', plate.length === schema.length, 'error',
      'Lunghezza: ' + schema.length + ' caratteri (' + TYPES[type].description + ')');

    var badLetters = plate.split('').filter(function (c) {
      return FORBIDDEN_LETTERS.indexOf(c) !== -1;
    });
    add('letters', badLetters.length === 0, 'error',
      badLetters.length
        ? 'Lettere non ammesse: ' + unique(badLetters).join(', ') + ' (escluse I, O, Q, U)'
        : 'Nessuna lettera vietata (I, O, Q, U)');

    var positionsOk = plate.length === schema.length &&
      schema.split('').every(function (exp, i) { return checkChar(exp, plate[i]); });
    add('pattern', positionsOk, 'error',
      'Schema rispettato: ' + TYPES[type].pattern.replace(/L/g, 'A').replace(/D/g, '0') +
        (type === 'ciclomotore' ? ' (X + 5 alfanumerici)' : ''));

    if (type === 'auto' || type === 'moto') {
      var prefix = plate.slice(0, 2);
      var reserved = RESERVED_PREFIXES[prefix];
      add('reserved', !reserved, 'error',
        reserved ? 'Prefisso ' + prefix + ': ' + reserved : 'Prefisso non riservato');
    }

    if (type === 'ciclomotore' && positionsOk) {
      var tail = plate.slice(1);
      var hasLetter = /[A-Z]/.test(tail);
      var hasDigit = /[0-9]/.test(tail);
      add('mix', hasLetter && hasDigit, 'warning',
        'I contrassegni dei ciclomotori alternano lettere e cifre');
    }

    if (positionsOk && (type === 'auto' || type === 'rimorchio')) {
      var num = parseInt(plate.slice(2, 5), 10);
      add('zero', num !== 0, 'warning',
        num === 0 ? 'Il numero 000 non viene emesso nella serie ordinaria' : 'Numero progressivo valido');
    }

    if (positionsOk && type === 'moto') {
      var mnum = parseInt(plate.slice(2), 10);
      add('zero', mnum !== 0, 'warning',
        mnum === 0 ? 'Il numero 00000 non viene emesso nella serie ordinaria' : 'Numero progressivo valido');
    }

    var info = null;
    if (positionsOk && type === 'auto') {
      info = seriesInfo(plate);
      add('issued', info.issued, 'warning',
        info.issued
          ? 'Serie già emessa (stima ' + info.yearLabel + ')'
          : 'Serie non ancora emessa: sarebbe in circolazione intorno al ' + info.yearLabel);
    }

    var valid = checks.every(function (c) { return c.ok || c.level !== 'error'; });
    return { plate: plate, formatted: format(type, plate), type: type, valid: valid, checks: checks, series: info };
  }

  function unique(arr) {
    return arr.filter(function (v, i) { return arr.indexOf(v) === i; });
  }

  // Posizione progressiva nella serie: numero -> coppia finale -> coppia iniziale.
  function sequenceIndex(plate) {
    var p = normalize(plate);
    var head = pairIndex(p.slice(0, 2));
    var tail = pairIndex(p.slice(5, 7));
    var num = parseInt(p.slice(2, 5), 10);
    return (head * LETTERS.length * LETTERS.length + tail) * 1000 + num;
  }

  function plateFromIndex(index) {
    var perHead = LETTERS.length * LETTERS.length * 1000;
    var head = Math.floor(index / perHead);
    var rest = index % perHead;
    var tail = Math.floor(rest / 1000);
    var num = rest % 1000;
    return pairFromIndex(head) + String(num).padStart(3, '0') + pairFromIndex(tail);
  }

  function estimateYear(headIndex) {
    var a = AUTO_YEAR_ANCHORS.map(function (x) { return [pairIndex(x[0]), x[1]]; });
    var i = 0;
    while (i < a.length - 2 && headIndex >= a[i + 1][0]) i++;
    var x0 = a[i][0], y0 = a[i][1], x1 = a[i + 1][0], y1 = a[i + 1][1];
    return y0 + (headIndex - x0) * (y1 - y0) / (x1 - x0);
  }

  // Coppia iniziale presumibilmente in emissione a una certa data.
  function currentHeadIndex(date) {
    var d = date || new Date();
    var year = d.getFullYear() + d.getMonth() / 12;
    var a = AUTO_YEAR_ANCHORS.map(function (x) { return [pairIndex(x[0]), x[1]]; });
    var i = 0;
    while (i < a.length - 2 && year >= a[i + 1][1]) i++;
    var x0 = a[i][0], y0 = a[i][1], x1 = a[i + 1][0], y1 = a[i + 1][1];
    return Math.floor(x0 + (year - y0) * (x1 - x0) / (y1 - y0));
  }

  function seriesInfo(plate, date) {
    var p = normalize(plate);
    var head = pairIndex(p.slice(0, 2));
    var year = estimateYear(head);
    var current = currentHeadIndex(date);
    return {
      index: sequenceIndex(p),
      headPair: p.slice(0, 2),
      currentHeadPair: pairFromIndex(current),
      estimatedYear: Math.floor(year),
      yearLabel: String(Math.floor(year)),
      issued: head <= current
    };
  }

  function pick(chars, rng) {
    return chars[Math.floor(rng() * chars.length)];
  }

  function randomPlate(type, options) {
    var opts = options || {};
    var rng = opts.rng || Math.random;
    var schema = schemaOf(type);
    var plate;
    do {
      plate = schema.split('').map(function (exp) {
        if (exp === 'L') return pick(LETTERS, rng);
        if (exp === 'D') return pick(DIGITS, rng);
        if (exp === 'X') return 'X';
        return pick(LETTERS + DIGITS, rng);
      }).join('');
      if (type === 'auto' && opts.issuedOnly) {
        // Coppia iniziale tra quelle già emesse.
        var maxHead = currentHeadIndex(opts.date);
        var head = Math.floor(rng() * (maxHead + 1));
        plate = pairFromIndex(head) + plate.slice(2);
      }
    } while (!validate(type, plate).checks.every(function (c) { return c.ok; }));
    return plate;
  }

  /*
   * Rappresentazione SVG della targa (proporzioni 520x110 mm per auto/rimorchi,
   * formato quadrato per moto e ciclomotori).
   */
  function toSVG(type, text, options) {
    var opts = options || {};
    var p = normalize(text);
    var font = "font-family=\"'Barlow Condensed','Arial Narrow','Roboto Condensed',sans-serif\" font-weight=\"600\"";
    var blue = '#003399';

    if (type === 'moto' || type === 'ciclomotore') {
      var w = type === 'moto' ? 280 : 220;
      var h = type === 'moto' ? 200 : 180;
      var top = type === 'moto' ? p.slice(0, 2) : p.slice(0, 3);
      var bottom = type === 'moto' ? p.slice(2) : p.slice(3);
      return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ' + w + ' ' + h + '" role="img" aria-label="Targa ' + escapeXml(p) + '">' +
        '<rect x="2" y="2" width="' + (w - 4) + '" height="' + (h - 4) + '" rx="14" fill="#fff" stroke="#222" stroke-width="4"/>' +
        (type === 'moto'
          ? '<rect x="14" y="14" width="52" height="82" rx="6" fill="' + blue + '"/>' +
            euStars(40, 40, 15) +
            '<text x="40" y="86" text-anchor="middle" fill="#fff" font-family="Arial,sans-serif" font-weight="700" font-size="22">I</text>' +
            '<text x="' + ((w + 66) / 2) + '" y="88" text-anchor="middle" ' + font + ' font-size="84" fill="#111" letter-spacing="6">' + escapeXml(top) + '</text>'
          : '<text x="' + (w / 2) + '" y="82" text-anchor="middle" ' + font + ' font-size="76" fill="#111" letter-spacing="8">' + escapeXml(top) + '</text>') +
        '<text x="' + (w / 2) + '" y="' + (h - 22) + '" text-anchor="middle" ' + font + ' font-size="' + (type === 'moto' ? 78 : 76) + '" fill="#111" letter-spacing="' + (type === 'moto' ? 4 : 8) + '">' + escapeXml(bottom) + '</text>' +
        '</svg>';
    }

    var label = format(type, p);
    var year = opts.year ? String(opts.year).slice(-2) : '';
    var prov = opts.province || '';
    return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 520 112" role="img" aria-label="Targa ' + escapeXml(label) + '">' +
      '<rect x="2" y="2" width="516" height="108" rx="10" fill="#fff" stroke="#222" stroke-width="4"/>' +
      '<rect x="6" y="6" width="46" height="100" rx="6" fill="' + blue + '"/>' +
      euStars(29, 38, 16) +
      '<text x="29" y="94" text-anchor="middle" fill="#fff" font-family="Arial,sans-serif" font-weight="700" font-size="26">I</text>' +
      '<rect x="468" y="6" width="46" height="100" rx="6" fill="' + blue + '"/>' +
      (year ? '<text x="491" y="40" text-anchor="middle" fill="#ffd700" font-family="Arial,sans-serif" font-weight="700" font-size="20">' + escapeXml(year) + '</text>' : '') +
      (prov ? '<text x="491" y="94" text-anchor="middle" fill="#fff" font-family="Arial,sans-serif" font-weight="700" font-size="22">' + escapeXml(prov) + '</text>' : '') +
      '<text x="260" y="88" text-anchor="middle" ' + font + ' font-size="86" fill="#111" letter-spacing="3" textLength="390" lengthAdjust="spacingAndGlyphs">' + escapeXml(label) + '</text>' +
      '</svg>';
  }

  // Cerchio di 12 stelle UE.
  function euStars(cx, cy, r) {
    var out = '';
    for (var i = 0; i < 12; i++) {
      var a = (i / 12) * Math.PI * 2;
      var x = cx + Math.sin(a) * r;
      var y = cy - Math.cos(a) * r;
      out += '<circle cx="' + x.toFixed(1) + '" cy="' + y.toFixed(1) + '" r="2.3" fill="#ffd700"/>';
    }
    return out;
  }

  function escapeXml(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[c];
    });
  }

  var api = {
    LETTERS: LETTERS,
    FORBIDDEN_LETTERS: FORBIDDEN_LETTERS,
    PROVINCE: PROVINCE,
    TYPES: TYPES,
    normalize: normalize,
    format: format,
    validate: validate,
    sequenceIndex: sequenceIndex,
    plateFromIndex: plateFromIndex,
    seriesInfo: seriesInfo,
    randomPlate: randomPlate,
    toSVG: toSVG
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.TargaRules = api;
})(typeof window !== 'undefined' ? window : globalThis);
