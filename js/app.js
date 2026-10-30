(function () {
  'use strict';

  var R = window.TargaRules;
  var G = window.TargaGame;
  var ledger = new window.TargaLedger.Ledger();

  var SPINS_KEY = 'random-targa:spins';
  var reducedMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  var state = {
    type: 'auto',
    plate: '',
    openToken: null,
    spinning: false,
    progress: null // ultimo snapshot di livello/trofei, per rilevare i progressi
  };

  function $(id) { return document.getElementById(id); }

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function fmtDate(iso) {
    return new Date(iso).toLocaleString('it-IT', { dateStyle: 'medium', timeStyle: 'short' });
  }

  function isSquare(type) { return type === 'moto' || type === 'ciclomotore'; }

  function plateSVG(type, plate, meta) {
    return R.toSVG(type, plate, { province: meta && meta.province, year: meta && meta.year });
  }

  function initials(name) {
    return String(name || 'G').trim().split(/\s+/).slice(0, 2).map(function (w) { return w[0]; }).join('').toUpperCase();
  }

  // Nome del garage associato a un indirizzo interno.
  function garageName(address) {
    var w = ledger.state.wallets.filter(function (x) { return x.address.toLowerCase() === String(address).toLowerCase(); })[0];
    return w ? w.name : 'un altro garage';
  }

  // Codice certificato leggibile, ricavato dall'identificativo interno.
  function certCode(tokenId) {
    return 'RT-' + tokenId.slice(2, 6).toUpperCase() + '-' + tokenId.slice(-4).toUpperCase();
  }

  // --- Contatore giri della ruota (per garage) ---
  function readSpins() {
    try { return JSON.parse(localStorage.getItem(SPINS_KEY)) || {}; } catch (e) { return {}; }
  }

  function spinsOf(address) { return readSpins()[address] || 0; }

  function addSpin(address) {
    var all = readSpins();
    all[address] = (all[address] || 0) + 1;
    try { localStorage.setItem(SPINS_KEY, JSON.stringify(all)); } catch (e) { /* noop */ }
  }

  function currentStats() {
    var w = ledger.activeWallet();
    return w ? G.stats(ledger, w.address, { spins: spinsOf(w.address) }) : null;
  }

  // --- Effetti ---
  var toastTimer;
  function toast(msg) {
    var t = $('toast');
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.classList.remove('show'); }, 2600);
  }

  // Coriandoli: in pagina attorno a originEl, oppure dentro un contenitore (es. una finestra modale).
  function confetti(originEl, amount, container) {
    if (reducedMotion) return;
    var layer = container || $('fx-layer');
    var rect = container ? { left: 0, top: 0, width: container.clientWidth, height: container.clientHeight * 0.6 }
      : originEl.getBoundingClientRect();
    var cx = rect.left + rect.width / 2;
    var cy = rect.top + rect.height / 2;
    var colors = ['#003399', '#ffcc00', '#2f6fed', '#8b3dff', '#f5a524', '#2e9e5b', '#ff5d73'];
    for (var i = 0; i < (amount || 90); i++) {
      var p = document.createElement('i');
      p.className = 'confetto';
      var angle = Math.random() * Math.PI * 2;
      var dist = 120 + Math.random() * 260;
      p.style.left = cx + 'px';
      p.style.top = cy + 'px';
      p.style.background = colors[i % colors.length];
      p.style.setProperty('--dx', Math.cos(angle) * dist + 'px');
      p.style.setProperty('--dy', Math.sin(angle) * dist - 120 + 'px');
      p.style.setProperty('--rot', (Math.random() * 720 - 360) + 'deg');
      p.style.animationDelay = Math.random() * 120 + 'ms';
      layer.appendChild(p);
      setTimeout(p.remove.bind(p), 1800);
    }
  }

  function floatText(el, text, cls) {
    var rect = el.getBoundingClientRect();
    var f = document.createElement('span');
    f.className = 'float-text ' + (cls || '');
    f.textContent = text;
    f.style.left = rect.left + rect.width / 2 + 'px';
    f.style.top = rect.top + 'px';
    $('fx-layer').appendChild(f);
    setTimeout(f.remove.bind(f), 1600);
  }

  function animateNumber(el, to) {
    var from = parseInt(el.dataset.value || el.textContent, 10) || 0;
    el.dataset.value = to;
    if (reducedMotion || from === to) { el.textContent = to.toLocaleString('it-IT'); return; }
    var start = performance.now();
    var dur = 700;
    (function step(now) {
      var k = Math.min(1, (now - start) / dur);
      var eased = 1 - Math.pow(1 - k, 3);
      el.textContent = Math.round(from + (to - from) * eased).toLocaleString('it-IT');
      if (k < 1) requestAnimationFrame(step);
    })(start);
    el.classList.remove('bump');
    void el.offsetWidth;
    el.classList.add('bump');
  }

  function showAchievement(a) {
    var card = document.createElement('div');
    card.className = 'achievement-pop';
    card.innerHTML = '<span class="ach-ico">' + a.icon + '</span><span><small>Trofeo sbloccato!</small><strong>' +
      esc(a.title) + '</strong></span>';
    $('achievements-stack').appendChild(card);
    setTimeout(function () { card.classList.add('out'); }, 3400);
    setTimeout(function () { card.remove(); }, 3900);
  }

  function showLevelUp(level) {
    $('levelup-num').textContent = level.level;
    $('levelup-name').textContent = level.name;
    var dlg = $('levelup-dialog');
    if (!dlg.open) dlg.showModal();
    confetti(null, 120, dlg.querySelector('.levelup'));
  }

  // I trofei aspettano la chiusura della finestra di livello.
  var pendingAchievements = [];
  function flushAchievements() {
    if ($('levelup-dialog').open) return;
    pendingAchievements.splice(0).forEach(function (a, i) {
      setTimeout(function () { showAchievement(a); }, 300 + i * 500);
    });
  }

  // Confronta i progressi con lo snapshot precedente e festeggia le novità.
  function checkProgress(silent) {
    var s = currentStats();
    if (!s) return;
    var unlocked = G.achievements(s).filter(function (a) { return a.unlocked; });
    var snap = { address: ledger.state.activeWallet, level: s.level.level, ids: unlocked.map(function (a) { return a.id; }) };
    var prev = state.progress;
    state.progress = snap;
    if (silent || !prev || prev.address !== snap.address) return;
    unlocked.filter(function (a) { return prev.ids.indexOf(a.id) === -1; }).forEach(function (a) {
      pendingAchievements.push(a);
    });
    if (snap.level > prev.level) setTimeout(function () { showLevelUp(s.level); }, 900);
    else setTimeout(flushAchievements, 300);
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

  // Effetto 3D al passaggio del mouse.
  function bindTilt(root) {
    if (reducedMotion) return;
    root.addEventListener('pointermove', function (e) {
      var el = e.target.closest('.tilt');
      if (!el) return;
      var r = el.getBoundingClientRect();
      var x = (e.clientX - r.left) / r.width - 0.5;
      var y = (e.clientY - r.top) / r.height - 0.5;
      el.style.setProperty('--rx', (-y * 12).toFixed(2) + 'deg');
      el.style.setProperty('--ry', (x * 16).toFixed(2) + 'deg');
      el.style.setProperty('--mx', ((x + 0.5) * 100).toFixed(1) + '%');
    });
    root.addEventListener('pointerout', function (e) {
      var el = e.target.closest('.tilt');
      if (el && !el.contains(e.relatedTarget)) {
        el.style.setProperty('--rx', '0deg');
        el.style.setProperty('--ry', '0deg');
      }
    });
  }

  // --- Profilo e progressi ---
  function renderProfile() {
    var w = ledger.activeWallet();
    var s = currentStats();
    if (!w || !s) return;
    var lv = s.level;
    $('profile-name').textContent = w.name;
    $('profile-avatar').textContent = initials(w.name);
    $('profile-level').textContent = 'Lv ' + lv.level + ' · ' + lv.name;
    $('profile-xpfill').style.width = (lv.progress * 100).toFixed(1) + '%';

    $('level-num').textContent = lv.level;
    $('level-ring').style.setProperty('--p', lv.progress.toFixed(3));
    $('level-name').textContent = lv.name;
    $('level-next').textContent = lv.next
      ? (lv.next - s.xp) + ' XP per diventare ' + lv.nextName
      : 'Livello massimo raggiunto!';
    $('level-xpfill').style.width = (lv.progress * 100).toFixed(1) + '%';
    animateNumber($('xp-total'), s.xp);

    var achs = G.achievements(s);
    var unlocked = achs.filter(function (a) { return a.unlocked; }).length;
    animateNumber($('stat-owned'), s.owned);
    animateNumber($('stat-trophies'), unlocked);
    $('stat-best').textContent = s.minted ? G.TIERS[s.bestRank].label : '—';
    $('stat-best').dataset.tier = s.minted ? G.TIERS[s.bestRank].id : '';
    $('garage-count').textContent = s.owned;
    $('trophy-count').textContent = unlocked + '/' + achs.length;

    $('missions').innerHTML = achs.filter(function (a) { return !a.unlocked; }).slice(0, 3).map(function (a) {
      return '<li><span class="m-ico">' + a.icon + '</span><span class="m-body"><strong>' + esc(a.title) + '</strong>' +
        '<span class="muted">' + esc(a.desc) + '</span>' +
        '<span class="xpbar thin"><span class="xpfill" style="width:' + (a.current / a.target * 100) + '%"></span></span></span>' +
        '<span class="m-count">' + a.current + '/' + a.target + '</span></li>';
    }).join('') || '<li class="muted">Hai completato tutte le missioni. Sei una leggenda! 👑</li>';

    $('trophy-grid').innerHTML = achs.map(function (a) {
      return '<div class="trophy' + (a.unlocked ? ' unlocked' : '') + '">' +
        '<span class="t-ico">' + (a.unlocked ? a.icon : '🔒') + '</span>' +
        '<strong>' + esc(a.title) + '</strong><span class="muted">' + esc(a.desc) + '</span>' +
        (a.unlocked ? '<span class="t-done">Sbloccato</span>'
          : '<span class="xpbar thin"><span class="xpfill" style="width:' + (a.current / a.target * 100) + '%"></span></span>') +
        '</div>';
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

  function rarityOf(type, plate, meta, series) {
    return G.analyze(type, plate, { province: meta && meta.province, issued: series ? series.issued : undefined });
  }

  function renderPlateOnly(text) {
    var stage = $('plate-stage');
    stage.classList.toggle('square', isSquare(state.type));
    $('plate-preview').innerHTML = plateSVG(state.type, text, currentMeta());
  }

  function renderComposer() {
    var result = R.validate(state.type, state.plate);
    var meta = currentMeta();
    renderPlateOnly(result.plate || '');

    $('checks').innerHTML = result.checks.map(function (c, i) {
      var cls = c.ok ? 'ok' : c.level;
      var ico = c.ok ? '✓' : (c.level === 'error' ? '✕' : '!');
      return '<li class="' + cls + '" style="--i:' + i + '"><span class="ico">' + ico + '</span><span>' + esc(c.message) + '</span></li>';
    }).join('');

    var rarity = rarityOf(state.type, result.plate, meta, result.series);
    var badge = $('rarity-badge');
    badge.dataset.tier = result.valid ? rarity.tier : 'invalid';
    badge.textContent = result.valid ? rarity.label : 'Non valida';
    $('plate-stage').dataset.tier = result.valid ? rarity.tier : '';
    $('traits').innerHTML = result.valid ? rarity.traits.map(function (t) {
      return '<li data-tier="' + G.TIERS[t.tier].id + '">✦ ' + esc(t.label) + '</li>';
    }).join('') : '';

    var existing = result.valid ? ledger.findByPlate(result.plate, state.type) : null;
    var mine = existing && existing.owner === ledger.state.activeWallet;
    var facts = [['Targa', '<strong>' + esc(result.formatted || '—') + '</strong>'], ['Tipo', esc(R.TYPES[state.type].label)]];
    if (result.series) facts.push(['Serie', result.series.issued ? 'in circolazione dal ' + result.series.yearLabel + ' circa' : 'non ancora emessa (arriverà verso il ' + result.series.yearLabel + ')']);
    if (meta.province) facts.push(['Provincia', esc(R.PROVINCE[meta.province])]);
    facts.push(['Disponibilità', existing
      ? (mine ? '✅ È già nel tuo garage' : '🔒 Già certificata da ' + esc(garageName(existing.owner)))
      : (result.valid ? '✨ Libera, puoi averla tu' : '—')]);
    $('facts').innerHTML = facts.map(function (f) { return '<dt>' + f[0] + '</dt><dd>' + f[1] + '</dd>'; }).join('');

    $('mint-reward').textContent = '+' + rarity.xp + ' XP';
    $('mint-btn').disabled = !result.valid || !!existing || state.spinning;
    $('mint-btn').dataset.tier = rarity.tier;
    if (!state.minting) $('mint-status').textContent = existing && !mine ? 'Questa combinazione ha già un proprietario: gira la ruota per trovarne un\'altra!' : '';
  }

  // La ruota: i caratteri scorrono e si fermano uno alla volta.
  function spin() {
    if (state.spinning) return;
    var target = R.randomPlate(state.type, { issuedOnly: $('issued-only').checked });
    var w = ledger.activeWallet();
    addSpin(w.address);
    var btn = $('random-btn');

    if (reducedMotion) {
      finishSpin(target);
      return;
    }

    state.spinning = true;
    btn.classList.add('spinning');
    $('mint-btn').disabled = true;
    $('plate-stage').classList.add('rolling');
    var schema = R.TYPES[state.type].pattern.replace(/ /g, '');
    var start = performance.now();
    var lockEvery = 110;
    var base = 280;

    function randomChar(kind) {
      if (kind === 'L') return R.LETTERS[Math.floor(Math.random() * R.LETTERS.length)];
      if (kind === 'D') return String(Math.floor(Math.random() * 10));
      if (kind === 'X') return 'X';
      var pool = R.LETTERS + '0123456789';
      return pool[Math.floor(Math.random() * pool.length)];
    }

    var timer = setInterval(function () {
      var elapsed = performance.now() - start;
      var locked = Math.max(0, Math.floor((elapsed - base) / lockEvery));
      var text = schema.split('').map(function (kind, i) {
        return i < locked ? target[i] : randomChar(kind);
      }).join('');
      $('plate-input').value = R.format(state.type, text);
      renderPlateOnly(text);
      if (locked >= schema.length) {
        clearInterval(timer);
        state.spinning = false;
        btn.classList.remove('spinning');
        $('plate-stage').classList.remove('rolling');
        finishSpin(target);
      }
    }, 55);
  }

  function finishSpin(target) {
    state.plate = target;
    $('plate-input').value = R.format(state.type, target);
    renderComposer();
    var badge = $('rarity-badge');
    badge.classList.remove('reveal');
    void badge.offsetWidth;
    badge.classList.add('reveal');
    var rank = rarityOf(state.type, target, currentMeta(), R.validate(state.type, target).series).rank;
    if (rank >= 2) {
      confetti(badge, 40 + rank * 30);
      toast(rank >= 4 ? '👑 Incredibile, una targa leggendaria!' : rank === 3 ? '🔥 Wow, una targa epica!' : '💎 Hai trovato una targa rara!');
    }
    floatText($('random-btn'), '+' + G.XP.SPIN + ' XP', 'small');
    refreshProgress();
  }

  function mint() {
    var result = R.validate(state.type, state.plate);
    if (!result.valid) return;
    var wallet = ledger.activeWallet();
    var meta = currentMeta();
    var rarity = rarityOf(state.type, result.plate, meta, result.series);
    var btn = $('mint-btn');
    var stage = $('plate-stage');
    btn.disabled = true;
    state.minting = true;
    stage.classList.add('certifying');
    $('mint-status').textContent = 'Stiamo sigillando il certificato della tua targa…';

    setTimeout(function () {
      try {
        ledger.mint({ plate: result.plate, vehicleType: state.type, owner: wallet.address, metadata: meta });
      } catch (e) {
        stage.classList.remove('certifying');
        state.minting = false;
        $('mint-status').textContent = e.message;
        renderComposer();
        return;
      }
      stage.classList.remove('certifying');
      var stamp = $('stamp');
      stamp.classList.remove('show');
      void stamp.offsetWidth;
      stamp.classList.add('show');
      confetti(stage, 90 + rarity.rank * 30);
      floatText(btn, '+' + rarity.xp + ' XP', 'big');
      ['meta-alias', 'meta-make', 'meta-model', 'meta-color'].forEach(function (id) { $(id).value = ''; });
      refreshAll();
      state.minting = false;
      $('mint-status').textContent = '🎉 ' + result.formatted + ' è tua! La trovi nel garage.';
      setTimeout(function () { stamp.classList.remove('show'); }, 2200);
    }, reducedMotion ? 30 : 900);
  }

  // --- Garage ---
  function renderGarage() {
    var wallet = ledger.activeWallet();
    var all = wallet ? ledger.tokensOf(wallet.address) : [];
    var q = $('garage-search').value.trim().toLowerCase();
    var f = $('garage-filter').value;
    var list = all.map(function (t) {
      return { t: t, r: G.analyze(t.vehicleType, t.plate, { province: t.metadata && t.metadata.province }) };
    }).filter(function (x) {
      var t = x.t, m = t.metadata || {};
      if (f && t.vehicleType !== f) return false;
      if (!q) return true;
      return t.plate.toLowerCase().indexOf(q.replace(/\s/g, '')) !== -1 ||
        [m.alias, m.make, m.model, m.color].join(' ').toLowerCase().indexOf(q) !== -1;
    });
    if ($('garage-sort').value === 'rarity') list.sort(function (a, b) { return b.r.rank - a.r.rank; });

    $('garage-empty').hidden = all.length > 0;
    $('garage-grid').innerHTML = list.map(function (x, i) {
      var t = x.t, r = x.r, m = t.metadata || {};
      var title = m.alias || [m.make, m.model].filter(Boolean).join(' ') || R.format(t.vehicleType, t.plate);
      var sub = [m.make, m.model, m.color].filter(Boolean).join(' · ') || 'Tocca "Gestisci" per personalizzarla';
      return '<article class="vehicle" data-tier="' + r.tier + '" style="--i:' + i + '">' +
        '<div class="plate-stage' + (isSquare(t.vehicleType) ? ' square' : '') + '"><div class="tilt">' + plateSVG(t.vehicleType, t.plate, m) + '</div></div>' +
        '<div class="vehicle-body">' +
          '<div class="vehicle-tags"><span class="tag">' + esc(R.TYPES[t.vehicleType].label) + '</span>' +
          '<span class="rarity small" data-tier="' + r.tier + '">' + r.label + '</span></div>' +
          '<strong>' + esc(title) + '</strong>' +
          '<span class="sub">' + esc(sub) + '</span>' +
        '</div>' +
        '<div class="vehicle-foot"><button class="btn small" type="button" data-open="' + t.tokenId + '">Gestisci</button></div>' +
      '</article>';
    }).join('');
    if (all.length && !list.length) {
      $('garage-grid').innerHTML = '<p class="empty">Nessun veicolo corrisponde alla ricerca.</p>';
    }
  }

  // --- Dettaglio targa ---
  function openToken(tokenId) {
    var t = ledger.tokens[tokenId];
    if (!t) return;
    state.openToken = tokenId;
    var m = t.metadata || {};
    var r = G.analyze(t.vehicleType, t.plate, { province: m.province });
    $('dlg-title').textContent = m.alias || 'Targa ' + R.format(t.vehicleType, t.plate);
    var stage = $('dlg-plate');
    stage.classList.toggle('square', isSquare(t.vehicleType));
    stage.dataset.tier = r.tier;
    stage.innerHTML = '<div class="tilt">' + plateSVG(t.vehicleType, t.plate, m) + '</div>';
    $('dlg-badges').innerHTML = '<span class="rarity" data-tier="' + r.tier + '">' + r.label + '</span>' +
      r.traits.map(function (x) { return '<span class="trait" data-tier="' + G.TIERS[x.tier].id + '">✦ ' + esc(x.label) + '</span>'; }).join('');
    $('dlg-facts').innerHTML = [
      ['Targa', '<strong>' + R.format(t.vehicleType, t.plate) + '</strong>'],
      ['Tipo', esc(R.TYPES[t.vehicleType].label)],
      ['Certificata il', fmtDate(t.mintedAt)],
      ['Codice certificato', '<span class="code">' + certCode(t.tokenId) + '</span>']
    ].map(function (f) { return '<dt>' + f[0] + '</dt><dd>' + f[1] + '</dd>'; }).join('');
    $('dlg-alias').value = m.alias || '';
    $('dlg-make').value = m.make || '';
    $('dlg-model').value = m.model || '';
    $('dlg-color').value = m.color || '';
    $('dlg-status').textContent = '';

    var others = ledger.state.wallets.filter(function (w) { return w.address !== ledger.state.activeWallet; });
    $('dlg-to').innerHTML = others.map(function (w) {
      return '<option value="' + w.address + '">' + esc(w.name) + '</option>';
    }).join('');
    $('dlg-transfer-row').hidden = !others.length;
    $('dlg-transfer-hint').textContent = others.length ? '' : 'Crea un altro garage dal menu del profilo per poter cedere questa targa.';

    $('dlg-history').innerHTML = t.history.slice().reverse().map(function (h) {
      var text = h.type === 'MINT' ? '✨ Certificata da ' + esc(garageName(h.to))
        : h.type === 'TRANSFER' ? '🎁 Ceduta da ' + esc(garageName(h.from)) + ' a ' + esc(garageName(h.to))
        : h.type === 'BURN' ? '♻️ Rottamata' : '🔧 Dati del veicolo aggiornati';
      return '<li><span>' + text + '</span><span class="muted">' + fmtDate(h.at) + '</span></li>';
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

  function certificate(t) {
    var m = t.metadata || {};
    var r = G.analyze(t.vehicleType, t.plate, { province: m.province });
    var attrs = [
      { trait_type: 'Tipo veicolo', value: R.TYPES[t.vehicleType].label },
      { trait_type: 'Rarità', value: r.label }
    ];
    r.traits.forEach(function (x) { attrs.push({ trait_type: 'Caratteristica', value: x.label }); });
    if (m.province) attrs.push({ trait_type: 'Provincia', value: m.province });
    if (m.year) attrs.push({ trait_type: 'Anno', value: m.year });
    if (m.make) attrs.push({ trait_type: 'Marca', value: m.make });
    if (m.model) attrs.push({ trait_type: 'Modello', value: m.model });
    if (m.color) attrs.push({ trait_type: 'Colore', value: m.color });
    var svg = plateSVG(t.vehicleType, t.plate, m);
    return {
      name: 'Targa ' + R.format(t.vehicleType, t.plate),
      description: m.alias ? 'Targa italiana di "' + m.alias + '"' : 'Targa italiana da collezione',
      certificate: certCode(t.tokenId),
      garage: garageName(t.owner),
      image: 'data:image/svg+xml;base64,' + btoa(unescape(encodeURIComponent(svg))),
      token_id: t.tokenId,
      owner: t.owner,
      attributes: attrs
    };
  }

  // --- Storico ---
  function renderHistory() {
    var tokens = ledger.tokens;
    var active = ledger.state.activeWallet;
    var items = [];
    ledger.state.chain.forEach(function (b) {
      b.txs.forEach(function (tx) {
        var tok = tokens[tx.tokenId];
        if (!tok) return;
        var plate = R.format(tok.vehicleType, tok.plate);
        var mine = tx.to === active || tx.from === active;
        if (!mine) return;
        var ico, text, xp;
        if (tx.type === 'MINT') { ico = '✨'; text = 'Hai certificato <strong>' + plate + '</strong>'; xp = G.analyze(tx.vehicleType, tx.plate, { province: tx.metadata && tx.metadata.province }).xp; }
        else if (tx.type === 'TRANSFER' && tx.from === active) { ico = '🎁'; text = 'Hai ceduto <strong>' + plate + '</strong> a ' + esc(garageName(tx.to)); xp = G.XP.TRANSFER_OUT; }
        else if (tx.type === 'TRANSFER') { ico = '📦'; text = 'Hai ricevuto <strong>' + plate + '</strong> da ' + esc(garageName(tx.from)); xp = G.XP.TRANSFER_IN; }
        else if (tx.type === 'UPDATE') { ico = '🔧'; text = 'Hai personalizzato <strong>' + plate + '</strong>'; xp = G.XP.UPDATE; }
        else { ico = '♻️'; text = 'Hai rottamato <strong>' + plate + '</strong>'; xp = G.XP.BURN; }
        items.push('<li><span class="f-ico">' + ico + '</span><span class="f-body"><span>' + text + '</span>' +
          '<span class="muted">' + fmtDate(b.timestamp) + '</span></span><span class="f-xp">+' + xp + ' XP</span></li>');
      });
    });
    $('feed').innerHTML = items.reverse().join('') || '<li class="muted">Ancora nessuna attività: inizia creando una targa!</li>';

    $('ledger-body').innerHTML = ledger.state.chain.slice().reverse().map(function (b) {
      return b.txs.map(function (tx) {
        var tok = tokens[tx.tokenId];
        var labels = { GENESIS: 'Apertura archivio', MINT: 'Certificazione', TRANSFER: 'Cessione', UPDATE: 'Personalizzazione', BURN: 'Rottamazione' };
        return '<tr><td>' + b.index + '</td><td>' + fmtDate(b.timestamp) + '</td><td>' + labels[tx.type] + '</td>' +
          '<td>' + (tok ? R.format(tok.vehicleType, tok.plate) : '—') + '</td>' +
          '<td class="code" title="' + b.hash + '">' + b.hash.slice(0, 16) + '…</td></tr>';
      }).join('');
    }).join('');
  }

  function renderGarageMenu() {
    var active = ledger.state.activeWallet;
    $('garage-list').innerHTML = ledger.state.wallets.map(function (w) {
      var s = G.stats(ledger, w.address, { spins: spinsOf(w.address) });
      return '<li><button type="button" class="garage-item' + (w.address === active ? ' active' : '') + '" data-garage="' + w.address + '">' +
        '<span class="avatar">' + esc(initials(w.name)) + '</span>' +
        '<span><strong>' + esc(w.name) + '</strong><span class="muted">Lv ' + s.level.level + ' · ' + s.owned + ' targhe</span></span>' +
        (w.address === active ? '<span class="tick">✓</span>' : '') + '</button></li>';
    }).join('');
    var aw = ledger.activeWallet();
    $('rename-input').value = aw ? aw.name : '';
  }

  function refreshProgress() {
    renderProfile();
    checkProgress();
  }

  function refreshAll() {
    renderComposer();
    renderGarage();
    renderHistory();
    refreshProgress();
    if ($('profile-dialog').open) renderGarageMenu();
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

  function switchGarage(address) {
    ledger.setActiveWallet(address);
    state.progress = null;
    refreshAll();
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
      b.addEventListener('click', function () { if (!state.spinning) setType(b.dataset.type); });
    });

    $('plate-input').addEventListener('input', function (e) {
      if (state.spinning) return;
      state.plate = R.normalize(e.target.value).slice(0, 7);
      var formatted = R.format(state.type, state.plate);
      if (e.target.value !== formatted) e.target.value = formatted;
      renderComposer();
    });

    $('random-btn').addEventListener('click', spin);

    ['province-select', 'year-input', 'meta-alias', 'meta-make', 'meta-model', 'meta-color'].forEach(function (id) {
      $(id).addEventListener('input', renderComposer);
    });

    $('mint-btn').addEventListener('click', mint);
    $('download-svg').addEventListener('click', function () {
      download('targa-' + state.plate + '.svg', plateSVG(state.type, state.plate, currentMeta()), 'image/svg+xml');
    });

    // Profilo / garage
    $('profile-btn').addEventListener('click', function () {
      renderGarageMenu();
      $('profile-dialog').showModal();
    });
    $('garage-list').addEventListener('click', function (e) {
      var b = e.target.closest('[data-garage]');
      if (!b) return;
      switchGarage(b.dataset.garage);
      $('profile-dialog').close();
      toast('Benvenuto in ' + ledger.activeWallet().name);
    });
    $('rename-btn').addEventListener('click', function () {
      var name = $('rename-input').value.trim();
      if (!name) return;
      ledger.renameWallet(ledger.state.activeWallet, name);
      renderGarageMenu();
      refreshAll();
      toast('Garage rinominato');
    });
    $('new-garage-btn').addEventListener('click', function () {
      $('profile-dialog').close();
      openWelcome(true);
    });

    $('welcome-form').addEventListener('submit', function () {
      var name = $('welcome-name').value.trim() || 'Il mio garage';
      var w = ledger.addWallet(name);
      switchGarage(w.address);
      setTimeout(function () { confetti($('profile-btn'), 70); toast('🚗 ' + name + ' è aperto!'); }, 150);
    });
    $('welcome-dialog').addEventListener('cancel', function (e) {
      if (!ledger.state.wallets.length) e.preventDefault();
    });

    // Garage
    $('garage-search').addEventListener('input', renderGarage);
    $('garage-filter').addEventListener('change', renderGarage);
    $('garage-sort').addEventListener('change', renderGarage);
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
      var btn = $('dlg-save');
      if (withToken(function (id, from) { ledger.update(id, from, changes); })) {
        floatText(btn, '+' + G.XP.UPDATE + ' XP');
        toast('🔧 Veicolo personalizzato');
      }
    });
    $('dlg-transfer').addEventListener('click', function () {
      var to = $('dlg-to').value;
      var t = ledger.tokens[state.openToken];
      if (!confirm('Vuoi cedere la targa ' + R.format(t.vehicleType, t.plate) + ' a ' + garageName(to) + '?')) return;
      var btn = $('dlg-transfer');
      if (withToken(function (id, from) { ledger.transfer(id, from, to); })) {
        floatText(btn, '+' + G.XP.TRANSFER_OUT + ' XP');
        confetti(btn, 50);
        toast('🎁 Targa ceduta a ' + garageName(to));
      }
    });
    $('dlg-burn').addEventListener('click', function () {
      var t = ledger.tokens[state.openToken];
      if (!confirm('Rottamare definitivamente la targa ' + R.format(t.vehicleType, t.plate) + '? Tornerà disponibile per tutti.')) return;
      if (withToken(function (id, from) { ledger.burn(id, from); })) toast('♻️ Targa rottamata');
    });
    $('dlg-cert').addEventListener('click', function () {
      var t = ledger.tokens[state.openToken];
      download('certificato-' + t.plate + '.json', JSON.stringify(certificate(t), null, 2), 'application/json');
    });

    // Storico
    $('verify-btn').addEventListener('click', function () {
      var v = ledger.verify();
      toast(v.ok ? '🛡️ Tutti i certificati sono autentici' : '⚠️ Archivio alterato alla voce #' + v.block + ': ' + v.reason);
    });
    $('export-btn').addEventListener('click', function () {
      download('random-targa-backup.json', ledger.exportJSON(true), 'application/json');
      toast('Backup salvato: conservalo in un posto sicuro, contiene l\'accesso ai tuoi garage');
    });
    $('import-file').addEventListener('change', function (e) {
      var file = e.target.files[0];
      if (!file) return;
      file.text().then(function (text) {
        try {
          ledger.importJSON(text);
          state.progress = null;
          if (!ledger.state.wallets.length) openWelcome(false);
          refreshAll();
          toast('Backup ripristinato');
        } catch (err) {
          toast(err.message);
        }
        e.target.value = '';
      });
    });
    $('reset-btn').addEventListener('click', function () {
      if (!confirm('Cancellare tutti i garage, le targhe e i progressi? L\'operazione non è reversibile.')) return;
      ledger.reset();
      try { localStorage.removeItem(SPINS_KEY); } catch (e) { /* noop */ }
      state.progress = null;
      openWelcome(false);
    });

    $('levelup-dialog').addEventListener('close', flushAchievements);

    bindTilt(document.body);
  }

  function openWelcome(another) {
    $('welcome-name').value = another ? 'Garage ' + (ledger.state.wallets.length + 1) : '';
    $('welcome-dialog').showModal();
    $('welcome-name').focus();
  }

  function init() {
    $('province-select').innerHTML += Object.keys(R.PROVINCE).sort().map(function (k) {
      return '<option value="' + k + '">' + k + ' — ' + esc(R.PROVINCE[k]) + '</option>';
    }).join('');
    $('letters').textContent = R.LETTERS.split('').join(' ');
    $('rules-body').innerHTML = Object.keys(R.TYPES).map(function (k) {
      var t = R.TYPES[k];
      return '<tr><td>' + t.label + '</td><td>' + esc(t.description) + '</td><td><code>' + t.example + '</code></td></tr>';
    }).join('');
    $('rarity-legend').innerHTML = G.TIERS.map(function (t) {
      return '<span class="rarity" data-tier="' + t.id + '">' + t.label + ' · +' + (G.XP.MINT + t.bonus) + ' XP</span>';
    }).join('');
    $('xp-rules').innerHTML = [
      ['Certificare una targa', G.XP.MINT + ' XP + bonus rarità (fino a +750)'],
      ['Cedere una targa a un altro garage', G.XP.TRANSFER_OUT + ' XP'],
      ['Ricevere una targa', G.XP.TRANSFER_IN + ' XP'],
      ['Personalizzare un veicolo', G.XP.UPDATE + ' XP'],
      ['Girare la ruota', G.XP.SPIN + ' XP (fino a ' + G.XP.SPIN_CAP + ')']
    ].map(function (r) { return '<li><strong>' + r[0] + '</strong>: ' + r[1] + '</li>'; }).join('');

    bind();
    setType('auto');

    var tab = null;
    try { tab = localStorage.getItem('random-targa:tab'); } catch (e) { /* noop */ }
    if (tab && $('tab-' + tab)) showTab(tab);

    if (!ledger.state.wallets.length) {
      openWelcome(false);
    } else {
      refreshAll();
      checkProgress(true);
    }
  }

  init();
})();
