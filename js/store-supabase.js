/*
 * Archivio condiviso su Supabase: un garage per account (anche anonimo), targhe uniche
 * per tutti gli utenti, cessioni tra persone diverse e notifiche in tempo reale.
 * Lo schema e le regole di sicurezza sono in supabase/migrations.
 */
(function (root) {
  'use strict';

  var PAGE = 1000;

  function SupabaseStore(client) {
    this.sb = client;
    this.caps = { shared: true, multiGarage: false, backup: false, account: true };
    this.user = null;
    this.cache = null;
  }

  function fail(error) {
    if (!error) return;
    // I messaggi delle funzioni del database sono già in italiano.
    throw new Error(error.message || 'Errore di comunicazione con il server');
  }

  SupabaseStore.prototype.init = function () {
    var self = this;
    return this.sb.auth.getSession().then(function (res) {
      if (res.data.session) return res.data.session.user;
      return self.sb.auth.signInAnonymously().then(function (r) {
        fail(r.error);
        return r.data.user;
      });
    }).then(function (user) {
      self.user = user;
      return self.sb.from('profiles').select('onboarded').eq('id', user.id).single();
    }).then(function (r) {
      fail(r.error);
      return { needsOnboarding: !r.data.onboarded };
    });
  };

  // Legge tutte le righe di una tabella a pagine.
  SupabaseStore.prototype.selectAll = function (table, columns, build) {
    var sb = this.sb;
    var rows = [];
    function page(from) {
      var q = sb.from(table).select(columns).range(from, from + PAGE - 1);
      if (build) q = build(q);
      return q.then(function (r) {
        fail(r.error);
        rows = rows.concat(r.data);
        return r.data.length === PAGE ? page(from + PAGE) : rows;
      });
    }
    return page(0);
  };

  SupabaseStore.prototype.load = function () {
    var self = this;
    return Promise.all([
      this.selectAll('profiles', 'id, garage_name, garage_code, spins'),
      this.selectAll('plates', 'id, plate, vehicle_type, owner_id, metadata, minted_at', function (q) {
        return q.is('burned_at', null).order('minted_at', { ascending: false });
      }),
      this.selectAll('plate_events', 'id, plate_id, type, from_id, to_id, data, created_at', function (q) {
        return q.order('id', { ascending: true });
      })
    ]).then(function (res) {
      var garages = res[0].map(function (p) {
        return { id: p.id, name: p.garage_name, code: p.garage_code, spins: p.spins };
      });
      var me = garages.filter(function (g) { return g.id === self.user.id; })[0] || null;
      if (me) {
        me.email = self.user.email || '';
        me.anonymous = !!self.user.is_anonymous;
      }
      var plates = res[1].map(function (p) {
        return { id: p.id, plate: p.plate, vehicleType: p.vehicle_type, owner: p.owner_id, metadata: p.metadata || {}, mintedAt: p.minted_at };
      });
      // La targa compare solo nell'evento MINT: la propago agli eventi successivi.
      var byPlate = {};
      var events = res[2].map(function (e) {
        if (e.type === 'MINT') byPlate[e.plate_id] = { plate: e.data.plate, vehicleType: e.data.vehicle_type };
        var info = byPlate[e.plate_id] || {};
        return {
          id: e.id, type: e.type, plateId: e.plate_id, plate: info.plate, vehicleType: info.vehicleType,
          from: e.from_id, to: e.to_id,
          metadata: e.type === 'MINT' ? e.data.metadata : e.data.changes, at: e.created_at
        };
      });
      self.cache = { me: me, garages: garages, plates: plates, events: events };
      return self.cache;
    });
  };

  SupabaseStore.prototype.rpc = function (name, args) {
    return this.sb.rpc(name, args || {}).then(function (r) { fail(r.error); return r.data; });
  };

  SupabaseStore.prototype.createGarage = function (name) { return this.rpc('rename_garage', { p_name: name }); };
  SupabaseStore.prototype.renameGarage = function (name) { return this.rpc('rename_garage', { p_name: name }); };
  SupabaseStore.prototype.addSpin = function () { return this.rpc('add_spin'); };

  SupabaseStore.prototype.mint = function (plate, vehicleType, metadata) {
    return this.rpc('mint_plate', { p_plate: plate, p_type: vehicleType, p_metadata: metadata });
  };
  SupabaseStore.prototype.transfer = function (plateId, toCode) {
    return this.rpc('transfer_plate', { p_plate_id: plateId, p_to_code: toCode });
  };
  SupabaseStore.prototype.update = function (plateId, changes) {
    return this.rpc('update_plate', { p_plate_id: plateId, p_metadata: changes });
  };
  SupabaseStore.prototype.burn = function (plateId) {
    return this.rpc('burn_plate', { p_plate_id: plateId });
  };

  SupabaseStore.prototype.verify = function () {
    return this.rpc('verify_chain').then(function (rows) {
      var r = rows[0];
      return { ok: r.ok, total: r.total, broken: r.broken_id };
    });
  };

  // Cerca sul server: il garage potrebbe essere nato dopo l'ultimo caricamento.
  SupabaseStore.prototype.findGarageByCode = function (code) {
    var c = String(code || '').trim().toUpperCase();
    if (!/^RT-[0-9A-F]{6}$/.test(c)) return Promise.resolve(null);
    return this.sb.from('profiles').select('id, garage_name, garage_code').eq('garage_code', c).then(function (r) {
      fail(r.error);
      var p = r.data[0];
      return p ? { id: p.id, name: p.garage_name, code: p.garage_code } : null;
    });
  };

  // Rende permanente l'account anonimo: Supabase invia un link di conferma all'email.
  SupabaseStore.prototype.linkEmail = function (email) {
    return this.sb.auth.updateUser({ email: email }, { emailRedirectTo: location.origin + location.pathname })
      .then(function (r) { fail(r.error); });
  };

  // Accesso da un altro dispositivo con link magico.
  SupabaseStore.prototype.signInWithEmail = function (email) {
    return this.sb.auth.signInWithOtp({ email: email, options: { emailRedirectTo: location.origin + location.pathname } })
      .then(function (r) { fail(r.error); });
  };

  SupabaseStore.prototype.signOut = function () {
    return this.sb.auth.signOut().then(function (r) { fail(r.error); });
  };

  // Notifica ogni nuovo evento del registro (cessioni ricevute, targhe prese da altri…).
  SupabaseStore.prototype.onEvent = function (cb) {
    var self = this;
    this.sb.channel('registro')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'plate_events' }, function (payload) { cb(payload.new); })
      .subscribe();
    this.sb.auth.onAuthStateChange(function (event, session) {
      if (event === 'SIGNED_IN' && session && self.user && session.user.id !== self.user.id) location.reload();
      if (event === 'USER_UPDATED' && session) self.user = session.user;
    });
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = { SupabaseStore: SupabaseStore };
  else root.SupabaseStore = SupabaseStore;
})(typeof window !== 'undefined' ? window : globalThis);
