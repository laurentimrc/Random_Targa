(function () {
  'use strict';

  var R = window.TargaRules;
  var ledger = new window.TargaLedger.Ledger();

  var state = {
    type: 'auto',
    plate: '',
    openToken: null
  };

  function $(id) { return document.getElementById(id); }

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function short(addr) {
    return addr ? addr.slice(0, 6) + '…' + addr.slice(-4) : '—';
  }

  function fmtDate(iso) {
    return new Date(iso).toLocaleString('it-IT', { dateStyle: 'short', timeStyle: 'short' });
  }

  var toastTimer;
  function toast(msg) {
    var t = $('toast');
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.classList.remove('show'); }, 2600);
  }

  function download(name, content, type) {
    var blob = new Blob([content], { type: type });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 1000);
  }

  function isSquare(type) { return type === 'moto' || type === 'ciclomotore'; }

  function plateSVG(type, plate, meta) {
    return R.toSVG(type, plate, { province: meta && meta.province, year: meta && meta.year });
  }

  // --- Wallet ---
  function ensureWallet() {
    if (!ledger.state.wallets.length) ledger.addWallet('Il mio garage');
  }

  function renderWallets() {
    var sel = $('wallet-select');
    var active = ledger.activeWallet();
    sel.innerHTML = ledger.state.wallets.map(function (w) {
      return '<option value="' + w.address + '"' + (active && w.address === active.address ? ' selected' : '') + '>' +
        esc(w.name) + ' · ' + short(w.address) + '</option>';
    }).join('');
    $('wallet-list').innerHTML = ledger.state.wallets.map(function (w) {
      return '<option value="' + w.address + '">' + esc(w.name) + '</option>';
    }).join('');
  }

  // --- Composizione ---
  function setType(type) {
    state.type = type;
    document.querySelectorAll('#type-select button').forEach(function (b) {
      b.classList.toggle('active', b.dataset.type === type);
    });
    var info = R.TYPES[type];
    $('plate-input').placeholder = info.example;
    $('type-hint').textContent = 'Formato ' + info.label.toLowerCase() + ': ' + info.description + '.';
    $('band-options').hidden = isSquare(type);
    $('issued-only').parentElement.hidden = type !== 'auto';
    state.plate = R.randomPlate(type, { issuedOnly: $('issued-only').checked });
    $('plate-input').value = R.format(type, state.plate);
    renderComposer();
  }

  function currentMeta() {
    var meta = {
      alias: $('meta-alias').value.trim(),
      make: $('meta-make').value.trim(),
      model: $('meta-model').value.trim(),
      color: $('meta-color').value.trim()
    };
    if (!isSquare(state.type)) {
      meta.province = $('province-select').value;
      meta.year = $('year-input').value ? parseInt($('year-input').value, 10) : '';
    }
    return meta;
  }

  function renderComposer() {
    var result = R.validate(state.type, state.plate);
    var meta = currentMeta();

    var stage = $('plate-preview');
    stage.classList.toggle('square', isSquare(state.type));
    stage.innerHTML = plateSVG(state.type, result.plate || '', meta);

    $('checks').innerHTML = result.checks.map(function (c) {
      var cls = c.ok ? 'ok' : c.level;
      var ico = c.ok ? '✓' : (c.level === 'error' ? '✕' : '!');
      return '<li class="' + cls + '"><span class="ico">' + ico + '</span><span>' + esc(c.message) + '</span></li>';
    }).join('');

    var existing = result.valid ? ledger.findByPlate(result.plate, state.type) : null;
    var facts = [
      ['Targa', '<strong>' + esc(result.formatted || '—') + '</strong>'],
      ['Tipo', esc(R.TYPES[state.type].label)]
    ];
    if (result.series) {
      facts.push(['Posizione in serie', result.series.index.toLocaleString('it-IT')]);
      facts.push(['Serie attuale (stima)', esc(result.series.currentHeadPair) + ' xxx xx']);
    }
    if (meta.province) facts.push(['Provincia', esc(meta.province + ' — ' + R.PROVINCE[meta.province])]);
    facts.push(['Token ID', result.valid ? '<span class="mono">' + short(ledger.tokenIdFor(result.plate, state.type)) + '</span>' : '—']);
    facts.push(['Stato', existing
      ? (existing.owner === ledger.state.activeWallet ? 'Già nel tuo garage' : 'Già tokenizzata da ' + short(existing.owner))
      : (result.valid ? 'Disponibile' : 'Non valida')]);
    $('facts').innerHTML = facts.map(function (f) { return '<dt>' + f[0] + '</dt><dd>' + f[1] + '</dd>'; }).join('');

    $('mint-btn').disabled = !result.valid || !!existing;
    $('mint-status').textContent = existing ? 'Questa targa è già stata tokenizzata.' : '';
  }

  function mint() {
    var result = R.validate(state.type, state.plate);
    if (!result.valid) return;
    var wallet = ledger.activeWallet();
    var meta = currentMeta();
    var btn = $('mint-btn');
    btn.disabled = true;
    $('mint-status').textContent = 'Conio del token in corso (proof-of-work)…';
    // Lascia ridisegnare la UI prima del calcolo.
    setTimeout(function () {
      try {
        var out = ledger.mint({ plate: result.plate, vehicleType: state.type, owner: wallet.address, metadata: meta });
        ['meta-alias', 'meta-make', 'meta-model', 'meta-color'].forEach(function (id) { $(id).value = ''; });
        refreshAll();
        $('mint-status').textContent = 'Token coniato nel blocco #' + out.block.index + ' · tx ' + short(out.tx.hash);
        toast('Targa ' + result.formatted + ' aggiunta al garage');
      } catch (e) {
        $('mint-status').textContent = e.message;
        btn.disabled = false;
      }
    }, 30);
  }

  // --- Garage ---
  function renderGarage() {
    var wallet = ledger.activeWallet();
    var all = wallet ? ledger.tokensOf(wallet.address) : [];
    var q = $('garage-search').value.trim().toLowerCase();
    var f = $('garage-filter').value;
    var list = all.filter(function (t) {
      if (f && t.vehicleType !== f) return false;
      if (!q) return true;
      var m = t.metadata || {};
      return t.plate.toLowerCase().indexOf(q.replace(/\s/g, '')) !== -1 ||
        [m.alias, m.make, m.model, m.color].join(' ').toLowerCase().indexOf(q) !== -1;
    });

    $('garage-count').textContent = all.length;
    $('garage-empty').hidden = all.length > 0;
    $('garage-grid').innerHTML = list.map(function (t) {
      var m = t.metadata || {};
      var title = m.alias || [m.make, m.model].filter(Boolean).join(' ') || R.format(t.vehicleType, t.plate);
      var sub = [m.make, m.model, m.color].filter(Boolean).join(' · ') || 'Nessun dettaglio veicolo';
      return '<article class="vehicle">' +
        '<div class="plate-stage' + (isSquare(t.vehicleType) ? ' square' : '') + '">' + plateSVG(t.vehicleType, t.plate, m) + '</div>' +
        '<div class="vehicle-body">' +
          '<span class="tag">' + esc(R.TYPES[t.vehicleType].label) + '</span>' +
          '<strong>' + esc(title) + '</strong>' +
          '<span class="sub">' + esc(sub) + '</span>' +
          '<span class="mono">Token ' + short(t.tokenId) + ' · blocco #' + t.mintBlock + '</span>' +
        '</div>' +
        '<div class="vehicle-foot"><button class="btn small" type="button" data-open="' + t.tokenId + '">Gestisci</button></div>' +
      '</article>';
    }).join('');
    if (all.length && !list.length) {
      $('garage-grid').innerHTML = '<p class="empty">Nessun veicolo corrisponde alla ricerca.</p>';
    }
  }

  // --- Dialog token ---
  function openToken(tokenId) {
    var t = ledger.tokens[tokenId];
    if (!t) return;
    state.openToken = tokenId;
    var m = t.metadata || {};
    $('dlg-title').textContent = 'Targa ' + R.format(t.vehicleType, t.plate);
    var stage = $('dlg-plate');
    stage.classList.toggle('square', isSquare(t.vehicleType));
    stage.innerHTML = plateSVG(t.vehicleType, t.plate, m);
    $('dlg-facts').innerHTML = [
      ['Token ID', '<span class="mono">' + t.tokenId + '</span>'],
      ['Proprietario', '<span class="mono">' + t.owner + '</span>'],
      ['Coniato', fmtDate(t.mintedAt) + ' · blocco #' + t.mintBlock],
      ['Tipo', esc(R.TYPES[t.vehicleType].label)]
    ].map(function (f) { return '<dt>' + f[0] + '</dt><dd>' + f[1] + '</dd>'; }).join('');
    $('dlg-alias').value = m.alias || '';
    $('dlg-make').value = m.make || '';
    $('dlg-model').value = m.model || '';
    $('dlg-color').value = m.color || '';
    $('dlg-to').value = '';
    $('dlg-status').textContent = '';
    $('dlg-history').innerHTML = t.history.slice().reverse().map(function (h) {
      var detail = h.type === 'MINT' ? 'a ' + short(h.to)
        : h.type === 'TRANSFER' ? short(h.from) + ' → ' + short(h.to)
        : h.type === 'BURN' ? 'da ' + short(h.from) : 'metadati aggiornati';
      return '<li><span class="op ' + h.type + '">' + h.type + '</span> ' + detail +
        ' · ' + fmtDate(h.at) + ' · blocco #' + h.block + '</li>';
    }).join('');
    var dlg = $('token-dialog');
    if (!dlg.open) dlg.showModal();
  }

  function withToken(fn) {
    var wallet = ledger.activeWallet();
    try {
      fn(state.openToken, wallet.address);
      refreshAll();
      return true;
    } catch (e) {
      $('dlg-status').textContent = e.message;
      return false;
    }
  }

  function tokenMetadata(t) {
    var m = t.metadata || {};
    var attrs = [
      { trait_type: 'Tipo veicolo', value: R.TYPES[t.vehicleType].label },
      { trait_type: 'Formato', value: R.TYPES[t.vehicleType].pattern }
    ];
    if (m.province) attrs.push({ trait_type: 'Provincia', value: m.province });
    if (m.year) attrs.push({ trait_type: 'Anno', value: m.year });
    if (m.make) attrs.push({ trait_type: 'Marca', value: m.make });
    if (m.model) attrs.push({ trait_type: 'Modello', value: m.model });
    if (m.color) attrs.push({ trait_type: 'Colore', value: m.color });
    var svg = plateSVG(t.vehicleType, t.plate, m);
    return {
      name: 'Targa ' + R.format(t.vehicleType, t.plate),
      description: m.alias ? 'Targa italiana di "' + m.alias + '"' : 'Targa italiana tokenizzata',
      image: 'data:image/svg+xml;base64,' + btoa(unescape(encodeURIComponent(svg))),
      token_id: t.tokenId,
      owner: t.owner,
      attributes: attrs
    };
  }

  // --- Registro ---
  function renderLedger() {
    var tokens = ledger.tokens;
    $('ledger-body').innerHTML = ledger.state.chain.slice().reverse().map(function (b) {
      return b.txs.map(function (tx) {
        var tok = tokens[tx.tokenId];
        var plate = tok ? R.format(tok.vehicleType, tok.plate) : '—';
        var flow = tx.type === 'MINT' ? '→ ' + short(tx.to)
          : tx.type === 'TRANSFER' ? short(tx.from) + ' → ' + short(tx.to)
          : tx.from ? short(tx.from) : '—';
        return '<tr><td>' + b.index + '</td><td>' + fmtDate(b.timestamp) + '</td>' +
          '<td><span class="op ' + tx.type + '">' + tx.type + '</span></td>' +
          '<td>' + esc(plate) + '</td><td class="mono">' + flow + '</td>' +
          '<td class="mono" title="' + b.hash + '">' + b.hash.slice(0, 18) + '…</td></tr>';
      }).join('');
    }).join('');
  }

  function renderKpis() {
    var wallet = ledger.activeWallet();
    $('kpi-owned').textContent = wallet ? ledger.tokensOf(wallet.address).length : 0;
    $('kpi-minted').textContent = ledger.allTokens().length;
    $('kpi-blocks').textContent = ledger.state.chain.length;
    var v = ledger.verify();
    $('kpi-integrity').textContent = v.ok ? 'Valida' : 'Errore #' + v.block;
    $('kpi-integrity').style.color = v.ok ? 'var(--ok)' : 'var(--err)';
  }

  function refreshAll() {
    renderWallets();
    renderComposer();
    renderGarage();
    renderLedger();
    renderKpis();
    if (state.openToken && $('token-dialog').open) {
      var t = ledger.tokens[state.openToken];
      if (!t || t.burned || t.owner !== ledger.state.activeWallet) $('token-dialog').close();
      else openToken(state.openToken);
    }
  }

  function showTab(name) {
    document.querySelectorAll('.tab').forEach(function (t) {
      var on = t.dataset.tab === name;
      t.classList.toggle('active', on);
      t.setAttribute('aria-selected', on);
    });
    document.querySelectorAll('.panel').forEach(function (p) {
      p.hidden = p.id !== 'tab-' + name;
    });
    try { localStorage.setItem('random-targa:tab', name); } catch (e) { /* noop */ }
  }

  // --- Eventi ---
  function bind() {
    document.querySelectorAll('.tab').forEach(function (t) {
      t.addEventListener('click', function () { showTab(t.dataset.tab); });
    });
    document.querySelectorAll('[data-goto]').forEach(function (b) {
      b.addEventListener('click', function () { showTab(b.dataset.goto); });
    });

    document.querySelectorAll('#type-select button').forEach(function (b) {
      b.addEventListener('click', function () { setType(b.dataset.type); });
    });

    $('plate-input').addEventListener('input', function (e) {
      state.plate = R.normalize(e.target.value).slice(0, 7);
      var formatted = R.format(state.type, state.plate);
      if (e.target.value !== formatted) e.target.value = formatted;
      renderComposer();
    });

    $('random-btn').addEventListener('click', function () {
      state.plate = R.randomPlate(state.type, { issuedOnly: $('issued-only').checked });
      $('plate-input').value = R.format(state.type, state.plate);
      renderComposer();
    });

    ['province-select', 'year-input', 'meta-alias', 'meta-make', 'meta-model', 'meta-color'].forEach(function (id) {
      $(id).addEventListener('input', renderComposer);
    });

    $('mint-btn').addEventListener('click', mint);
    $('download-svg').addEventListener('click', function () {
      download('targa-' + state.plate + '.svg', plateSVG(state.type, state.plate, currentMeta()), 'image/svg+xml');
    });

    $('wallet-select').addEventListener('change', function (e) {
      ledger.setActiveWallet(e.target.value);
      refreshAll();
    });
    $('wallet-new').addEventListener('click', function () {
      var name = prompt('Nome del nuovo wallet', 'Garage ' + (ledger.state.wallets.length + 1));
      if (name === null) return;
      var w = ledger.addWallet(name.trim() || 'Garage');
      ledger.setActiveWallet(w.address);
      refreshAll();
      toast('Wallet creato: ' + short(w.address));
    });
    $('wallet-copy').addEventListener('click', function () {
      var w = ledger.activeWallet();
      if (navigator.clipboard) navigator.clipboard.writeText(w.address).then(function () { toast('Indirizzo copiato'); });
    });

    $('garage-search').addEventListener('input', renderGarage);
    $('garage-filter').addEventListener('change', renderGarage);
    $('garage-grid').addEventListener('click', function (e) {
      var b = e.target.closest('[data-open]');
      if (b) openToken(b.dataset.open);
    });

    $('dlg-save').addEventListener('click', function () {
      var changes = {
        alias: $('dlg-alias').value.trim(),
        make: $('dlg-make').value.trim(),
        model: $('dlg-model').value.trim(),
        color: $('dlg-color').value.trim()
      };
      if (withToken(function (id, from) { ledger.update(id, from, changes); })) toast('Dati aggiornati');
    });
    $('dlg-transfer').addEventListener('click', function () {
      var to = $('dlg-to').value.trim();
      var t = ledger.tokens[state.openToken];
      if (!confirm('Trasferire la targa ' + R.format(t.vehicleType, t.plate) + ' a ' + to + '?')) return;
      if (withToken(function (id, from) { ledger.transfer(id, from, to); })) toast('Token trasferito a ' + short(to));
    });
    $('dlg-burn').addEventListener('click', function () {
      var t = ledger.tokens[state.openToken];
      if (!confirm('Bruciare definitivamente il token della targa ' + R.format(t.vehicleType, t.plate) + '?')) return;
      if (withToken(function (id, from) { ledger.burn(id, from); })) toast('Token bruciato');
    });
    $('dlg-metadata').addEventListener('click', function () {
      var t = ledger.tokens[state.openToken];
      download('targa-' + t.plate + '.json', JSON.stringify(tokenMetadata(t), null, 2), 'application/json');
    });

    $('verify-btn').addEventListener('click', function () {
      var v = ledger.verify();
      toast(v.ok ? 'Registro integro: ' + v.blocks + ' blocchi verificati' : 'Errore al blocco #' + v.block + ': ' + v.reason);
      renderKpis();
    });
    $('export-btn').addEventListener('click', function () {
      var withKeys = confirm('Includere le chiavi private dei wallet? Servono per gestire le targhe dopo un\'importazione. Conserva il file in un luogo sicuro.');
      download('random-targa-registro.json', ledger.exportJSON(withKeys), 'application/json');
    });
    $('import-file').addEventListener('change', function (e) {
      var file = e.target.files[0];
      if (!file) return;
      file.text().then(function (text) {
        try {
          ledger.importJSON(text);
          ensureWallet();
          refreshAll();
          toast('Registro importato');
        } catch (err) {
          toast(err.message);
        }
        e.target.value = '';
      });
    });
    $('reset-btn').addEventListener('click', function () {
      if (!confirm('Azzerare registro e wallet? L\'operazione non è reversibile.')) return;
      ledger.reset();
      ensureWallet();
      refreshAll();
      toast('Registro azzerato');
    });
  }

  function init() {
    ensureWallet();

    $('province-select').innerHTML += Object.keys(R.PROVINCE).sort().map(function (k) {
      return '<option value="' + k + '">' + k + ' — ' + esc(R.PROVINCE[k]) + '</option>';
    }).join('');
    $('letters').textContent = R.LETTERS.split('').join(' ');
    $('rules-body').innerHTML = Object.keys(R.TYPES).map(function (k) {
      var t = R.TYPES[k];
      return '<tr><td>' + t.label + '</td><td>' + esc(t.description) + '</td><td><code>' + t.example + '</code></td></tr>';
    }).join('');

    bind();
    setType('auto');
    refreshAll();

    var tab = null;
    try { tab = localStorage.getItem('random-targa:tab'); } catch (e) { /* noop */ }
    if (tab && $('tab-' + tab)) showTab(tab);
  }

  init();
})();
