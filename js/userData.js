// Vuniverse - userData.js
(function () {
  "use strict";

  const VUserDataKey = "vuniverse_user_data";
  const VUserDataLegacyKey = "vrealms_user_data";
  const LangStorageKey = "vuniverse_lang";
  const LangStorageLegacyKey = "vrealms_lang";

  const FREE_UNIVERSES = ["hell_king", "heaven_king"];
  const DEFAULT_KNOWN_UNIVERSES = [
    "hell_king",
    "heaven_king",
    "western_president",
    "mega_corp_ceo",
    "new_world_explorer",
    "vampire_lord"
  ];

  let _uiPaused = true;
  let _pendingEmit = false;

  function _isDebug() {
    try { return !!window.__VR_DEBUG; } catch (_) { return false; }
  }

  const _errState = { last: null, ts: 0 };
  function _reportRemoteError(where, err) {
    try {
      if (!_isDebug()) return;
      _errState.last = {
        where: (where || "").toString(),
        message: (err && err.message) ? String(err.message) : String(err || "error"),
        ts: Date.now()
      };
      _errState.ts = Date.now();
      window.dispatchEvent(
        new CustomEvent("vr:remote_error", { detail: { ..._errState.last } })
      );
    } catch (_) {}
  }

  let _remoteQueue = Promise.resolve();

  function queueRemote(fn, where) {
    _remoteQueue = _remoteQueue
      .then(fn)
      .catch((e) => {
        _reportRemoteError(where || "queueRemote", e);
        return null;
      });
    return _remoteQueue;
  }

  function _clampInt(n) {
    return Math.max(0, Math.floor(Number(n || 0)));
  }

  function _safeParse(raw) {
    try { return JSON.parse(raw); } catch (_) { return null; }
  }

  function _uniqTextArray(arr) {
    try {
      const out = [];
      const seen = new Set();
      (Array.isArray(arr) ? arr : []).forEach((v) => {
        const s = String(v || "").trim();
        if (!s || seen.has(s)) return;
        seen.add(s);
        out.push(s);
      });
      return out;
    } catch (_) {
      return [];
    }
  }

  function _mergeUniverses(a, b) {
    return _uniqTextArray([].concat(a || [], b || [], FREE_UNIVERSES));
  }

  const _memState = {
    user_id: "",
    username: "",
    vcoins: 0,
    jetons: 0,
    lang: "fr",
    unlocked_universes: FREE_UNIVERSES.slice(0),
    no_ads: false,
    has_diamond: false,
    updated_at: Date.now(),
    last_sync_at: 0
  };

  function _readLocal() {
    try {
      const raw = localStorage.getItem(VUserDataKey) || localStorage.getItem(VUserDataLegacyKey);
      if (!raw) return null;
      const o = _safeParse(raw);
      if (!o || typeof o !== "object") return null;
      return o;
    } catch (_) {
      return null;
    }
  }

  function _writeLocal(obj) {
    try { localStorage.setItem(VUserDataKey, JSON.stringify(obj)); } catch (_) {}
    try { localStorage.setItem(VUserDataLegacyKey, JSON.stringify(obj)); } catch (_) {}
  }

  function _persistLocal() {
    try {
      _writeLocal({
        user_id: (_memState.user_id || "").toString(),
        username: (_memState.username || "").toString(),
        vcoins: _clampInt(_memState.vcoins || 0),
        jetons: _clampInt(_memState.jetons || 0),
        lang: (_memState.lang || "fr").toString(),
        unlocked_universes: _mergeUniverses(_memState.unlocked_universes, []),
        no_ads: !!_memState.no_ads,
        has_diamond: !!_memState.has_diamond,
        updated_at: Date.now(),
        last_sync_at: Number(_memState.last_sync_at || 0)
      });
    } catch (_) {}

    try { localStorage.setItem(LangStorageKey, (_memState.lang || "fr").toString()); } catch (_) {}
    try { localStorage.setItem(LangStorageLegacyKey, (_memState.lang || "fr").toString()); } catch (_) {}
  }

  function _emitProfile() {
    try {
      if (_uiPaused) { _pendingEmit = true; return; }

      window.dispatchEvent(
        new CustomEvent("vr:profile", {
          detail: {
            user_id: _memState.user_id,
            username: _memState.username,
            lang: _memState.lang,
            vcoins: _memState.vcoins,
            jetons: _memState.jetons,
            unlocked_universes: _mergeUniverses(_memState.unlocked_universes, []),
            no_ads: !!_memState.no_ads,
            has_diamond: !!_memState.has_diamond
          }
        })
      );
    } catch (_) {}
  }

  function _default() {
    return {
      user_id: "",
      username: "",
      vcoins: 0,
      jetons: 0,
      lang: "fr",
      unlocked_universes: FREE_UNIVERSES.slice(0),
      no_ads: false,
      has_diamond: false,
      updated_at: Date.now()
    };
  }

  function _applyMergedRemote(me) {
    if (!me || typeof me !== "object") return false;

    const localBefore = _readLocal() || {};
    const remoteUnlocked = Array.isArray(me.unlocked_universes)
      ? me.unlocked_universes
      : (typeof me.unlocked_universes === "string" && me.unlocked_universes ? [me.unlocked_universes] : []);
    const localUnlocked = Array.isArray(localBefore.unlocked_universes)
      ? localBefore.unlocked_universes
      : _memState.unlocked_universes;

    _memState.user_id = (me.id || _memState.user_id || "").toString();
    _memState.username = (me.username || _memState.username || "").toString();
    _memState.vcoins = _clampInt(typeof me.vcoins !== "undefined" ? me.vcoins : _memState.vcoins);
    _memState.jetons = _clampInt(typeof me.jetons !== "undefined" ? me.jetons : _memState.jetons);
    _memState.lang = (me.lang || _memState.lang || "fr").toString();
    _memState.no_ads = !!(me.no_ads || _memState.no_ads || localBefore.no_ads);
    _memState.has_diamond = !!(me.has_diamond || _memState.has_diamond || localBefore.has_diamond);
    _memState.unlocked_universes = _mergeUniverses(remoteUnlocked, localUnlocked);
    _memState.updated_at = Date.now();
    _memState.last_sync_at = Date.now();

    _emitProfile();
    _persistLocal();
    return true;
  }

  window.VRRemoteStore = window.VRRemoteStore || {
    enabled() {
      return !!(window.sb && window.sb.auth && typeof window.sb.rpc === "function");
    },

    async ensureAuth() {
      const sb = window.sb;
      if (!sb || !sb.auth) return null;

      try {
        if (typeof window.bootstrapAuthAndProfile === "function") {
          const p = await window.bootstrapAuthAndProfile();
          return p?.id || (await this._getUid());
        }
      } catch (e) {
        _reportRemoteError("ensureAuth.bootstrapAuthAndProfile", e);
      }

      const uid = await this._getUid();
      if (uid) return uid;

      try {
        const r = await sb.auth.signInAnonymously();
        if (r?.data?.user?.id) return r.data.user.id;
      } catch (e) {
        _reportRemoteError("ensureAuth.signInAnonymously", e);
      }

      return await this._getUid();
    },

    async _getUid() {
      const sb = window.sb;
      if (!sb || !sb.auth) return null;
      try {
        const r = await sb.auth.getUser();
        return r?.data?.user?.id || null;
      } catch (e) {
        _reportRemoteError("_getUid", e);
        return null;
      }
    },

    async getMe() {
      const sb = window.sb;
      if (!sb || typeof sb.rpc !== "function") return null;

      const uid = await this.ensureAuth();
      if (!uid) return null;

      try {
        const r = await sb.rpc("secure_get_me");
        if (r?.error) {
          _reportRemoteError("rpc.secure_get_me", r.error);
          return null;
        }
        return r?.data || null;
      } catch (e) {
        _reportRemoteError("rpc.secure_get_me.exception", e);
        return null;
      }
    },

    async patchProfileLocalFirst(partial) {
      const sb = window.sb;
      if (!sb || typeof sb.from !== "function") return null;

      const uid = await this.ensureAuth();
      if (!uid) return null;

      const payload = {};

      if (Array.isArray(partial?.unlocked_universes)) {
        payload.unlocked_universes = _mergeUniverses(partial.unlocked_universes, []);
      }
      if (typeof partial?.no_ads !== "undefined") {
        payload.no_ads = !!partial.no_ads;
      }
      if (typeof partial?.has_diamond !== "undefined") {
        payload.has_diamond = !!partial.has_diamond;
      }
      if (typeof partial?.lang !== "undefined") {
        payload.lang = String(partial.lang || "fr");
      }

      if (!Object.keys(payload).length) return null;

      try {
        const q = sb
          .from("profiles")
          .update(payload)
          .eq("id", uid)
          .select("id,username,vcoins,jetons,lang,unlocked_universes,no_ads,has_diamond")
          .single();

        const r = await q;
        if (r?.error) {
          _reportRemoteError("profiles.update", r.error);
          return null;
        }
        return r?.data || null;
      } catch (e) {
        _reportRemoteError("profiles.update.exception", e);
        return null;
      }
    },

    async setUsername(username) {
      const sb = window.sb;
      if (!sb || typeof sb.rpc !== "function") return { ok: false, reason: "no_client" };

      const uid = await this.ensureAuth();
      if (!uid) return { ok: false, reason: "no_auth" };

      try {
        const r = await sb.rpc("secure_set_username", { p_username: username });
        if (r?.error) {
          _reportRemoteError("rpc.secure_set_username", r.error);
          return { ok: false, reason: "rpc_error" };
        }
        return { ok: !!r?.data, reason: r?.data ? "ok" : "taken" };
      } catch (e) {
        _reportRemoteError("rpc.secure_set_username.exception", e);
        return { ok: false, reason: "exception" };
      }
    },

    async addVcoins(delta) {
      const sb = window.sb;
      if (!sb || typeof sb.rpc !== "function") return null;

      const uid = await this.ensureAuth();
      if (!uid) return null;

      const d = Math.floor(Number(delta || 0));
      if (d <= 0) return null;

      try {
        const r = await sb.rpc("secure_add_vcoins", { p_delta: d });
        if (r?.error) {
          _reportRemoteError("rpc.secure_add_vcoins", r.error);
          return null;
        }
        return Number(r?.data ?? 0);
      } catch (e) {
        _reportRemoteError("rpc.secure_add_vcoins.exception", e);
        return null;
      }
    },

    async addJetons(delta) {
      const sb = window.sb;
      if (!sb || typeof sb.rpc !== "function") return null;

      const uid = await this.ensureAuth();
      if (!uid) return null;

      const d = Math.floor(Number(delta || 0));
      if (d <= 0) return null;

      try {
        const r = await sb.rpc("secure_add_jetons", { p_delta: d });
        if (r?.error) {
          _reportRemoteError("rpc.secure_add_jetons", r.error);
          return null;
        }
        return Number(r?.data ?? 0);
      } catch (e) {
        _reportRemoteError("rpc.secure_add_jetons.exception", e);
        return null;
      }
    },

    async spendJetons(cost) {
      const sb = window.sb;
      if (!sb || typeof sb.rpc !== "function") return null;

      const uid = await this.ensureAuth();
      if (!uid) return null;

      const c = Math.floor(Number(cost || 0));
      if (c <= 0) return null;

      try {
        const r = await sb.rpc("secure_spend_jetons", { p_delta: c });
        if (r?.error) {
          _reportRemoteError("rpc.secure_spend_jetons", r.error);
          return null;
        }
        return Number(r?.data ?? 0);
      } catch (e) {
        _reportRemoteError("rpc.secure_spend_jetons.exception", e);
        return null;
      }
    },

    async reduceVcoinsTo(value) {
      const sb = window.sb;
      if (!sb || typeof sb.rpc !== "function") return null;

      const uid = await this.ensureAuth();
      if (!uid) return null;

      const v = Math.max(0, Math.floor(Number(value || 0)));

      try {
        const r = await sb.rpc("secure_reduce_vcoins_to", { p_value: v });
        if (r?.error) {
          _reportRemoteError("rpc.secure_reduce_vcoins_to", r.error);
          return null;
        }
        return Number(r?.data ?? 0);
      } catch (e) {
        _reportRemoteError("rpc.secure_reduce_vcoins_to.exception", e);
        return null;
      }
    },

    async setLang(lang) {
      const sb = window.sb;
      if (!sb || typeof sb.rpc !== "function") return false;

      const uid = await this.ensureAuth();
      if (!uid) return false;

      const l = (lang || "fr").toString().trim().toLowerCase() || "fr";
      try {
        const r = await sb.rpc("secure_set_lang", { p_lang: l });
        if (r?.error) _reportRemoteError("rpc.secure_set_lang", r.error);
        return !r?.error && !!r?.data;
      } catch (e) {
        _reportRemoteError("rpc.secure_set_lang.exception", e);
        return false;
      }
    }
  };

  const VUserData = {
    async init() {
      const cached = _readLocal();
      if (cached) {
        this.save(cached, { silent: true });
      } else {
        this.save(this.load(), { silent: true });
      }

      if (window.VRRemoteStore?.enabled?.()) {
        await this.refresh().catch((e) => {
          _reportRemoteError("VUserData.init.refresh", e);
          return false;
        });
      }

      _uiPaused = false;
      if (_pendingEmit) { _pendingEmit = false; _emitProfile(); }

      return true;
    },

    async refresh() {
      if (!window.VRRemoteStore?.enabled?.()) return false;

      return await queueRemote(async () => {
        const me = await window.VRRemoteStore.getMe();
        if (!me) return false;
        _applyMergedRemote(me);
        return true;
      }, "VUserData.refresh");
    },

    load() {
      try {
        const d = _default();
        return {
          ...d,
          user_id: (_memState.user_id || "").toString(),
          username: (_memState.username || "").toString(),
          vcoins: _clampInt(_memState.vcoins || 0),
          jetons: _clampInt(_memState.jetons || 0),
          lang: (_memState.lang || "fr").toString(),
          unlocked_universes: _mergeUniverses(_memState.unlocked_universes, []),
          no_ads: !!_memState.no_ads,
          has_diamond: !!_memState.has_diamond,
          updated_at: Number(_memState.updated_at || Date.now())
        };
      } catch (_) {
        return _default();
      }
    },

    save(u, opts) {
      const silent = !!(opts && opts.silent);
      try {
        const data = (u && typeof u === "object") ? u : _default();
        _memState.user_id = (data.user_id || _memState.user_id || "").toString();
        _memState.username = (data.username || _memState.username || "").toString();
        _memState.vcoins = _clampInt(typeof data.vcoins !== "undefined" ? data.vcoins : _memState.vcoins);
        _memState.jetons = _clampInt(typeof data.jetons !== "undefined" ? data.jetons : _memState.jetons);
        _memState.lang = (data.lang || _memState.lang || "fr").toString();
        _memState.no_ads = !!(typeof data.no_ads !== "undefined" ? data.no_ads : _memState.no_ads);
        _memState.has_diamond = !!(typeof data.has_diamond !== "undefined" ? data.has_diamond : _memState.has_diamond);

        if (Array.isArray(data.unlocked_universes)) {
          _memState.unlocked_universes = _mergeUniverses(data.unlocked_universes, []);
        } else if (!Array.isArray(_memState.unlocked_universes) || !_memState.unlocked_universes.length) {
          _memState.unlocked_universes = FREE_UNIVERSES.slice(0);
        }

        _memState.updated_at = Date.now();

        if (!silent) _emitProfile();
        _persistLocal();
      } catch (_) {}
    },

    getLastRemoteError() {
      return _isDebug() ? (_errState.last ? { ..._errState.last } : null) : null;
    },

    getUnlockedUniverses() {
      const u = this.load();
      return _mergeUniverses(u.unlocked_universes, []);
    },

    getAllKnownUniverses() {
      const local = this.getUnlockedUniverses();
      return _mergeUniverses(DEFAULT_KNOWN_UNIVERSES, local);
    },

    isUniverseUnlocked(universeId) {
      const id = (universeId || "").toString().trim();
      if (!id) return false;
      if (FREE_UNIVERSES.includes(id)) return true;
      if (this.hasDiamond()) return true;
      const set = new Set(this.getUnlockedUniverses());
      return set.has(id);
    },

    async _syncEntitlementsToRemote() {
      if (!window.VRRemoteStore?.enabled?.()) return false;
      const cur = this.load();

      return await queueRemote(async () => {
        const patched = await window.VRRemoteStore.patchProfileLocalFirst({
          unlocked_universes: cur.unlocked_universes,
          no_ads: cur.no_ads,
          has_diamond: cur.has_diamond
        });

        if (patched && typeof patched === "object") {
          _applyMergedRemote(patched);
          return true;
        }

        await this.refresh().catch(() => false);
        return false;
      }, "VUserData._syncEntitlementsToRemote");
    },

    async unlockUniverseWithVcoins(universeId, price) {
      const id = (universeId || "").toString().trim();
      const cost = _clampInt(price || 600);

      if (!id) return { ok: false, reason: "invalid_universe" };
      if (FREE_UNIVERSES.includes(id) || this.hasDiamond() || this.isUniverseUnlocked(id)) {
        return { ok: true, reason: "already", data: this.load() };
      }

      const cur = this.load();
      if (_clampInt(cur.vcoins) < cost) {
        return { ok: false, reason: "insufficient_vcoins", balance: _clampInt(cur.vcoins), price: cost };
      }

      const next = {
        ...cur,
        vcoins: _clampInt(cur.vcoins) - cost,
        unlocked_universes: _mergeUniverses(cur.unlocked_universes, [id])
      };

      this.save(next);

      queueRemote(async () => {
        try {
          const newv = await window.VRRemoteStore?.reduceVcoinsTo?.(next.vcoins);
          if (typeof newv === "number" && !Number.isNaN(newv)) {
            _memState.vcoins = _clampInt(newv);
            _persistLocal();
            _emitProfile();
          }
        } catch (_) {}
        await this._syncEntitlementsToRemote().catch(() => false);
        return true;
      }, "VUserData.unlockUniverseWithVcoins");

      return { ok: true, reason: "ok", data: this.load() };
    },

    async markUniversePurchased(universeId) {
      const id = (universeId || "").toString().trim();
      if (!id) return { ok: false, reason: "invalid_universe" };
      if (FREE_UNIVERSES.includes(id) || this.hasDiamond() || this.isUniverseUnlocked(id)) {
        return { ok: true, reason: "already", data: this.load() };
      }

      const cur = this.load();
      this.save({
        ...cur,
        unlocked_universes: _mergeUniverses(cur.unlocked_universes, [id])
      });

      this._syncEntitlementsToRemote().catch(() => false);
      return { ok: true, reason: "ok", data: this.load() };
    },

    async activateNoAdsPurchase() {
      const cur = this.load();
      if (cur.no_ads) return { ok: true, reason: "already", data: cur };

      this.save({ ...cur, no_ads: true });
      this._syncEntitlementsToRemote().catch(() => false);
      return { ok: true, reason: "ok", data: this.load() };
    },

    async activateDiamondPurchase() {
      const cur = this.load();
      if (cur.has_diamond) return { ok: true, reason: "already", data: cur };

      this.save({
        ...cur,
        has_diamond: true,
        no_ads: true,
        unlocked_universes: _mergeUniverses(cur.unlocked_universes, this.getAllKnownUniverses())
      });

      this._syncEntitlementsToRemote().catch(() => false);
      return { ok: true, reason: "ok", data: this.load() };
    },

    getUsername() { return (this.load().username || "").toString(); },
    getUserId() { return (this.load().user_id || "").toString(); },
    getLang() { return (this.load().lang || "fr").toString(); },
    getVcoins() { return Number(this.load().vcoins || 0); },
    getJetons() { return Number(this.load().jetons || 0); },
    hasDiamond() { return !!this.load().has_diamond; },
    hasNoAds() { return !!this.load().no_ads; },

    async setUsername(username) {
      const name = (username || "").toString().trim();
      if (name.length < 3 || name.length > 20) return { ok: false, reason: "length" };
      if (!/^[a-zA-Z0-9_-]+$/.test(name)) return { ok: false, reason: "invalid" };
      if (!window.VRRemoteStore?.enabled?.()) return { ok: false, reason: "no_remote" };

      const res = await window.VRRemoteStore.setUsername(name);
      if (res?.ok) {
        await this.refresh().catch(() => false);
        return { ok: true, reason: "ok" };
      }
      return res || { ok: false, reason: "error" };
    },

    async setLang(lang) {
      const l = (lang || "fr").toString().trim().toLowerCase() || "fr";
      const cur = this.load();
      this.save({ ...cur, lang: l });

      if (window.VRRemoteStore?.enabled?.()) {
        const ok = await window.VRRemoteStore.setLang(l);
        if (ok) {
          await this.refresh().catch(() => false);
          return l;
        }
      }
      return l;
    },

    addVcoins(delta) {
      const d = Math.floor(Number(delta || 0));
      if (d <= 0) return this.getVcoins();
      if (!window.VRRemoteStore?.enabled?.()) return this.getVcoins();

      queueRemote(async () => {
        const newv = await window.VRRemoteStore.addVcoins(d);
        if (typeof newv === "number" && !Number.isNaN(newv)) {
          _memState.vcoins = _clampInt(newv);
          _memState.updated_at = Date.now();
          _emitProfile();
          _persistLocal();
        } else {
          await this.refresh().catch(() => false);
        }
        return true;
      }, "VUserData.addVcoins");

      return this.getVcoins();
    },

    setVcoins(v) {
      const target = Math.max(0, Math.floor(Number(v || 0)));
      if (!window.VRRemoteStore?.enabled?.()) return this.getVcoins();

      queueRemote(async () => {
        const newv = await window.VRRemoteStore.reduceVcoinsTo(target);
        if (typeof newv === "number" && !Number.isNaN(newv)) {
          _memState.vcoins = _clampInt(newv);
          _memState.updated_at = Date.now();
          _emitProfile();
          _persistLocal();
        } else {
          await this.refresh().catch(() => false);
        }
        return true;
      }, "VUserData.setVcoins");

      return this.getVcoins();
    },

    addJetons(delta) {
      const d = Math.floor(Number(delta || 0));
      if (d <= 0) return this.getJetons();
      if (!window.VRRemoteStore?.enabled?.()) return this.getJetons();

      queueRemote(async () => {
        const newj = await window.VRRemoteStore.addJetons(d);
        if (typeof newj === "number" && !Number.isNaN(newj)) {
          _memState.jetons = _clampInt(newj);
          _memState.updated_at = Date.now();
          _emitProfile();
          _persistLocal();
        } else {
          await this.refresh().catch(() => false);
        }
        return true;
      }, "VUserData.addJetons");

      return this.getJetons();
    },

    async addVcoinsAsync(delta) {
      const d = Math.floor(Number(delta || 0));
      if (d <= 0) return this.getVcoins();
      if (!window.VRRemoteStore?.enabled?.()) return this.getVcoins();

      const out = await queueRemote(async () => {
        const newv = await window.VRRemoteStore.addVcoins(d);
        if (typeof newv === "number" && !Number.isNaN(newv)) {
          _memState.vcoins = _clampInt(newv);
          _memState.updated_at = Date.now();
          _emitProfile();
          _persistLocal();
          return _memState.vcoins;
        }
        await this.refresh().catch(() => false);
        return this.getVcoins();
      }, "VUserData.addVcoinsAsync");

      return (typeof out === "number" && !Number.isNaN(out)) ? out : this.getVcoins();
    },

    async addJetonsAsync(delta) {
      const d = Math.floor(Number(delta || 0));
      if (d <= 0) return this.getJetons();
      if (!window.VRRemoteStore?.enabled?.()) return this.getJetons();

      const out = await queueRemote(async () => {
        const newj = await window.VRRemoteStore.addJetons(d);
        if (typeof newj === "number" && !Number.isNaN(newj)) {
          _memState.jetons = _clampInt(newj);
          _memState.updated_at = Date.now();
          _emitProfile();
          _persistLocal();
          return _memState.jetons;
        }
        await this.refresh().catch(() => false);
        return this.getJetons();
      }, "VUserData.addJetonsAsync");

      return (typeof out === "number" && !Number.isNaN(out)) ? out : this.getJetons();
    },

    async setVcoinsAsync(v) {
      const target = Math.max(0, Math.floor(Number(v || 0)));
      if (!window.VRRemoteStore?.enabled?.()) return this.getVcoins();

      const out = await queueRemote(async () => {
        const newv = await window.VRRemoteStore.reduceVcoinsTo(target);
        if (typeof newv === "number" && !Number.isNaN(newv)) {
          _memState.vcoins = _clampInt(newv);
          _memState.updated_at = Date.now();
          _emitProfile();
          _persistLocal();
          return _memState.vcoins;
        }
        await this.refresh().catch(() => false);
        return this.getVcoins();
      }, "VUserData.setVcoinsAsync");

      return (typeof out === "number" && !Number.isNaN(out)) ? out : this.getVcoins();
    },

    async spendJetons(cost) {
      const c = Math.floor(Number(cost || 0));
      if (c <= 0) return false;
      if (!window.VRRemoteStore?.enabled?.()) return false;

      const newBal = await window.VRRemoteStore.spendJetons(c);

      if (typeof newBal !== "number" || Number.isNaN(newBal)) {
        await this.refresh().catch(() => false);
        return false;
      }

      _memState.jetons = _clampInt(newBal);
      _memState.updated_at = Date.now();
      _emitProfile();
      _persistLocal();

      return true;
    }
  };

  window.VUserData = VUserData;
})();