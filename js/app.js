(function () {
  'use strict';

  var R = window.TargaRules;
  var G = window.TargaGame;
  var CONFIG = window.RANDOM_TARGA_CONFIG || {};
  var SUPABASE_JS = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.117.3/dist/umd/supabase.js';

  var reducedMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  var store = null;
  // Fotografia dei dati: { me, garages, plates, events }.
  var data = { me: null, garages: [], plates: [], events: [] };

  var state = {
    type: 'auto',
    plate: '',
    openToken: null,
    spinning: false,
    minting: false,
    onboarding: false,
    transferTo: null,
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

  function delay(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

  function isSquare(type) { return type === 'moto' || type === 'ciclomotore'; }

  function plateSVG(type, plate, meta) {
    return R.toSVG(type, plate, { province: meta && meta.province, year: meta && meta.year });
  }

  function initials(name) {
    return String(name || 'G').trim().split(/\s+/).slice(0, 2).map(function (w) { return w[0]; }).join('').toUpperCase();
  }

  function sameId(a, b) { return !!a && String(a).toLowerCase() === String(b || '').toLowerCase(); }

  function garageById(id) {
    return data.garages.filter(function (g) { return sameId(g.id, id); })[0] || null;
  }

  function garageName(id) {
    var g = garageById(id);
    return g ? g.name : 'un altro garage';
  }

  // Codice certificato leggibile, ricavato dall'identificativo interno.
  function certCode(id) {
    var hex = String(id).replace(/^0x/, '').replace(/[^0-9a-f]/gi, '');
    return 'RT-' + hex.slice(0, 4).toUpperCase() + '-' + hex.slice(-4).toUpperCase();
  }

  function myId() { return data.me ? data.me.id : null; }

  function platesOf(id) {
    return data.plates.filter(function (p) { return sameId(p.owner, id); });
  }

  function findPlate(plate, type) {
    return data.plates.filter(function (p) { return p.plate === plate && p.vehicleType === type; })[0] || null;
  }

  function plateById(id) {
    return data.plates.filter(function (p) { return p.id === id; })[0] || null;
  }

  function statsFor(garage) {
    return G.stats({ id: garage.id, events: data.events, owned: platesOf(garage.id).length, spins: garage.spins });
  }

  function currentStats() {
    return data.me ? statsFor(garageById(data.me.id) || data.me) : null;
  }

  // --- Effetti ---
  var toastTimer;
  function toast(msg) {
    var t = $('toast');
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.classList.remove('show'); }, 3000);
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
    var snap = { id: myId(), level: s.level.level, ids: unlocked.map(function (a) { return a.id; }) };
    var prev = state.progress;
    state.progress = snap;
    if (silent || !prev || prev.id !== snap.id) return;
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
      var el = e.target.closest && e.target.closest('.tilt');
      if (!el) return;
      var r = el.getBoundingClientRect();
      var x = (e.clientX - r.left) / r.width - 0.5;
      var y = (e.clientY - r.top) / r.height - 0.5;
      el.style.setProperty('--rx', (-y * 12).toFixed(2) + 'deg');
      el.style.setProperty('--ry', (x * 16).toFixed(2) + 'deg');
    });
    root.addEventListener('pointerout', function (e) {
      var el = e.target.closest && e.target.closest('.tilt');
      if (el && !el.contains(e.relatedTarget)) {
        el.style.setProperty('--rx', '0deg');
        el.style.setProperty('--ry', '0deg');
      }
    });
  }

  // --- Dati ---
  function refresh() {
    return store.load().then(function (d) {
      data = d;
      renderAll();
    });
  }

  // Esegue un'azione sull'archivio mostrando l'eventuale errore nel campo indicato.
  function run(action, statusEl) {
    if (statusEl) statusEl.textContent = '';
    return action().then(refresh).then(function () { return true; }, function (e) {
      if (statusEl) statusEl.textContent = e.message;
      else toast(e.message);
      return false;
    });
  }

  // --- Profilo e progressi ---
  function renderProfile() {
    var s = currentStats();
    if (!data.me || !s) return;
    var lv = s.level;
    $('profile-name').textContent = data.me.name;
    $('profile-avatar').textContent = initials(data.me.name);
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
    $('plate-stage').classList.toggle('square', isSquare(state.type));
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

    var existing = result.valid ? findPlate(result.plate, state.type) : null;
    var mine = existing && sameId(existing.owner, myId());
    var facts = [['Targa', '<strong>' + esc(result.formatted || '—') + '</strong>'], ['Tipo', esc(R.TYPES[state.type].label)]];
    if (result.series) facts.push(['Serie', result.series.issued ? 'in circolazione dal ' + result.series.yearLabel + ' circa' : 'non ancora emessa (arriverà verso il ' + result.series.yearLabel + ')']);
    if (meta.province) facts.push(['Provincia', esc(R.PROVINCE[meta.province])]);
    facts.push(['Disponibilità', existing
      ? (mine ? '✅ È già nel tuo garage' : '🔒 Già certificata da ' + esc(garageName(existing.owner)))
      : (result.valid ? '✨ Libera, puoi averla tu' : '—')]);
    $('facts').innerHTML = facts.map(function (f) { return '<dt>' + f[0] + '</dt><dd>' + f[1] + '</dd>'; }).join('');

    $('mint-reward').textContent = '+' + rarity.xp + ' XP';
    $('mint-btn').disabled = !result.valid || !!existing || state.spinning || state.minting || !data.me;
    if (!state.minting) $('mint-status').textContent = existing && !mine ? 'Questa combinazione ha già un proprietario: gira la ruota per trovarne un\'altra!' : '';
  }

  // La ruota: i caratteri scorrono e si fermano uno alla volta.
  function spin() {
    if (state.spinning || !data.me) return;
    var target = R.randomPlate(state.type, { issuedOnly: $('issued-only').checked });
    store.addSpin().catch(function () { /* il giro resta valido anche se non viene contato */ });
    var g = garageById(myId());
    if (g) g.spins = (g.spins || 0) + 1;

    if (reducedMotion) {
      finishSpin(target);
      return;
    }

    var btn = $('random-btn');
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
    renderProfile();
    renderLeaderboard();
    checkProgress();
  }

  function mint() {
    var result = R.validate(state.type, state.plate);
    if (!result.valid) return;
    var meta = currentMeta();
    var rarity = rarityOf(state.type, result.plate, meta, result.series);
    var btn = $('mint-btn');
    var stage = $('plate-stage');
    btn.disabled = true;
    state.minting = true;
    stage.classList.add('certifying');
    $('mint-status').textContent = 'Stiamo sigillando il certificato della tua targa…';

    Promise.all([store.mint(result.plate, state.type, meta), delay(reducedMotion ? 0 : 900)])
      .then(refresh)
      .then(function () {
        stage.classList.remove('certifying');
        var stamp = $('stamp');
        stamp.classList.remove('show');
        void stamp.offsetWidth;
        stamp.classList.add('show');
        confetti(stage, 90 + rarity.rank * 30);
        floatText(btn, '+' + rarity.xp + ' XP', 'big');
        ['meta-alias', 'meta-make', 'meta-model', 'meta-color'].forEach(function (id) { $(id).value = ''; });
        state.minting = false;
        renderComposer();
        $('mint-status').textContent = '🎉 ' + result.formatted + ' è tua! La trovi nel garage.';
        setTimeout(function () { stamp.classList.remove('show'); }, 2200);
      }, function (e) {
        stage.classList.remove('certifying');
        state.minting = false;
        // Qualcun altro potrebbe averla appena presa: aggiorniamo i dati.
        refresh().catch(function () { /* noop */ }).then(function () { $('mint-status').textContent = e.message; });
      });
  }

  // --- Garage ---
  function renderGarage() {
    var all = platesOf(myId());
    var q = $('garage-search').value.trim().toLowerCase();
    var f = $('garage-filter').value;
    var list = all.map(function (t) {
      return { t: t, r: G.analyze(t.vehicleType, t.plate, { province: t.metadata.province }) };
    }).filter(function (x) {
      var t = x.t, m = t.metadata;
      if (f && t.vehicleType !== f) return false;
      if (!q) return true;
      return t.plate.toLowerCase().indexOf(q.replace(/\s/g, '')) !== -1 ||
        [m.alias, m.make, m.model, m.color].join(' ').toLowerCase().indexOf(q) !== -1;
    });
    if ($('garage-sort').value === 'rarity') list.sort(function (a, b) { return b.r.rank - a.r.rank; });

    $('garage-empty').hidden = all.length > 0;
    $('garage-grid').innerHTML = list.map(function (x, i) {
      var t = x.t, r = x.r, m = t.metadata;
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
        '<div class="vehicle-foot"><button class="btn small" type="button" data-open="' + esc(t.id) + '">Gestisci</button></div>' +
      '</article>';
    }).join('');
    if (all.length && !list.length) {
      $('garage-grid').innerHTML = '<p class="empty">Nessun veicolo corrisponde alla ricerca.</p>';
    }
  }

  // --- Dettaglio targa ---
  function openToken(plateId) {
    var t = plateById(plateId);
    if (!t) return;
    var reopening = state.openToken === plateId && $('token-dialog').open;
    state.openToken = plateId;
    var m = t.metadata;
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
      ['Codice certificato', '<span class="code">' + certCode(t.id) + '</span>']
    ].map(function (f) { return '<dt>' + f[0] + '</dt><dd>' + f[1] + '</dd>'; }).join('');
    if (!reopening) {
      $('dlg-alias').value = m.alias || '';
      $('dlg-make').value = m.make || '';
      $('dlg-model').value = m.model || '';
      $('dlg-color').value = m.color || '';
      $('dlg-status').textContent = '';
      $('dlg-to').value = '';
    }
    if (!reopening) renderTransferTarget();

    // In modalità demo suggeriamo gli altri garage del dispositivo.
    $('garage-codes').innerHTML = store.caps.multiGarage ? data.garages.filter(function (g) { return !sameId(g.id, myId()); }).map(function (g) {
      return '<option value="' + esc(g.code) + '">' + esc(g.name) + '</option>';
    }).join('') : '';

    $('dlg-history').innerHTML = data.events.filter(function (e) { return e.plateId === t.id; }).reverse().map(function (h) {
      var text = h.type === 'MINT' ? '✨ Certificata da ' + esc(garageName(h.to))
        : h.type === 'TRANSFER' ? '🎁 Ceduta da ' + esc(garageName(h.from)) + ' a ' + esc(garageName(h.to))
        : h.type === 'BURN' ? '♻️ Rottamata' : '🔧 Dati del veicolo aggiornati';
      return '<li><span>' + text + '</span><span class="muted">' + fmtDate(h.at) + '</span></li>';
    }).join('');
    var dlg = $('token-dialog');
    if (!dlg.open) dlg.showModal();
  }

  // Mostra il nome del garage destinatario mentre si digita il codice.
  var lookupSeq = 0;
  function renderTransferTarget() {
    var code = $('dlg-to').value.trim();
    var seq = ++lookupSeq;
    state.transferTo = null;
    $('dlg-transfer').disabled = true;
    $('dlg-to-name').dataset.ok = '';
    if (!code) {
      $('dlg-to-name').textContent = 'Chiedi al destinatario il suo codice garage (lo trova nel suo profilo).';
      return;
    }
    store.findGarageByCode(code).then(function (g) {
      if (seq !== lookupSeq) return;
      var self = g && sameId(g.id, myId());
      $('dlg-to-name').textContent = g ? (self ? 'Questo è il tuo garage' : '→ ' + g.name) : 'Nessun garage con questo codice';
      $('dlg-to-name').dataset.ok = g && !self ? '1' : '';
      $('dlg-transfer').disabled = !g || !!self;
      state.transferTo = g && !self ? g : null;
    }, function () { /* riprova alla prossima digitazione */ });
  }

  function certificate(t) {
    var m = t.metadata;
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
      certificate: certCode(t.id),
      garage: garageName(t.owner),
      image: 'data:image/svg+xml;base64,' + btoa(unescape(encodeURIComponent(svg))),
      token_id: t.id,
      attributes: attrs
    };
  }

  // --- Storico ---
  function renderHistory() {
    var me = myId();
    var items = data.events.filter(function (e) { return sameId(e.to, me) || sameId(e.from, me); }).map(function (e) {
      var plate = e.plate ? R.format(e.vehicleType, e.plate) : '—';
      var ico, text, xp;
      if (e.type === 'MINT') { ico = '✨'; text = 'Hai certificato <strong>' + plate + '</strong>'; xp = G.analyze(e.vehicleType, e.plate, { province: e.metadata && e.metadata.province }).xp; }
      else if (e.type === 'TRANSFER' && sameId(e.from, me)) { ico = '🎁'; text = 'Hai ceduto <strong>' + plate + '</strong> a ' + esc(garageName(e.to)); xp = G.XP.TRANSFER_OUT; }
      else if (e.type === 'TRANSFER') { ico = '📦'; text = 'Hai ricevuto <strong>' + plate + '</strong> da ' + esc(garageName(e.from)); xp = G.XP.TRANSFER_IN; }
      else if (e.type === 'UPDATE') { ico = '🔧'; text = 'Hai personalizzato <strong>' + plate + '</strong>'; xp = G.XP.UPDATE; }
      else { ico = '♻️'; text = 'Hai rottamato <strong>' + plate + '</strong>'; xp = G.XP.BURN; }
      return '<li><span class="f-ico">' + ico + '</span><span class="f-body"><span>' + text + '</span>' +
        '<span class="muted">' + fmtDate(e.at) + '</span></span><span class="f-xp">+' + xp + ' XP</span></li>';
    });
    $('feed').innerHTML = items.reverse().join('') || '<li class="muted">Ancora nessuna attività: inizia creando una targa!</li>';

    var labels = { MINT: 'Certificazione', TRANSFER: 'Cessione', UPDATE: 'Personalizzazione', BURN: 'Rottamazione' };
    $('ledger-body').innerHTML = data.events.slice().reverse().slice(0, 200).map(function (e) {
      return '<tr><td>' + e.id + '</td><td>' + fmtDate(e.at) + '</td><td>' + labels[e.type] + '</td>' +
        '<td>' + (e.plate ? R.format(e.vehicleType, e.plate) : '—') + '</td>' +
        '<td>' + esc(garageName(e.type === 'MINT' || e.type === 'TRANSFER' ? e.to : e.from)) + '</td></tr>';
    }).join('');
  }

  // --- Classifica ---
  function renderLeaderboard() {
    var rows = data.garages.map(function (g) {
      return { g: g, s: statsFor(g) };
    }).filter(function (x) { return x.s.xp > 0 || sameId(x.g.id, myId()); })
      .sort(function (a, b) { return b.s.xp - a.s.xp; });
    var medals = ['🥇', '🥈', '🥉'];
    $('leaderboard-body').innerHTML = rows.slice(0, 50).map(function (x, i) {
      var me = sameId(x.g.id, myId());
      return '<tr class="' + (me ? 'me' : '') + '" style="--i:' + i + '">' +
        '<td class="rank">' + (medals[i] || i + 1) + '</td>' +
        '<td><span class="lb-name"><span class="avatar small">' + esc(initials(x.g.name)) + '</span><span>' + esc(x.g.name) + '</span>' + (me ? '<span class="tag">Tu</span>' : '') + '</span></td>' +
        '<td>Lv ' + x.s.level.level + ' · ' + esc(x.s.level.name) + '</td>' +
        '<td class="num">' + x.s.xp.toLocaleString('it-IT') + '</td>' +
        '<td class="num">' + x.s.owned + '</td>' +
        '<td>' + (x.s.minted ? '<span class="rarity small" data-tier="' + G.TIERS[x.s.bestRank].id + '">' + G.TIERS[x.s.bestRank].label + '</span>' : '—') + '</td>' +
      '</tr>';
    }).join('');
    var pos = -1;
    rows.forEach(function (x, i) { if (sameId(x.g.id, myId())) pos = i; });
    $('leaderboard-me').textContent = pos >= 0 ? 'Sei in posizione ' + (pos + 1) + ' su ' + rows.length + '.' : '';
  }

  // --- Profilo ---
  function renderProfileDialog() {
    var me = data.me;
    if (!me) return;
    $('my-code').textContent = me.code;
    $('rename-input').value = me.name;
    $('local-garages').hidden = !store.caps.multiGarage;
    $('account-section').hidden = !store.caps.account;
    if (store.caps.multiGarage) {
      $('garage-list').innerHTML = data.garages.map(function (g) {
        var s = statsFor(g);
        var active = sameId(g.id, me.id);
        return '<li><button type="button" class="garage-item' + (active ? ' active' : '') + '" data-garage="' + esc(g.id) + '">' +
          '<span class="avatar">' + esc(initials(g.name)) + '</span>' +
          '<span><strong>' + esc(g.name) + '</strong><span class="muted">Lv ' + s.level.level + ' · ' + s.owned + ' targhe</span></span>' +
          (active ? '<span class="tick">✓</span>' : '') + '</button></li>';
      }).join('');
    }
    if (store.caps.account) {
      $('account-anon').hidden = !me.anonymous;
      $('account-linked').hidden = !!me.anonymous;
      $('account-email').textContent = me.email;
    }
  }

  function renderAll() {
    renderComposer();
    renderGarage();
    renderHistory();
    renderLeaderboard();
    renderProfile();
    checkProgress();
    if ($('profile-dialog').open) renderProfileDialog();
    if (state.openToken && $('token-dialog').open) {
      var t = plateById(state.openToken);
      if (!t || !sameId(t.owner, myId())) $('token-dialog').close();
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
      if (!data.me) return;
      $('profile-status').textContent = '';
      renderProfileDialog();
      $('profile-dialog').showModal();
    });
    $('copy-code').addEventListener('click', function () {
      if (navigator.clipboard) navigator.clipboard.writeText(data.me.code).then(function () { toast('Codice garage copiato'); });
    });
    $('garage-list').addEventListener('click', function (e) {
      var b = e.target.closest('[data-garage]');
      if (!b) return;
      state.progress = null;
      run(function () { return store.switchGarage(b.dataset.garage); }).then(function () {
        $('profile-dialog').close();
        checkProgress(true);
        toast('Benvenuto in ' + data.me.name);
      });
    });
    $('rename-btn').addEventListener('click', function () {
      var name = $('rename-input').value.trim();
      if (!name) return;
      run(function () { return store.renameGarage(name); }, $('profile-status')).then(function (ok) {
        if (ok) toast('Garage rinominato');
      });
    });
    $('new-garage-btn').addEventListener('click', function () {
      $('profile-dialog').close();
      openWelcome(true);
    });
    $('link-email-btn').addEventListener('click', function () {
      var email = $('link-email').value.trim();
      if (!email) return;
      store.linkEmail(email).then(function () {
        $('profile-status').textContent = '📬 Controlla la posta: conferma il link e il tuo garage sarà salvato.';
      }, function (e) { $('profile-status').textContent = e.message; });
    });
    $('login-email-btn').addEventListener('click', function () {
      var email = $('login-email').value.trim();
      if (!email) return;
      if (!confirm('Accedendo a un altro account lascerai questo garage, che non è collegato a un\'email. Continuare?')) return;
      store.signInWithEmail(email).then(function () {
        $('profile-status').textContent = '📬 Ti abbiamo inviato un link per entrare: aprilo da questo dispositivo.';
      }, function (e) { $('profile-status').textContent = e.message; });
    });
    $('logout-btn').addEventListener('click', function () {
      store.signOut().then(function () { location.reload(); }, function (e) { $('profile-status').textContent = e.message; });
    });

    $('welcome-form').addEventListener('submit', function () {
      var name = $('welcome-name').value.trim() || 'Il mio garage';
      state.progress = null;
      state.onboarding = false;
      run(function () { return store.createGarage(name); }).then(function () {
        checkProgress(true);
        setTimeout(function () { confetti($('profile-btn'), 70); toast('🚗 ' + name + ' è aperto!'); }, 150);
      });
    });
    $('welcome-dialog').addEventListener('cancel', function (e) {
      if (state.onboarding) e.preventDefault();
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
      run(function () { return store.update(state.openToken, changes); }, $('dlg-status')).then(function (ok) {
        if (!ok) return;
        floatText(btn, '+' + G.XP.UPDATE + ' XP');
        toast('🔧 Veicolo personalizzato');
      });
    });
    $('dlg-to').addEventListener('input', renderTransferTarget);
    $('dlg-transfer').addEventListener('click', function () {
      var code = $('dlg-to').value.trim();
      var to = state.transferTo;
      var t = plateById(state.openToken);
      if (!to || !confirm('Vuoi cedere la targa ' + R.format(t.vehicleType, t.plate) + ' a ' + to.name + '?')) return;
      var btn = $('dlg-transfer');
      run(function () { return store.transfer(state.openToken, code); }, $('dlg-status')).then(function (ok) {
        if (!ok) return;
        floatText(btn, '+' + G.XP.TRANSFER_OUT + ' XP');
        confetti(btn, 50);
        toast('🎁 Targa ceduta a ' + to.name);
      });
    });
    $('dlg-burn').addEventListener('click', function () {
      var t = plateById(state.openToken);
      if (!confirm('Rottamare definitivamente la targa ' + R.format(t.vehicleType, t.plate) + '? Tornerà disponibile per tutti.')) return;
      run(function () { return store.burn(state.openToken); }, $('dlg-status')).then(function (ok) {
        if (ok) toast('♻️ Targa rottamata');
      });
    });
    $('dlg-cert').addEventListener('click', function () {
      var t = plateById(state.openToken);
      download('certificato-' + t.plate + '.json', JSON.stringify(certificate(t), null, 2), 'application/json');
    });

    // Storico
    $('verify-btn').addEventListener('click', function () {
      store.verify().then(function (v) {
        toast(v.ok ? '🛡️ Archivio integro: ' + v.total + ' operazioni verificate' : '⚠️ Archivio alterato alla voce #' + v.broken);
      }, function (e) { toast(e.message); });
    });
    $('export-btn').addEventListener('click', function () {
      download('random-targa-backup.json', store.exportBackup(), 'application/json');
      toast('Backup salvato: conservalo in un posto sicuro, contiene l\'accesso ai tuoi garage');
    });
    $('import-file').addEventListener('change', function (e) {
      var file = e.target.files[0];
      if (!file) return;
      file.text().then(function (text) {
        state.progress = null;
        return run(function () { return store.importBackup(text); }).then(function (ok) {
          if (!ok) return;
          if (!data.me) openWelcome(false);
          checkProgress(true);
          toast('Backup ripristinato');
        });
      }).then(function () { e.target.value = ''; });
    });
    $('reset-btn').addEventListener('click', function () {
      if (!confirm('Cancellare tutti i garage, le targhe e i progressi? L\'operazione non è reversibile.')) return;
      state.progress = null;
      run(function () { return store.reset(); }).then(function () { openWelcome(false); });
    });

    $('levelup-dialog').addEventListener('close', flushAchievements);

    bindTilt(document.body);
  }

  function openWelcome(another) {
    state.onboarding = !another;
    $('welcome-name').value = another ? 'Garage ' + (data.garages.length + 1) : '';
    $('welcome-dialog').showModal();
    $('welcome-name').focus();
  }

  function loadScript(src) {
    return new Promise(function (resolve, reject) {
      var s = document.createElement('script');
      s.src = src;
      s.onload = resolve;
      s.onerror = function () { reject(new Error('Impossibile caricare il servizio online. Controlla la connessione.')); };
      document.head.appendChild(s);
    });
  }

  function createStore() {
    if (CONFIG.supabaseUrl && CONFIG.supabaseAnonKey) {
      return loadScript(SUPABASE_JS).then(function () {
        var client = window.supabase.createClient(CONFIG.supabaseUrl, CONFIG.supabaseAnonKey);
        return new window.SupabaseStore(client);
      });
    }
    return Promise.resolve(new window.LocalStore());
  }

  // Aggiornamenti in tempo reale dal registro condiviso.
  var reloadTimer;
  function onRemoteEvent(ev) {
    clearTimeout(reloadTimer);
    reloadTimer = setTimeout(function () {
      refresh().then(function () {
        if (ev && ev.type === 'TRANSFER' && sameId(ev.to_id, myId())) {
          var p = plateById(ev.plate_id);
          toast('📦 Hai ricevuto ' + (p ? 'la targa ' + R.format(p.vehicleType, p.plate) : 'una targa') + ' da ' + garageName(ev.from_id) + '!');
          confetti($('profile-btn'), 80);
        }
      }).catch(function () { /* noop */ });
    }, 250);
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

    createStore().then(function (s) {
      store = s;
      document.body.dataset.mode = s.caps.shared ? 'shared' : 'local';
      return store.init();
    }).then(function (info) {
      store.onEvent(onRemoteEvent);
      return refresh().then(function () {
        checkProgress(true);
        document.body.classList.remove('loading');
        if (info.needsOnboarding) openWelcome(false);
      });
    }).catch(function (e) {
      document.body.classList.remove('loading');
      $('boot-error').hidden = false;
      $('boot-error-msg').textContent = e.message;
    });
  }

  init();
})();
