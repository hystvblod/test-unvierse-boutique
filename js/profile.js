// Vuniverse - js/profile.js
// Gère:
// - pseudo
// - vcoins / jetons
// - badges localStorage + base profiles.universe_badges
// - 1 seul empty pour tous les badges
// - modal d'aperçu badge
//
// Base attendue dans profiles:
// - universe_badges jsonb
// - universe_badges_updated_at timestamptz

(function () {
  "use strict";

  const BADGES_STORAGE_KEY = "vuniverse_badges_v1";

  const FALLBACK_UNIVERSES = [
    "hell_king",
    "heaven_king",
    "western_president",
    "mega_corp_ceo",
    "new_world_explorer",
    "vampire_lord"
  ];

  function $(id) {
    return document.getElementById(id);
  }

  function _safeParse(raw) {
    try { return JSON.parse(raw); } catch (_) { return null; }
  }

  function _norm(v) {
    return String(v || "").trim().toLowerCase();
  }

  function _now() {
    return Date.now();
  }

  function _bool(v) {
    return !!v;
  }

  function _fromIso(v) {
    try {
      const t = new Date(v).getTime();
      return Number.isFinite(t) ? t : 0;
    } catch (_) {
      return 0;
    }
  }

  function _toIso(ts) {
    try {
      return new Date(Number(ts || Date.now())).toISOString();
    } catch (_) {
      return new Date().toISOString();
    }
  }

  function _normalizeBadgeMap(input) {
    const out = {};
    const src = (input && typeof input === "object") ? input : {};

    Object.keys(src).forEach((universeId) => {
      const uid = _norm(universeId);
      if (!uid) return;

      const row = src[universeId];
      if (!row || typeof row !== "object") return;

      out[uid] = {
        bronze: _bool(row.bronze),
        silver: _bool(row.silver),
        gold: _bool(row.gold)
      };
    });

    return out;
  }

  function _readLocalBadges() {
    const raw = localStorage.getItem(BADGES_STORAGE_KEY);
    const parsed = _safeParse(raw);

    if (!parsed || typeof parsed !== "object") {
      return { ts: 0, map: {} };
    }

    return {
      ts: Number(parsed.ts || 0) || 0,
      map: _normalizeBadgeMap(parsed.map || {})
    };
  }

  function _writeLocalBadges(data) {
    const payload = {
      ts: Number(data?.ts || 0) || _now(),
      map: _normalizeBadgeMap(data?.map || {})
    };

    try {
      localStorage.setItem(BADGES_STORAGE_KEY, JSON.stringify(payload));
    } catch (_) {}
  }

  function _emitBadges(detail) {
    try {
      window.dispatchEvent(new CustomEvent("vr:reign_badge_updated", {
        detail: detail || {}
      }));
    } catch (_) {}
  }

  async function _ensureAuth() {
    try { await window.bootstrapAuthAndProfile?.(); } catch (_) {}

    const sb = window.sb;
    if (!sb || !sb.auth) return null;

    try {
      const r = await sb.auth.getUser();
      return r?.data?.user?.id || null;
    } catch (_) {
      return null;
    }
  }

  async function _readRemoteBadges() {
    const sb = window.sb;
    if (!sb || typeof sb.from !== "function") return null;

    const uid = await _ensureAuth();
    if (!uid) return null;

    try {
      const r = await sb
        .from("profiles")
        .select("id, universe_badges, universe_badges_updated_at")
        .eq("id", uid)
        .single();

      if (r?.error) return null;

      return {
        ts: _fromIso(r?.data?.universe_badges_updated_at),
        map: _normalizeBadgeMap(r?.data?.universe_badges || {})
      };
    } catch (_) {
      return null;
    }
  }

  async function _writeRemoteBadges(data) {
    const sb = window.sb;
    if (!sb || typeof sb.from !== "function") return null;

    const uid = await _ensureAuth();
    if (!uid) return null;

    const payload = {
      universe_badges: _normalizeBadgeMap(data?.map || {}),
      universe_badges_updated_at: _toIso(data?.ts || _now())
    };

    try {
      const r = await sb
        .from("profiles")
        .update(payload)
        .eq("id", uid)
        .select("id, universe_badges, universe_badges_updated_at")
        .single();

      if (r?.error) return null;

      return {
        ts: _fromIso(r?.data?.universe_badges_updated_at),
        map: _normalizeBadgeMap(r?.data?.universe_badges || {})
      };
    } catch (_) {
      return null;
    }
  }

  function _hasAnyBadge(map) {
    try {
      return Object.values(map || {}).some((row) => row && (row.bronze || row.silver || row.gold));
    } catch (_) {
      return false;
    }
  }

  async function _initBadges() {
    const local = _readLocalBadges();
    const remote = await _readRemoteBadges();

    if (!remote) {
      _writeLocalBadges(local);
      return local;
    }

    const localHas = _hasAnyBadge(local.map);
    const remoteHas = _hasAnyBadge(remote.map);

    if ((!localHas && remoteHas) || remote.ts >= local.ts) {
      _writeLocalBadges(remote);
      _emitBadges({ source: "remote", mode: "replace" });
      return remote;
    }

    if (localHas && local.ts > 0) {
      const pushed = await _writeRemoteBadges(local);
      if (pushed) {
        _writeLocalBadges(pushed);
        _emitBadges({ source: "local", mode: "push" });
        return pushed;
      }
    }

    _writeLocalBadges(local);
    return local;
  }

  async function _refreshBadges() {
    const local = _readLocalBadges();
    const remote = await _readRemoteBadges();

    if (!remote) return local;

    const localHas = _hasAnyBadge(local.map);
    const remoteHas = _hasAnyBadge(remote.map);

    if ((!localHas && remoteHas) || remote.ts >= local.ts) {
      _writeLocalBadges(remote);
      _emitBadges({ source: "remote", mode: "replace" });
      return remote;
    }

    return local;
  }

  function _getAllBadges() {
    return _readLocalBadges();
  }

  async function _syncBadges() {
    const local = _readLocalBadges();
    const pushed = await _writeRemoteBadges(local);

    if (pushed) {
      _writeLocalBadges(pushed);
      _emitBadges({ source: "local", mode: "push" });
      return pushed;
    }

    return local;
  }

  async function _setBadge(universeId, badgeKey, unlocked) {
    const uid = _norm(universeId);
    const key = _norm(badgeKey);

    if (!uid) return false;
    if (!["bronze", "silver", "gold"].includes(key)) return false;

    const local = _readLocalBadges();
    const map = _normalizeBadgeMap(local.map || {});

    if (!map[uid]) {
      map[uid] = { bronze: false, silver: false, gold: false };
    }

    map[uid][key] = !!unlocked;

    const next = {
      ts: _now(),
      map
    };

    _writeLocalBadges(next);
    _emitBadges({ universe_id: uid, badge: key, unlocked: !!unlocked, source: "local" });

    const pushed = await _writeRemoteBadges(next);
    if (pushed) {
      _writeLocalBadges(pushed);
      _emitBadges({ universe_id: uid, badge: key, unlocked: !!unlocked, source: "remote" });
    }

    return true;
  }

  async function _setUniverse(universeId, state) {
    const uid = _norm(universeId);
    if (!uid) return false;

    const local = _readLocalBadges();
    const map = _normalizeBadgeMap(local.map || {});

    map[uid] = {
      bronze: !!state?.bronze,
      silver: !!state?.silver,
      gold: !!state?.gold
    };

    const next = {
      ts: _now(),
      map
    };

    _writeLocalBadges(next);
    _emitBadges({ universe_id: uid, source: "local" });

    const pushed = await _writeRemoteBadges(next);
    if (pushed) {
      _writeLocalBadges(pushed);
      _emitBadges({ universe_id: uid, source: "remote" });
    }

    return true;
  }

  async function _replaceAllBadges(fullMap) {
    const next = {
      ts: _now(),
      map: _normalizeBadgeMap(fullMap || {})
    };

    _writeLocalBadges(next);
    _emitBadges({ source: "local", mode: "replace_all" });

    const pushed = await _writeRemoteBadges(next);
    if (pushed) {
      _writeLocalBadges(pushed);
      _emitBadges({ source: "remote", mode: "replace_all" });
    }

    return true;
  }

  async function _clearUniverseBadges(universeId) {
    const uid = _norm(universeId);
    if (!uid) return false;

    const local = _readLocalBadges();
    const map = _normalizeBadgeMap(local.map || {});
    delete map[uid];

    const next = {
      ts: _now(),
      map
    };

    _writeLocalBadges(next);
    _emitBadges({ universe_id: uid, source: "local", mode: "clear_universe" });

    const pushed = await _writeRemoteBadges(next);
    if (pushed) {
      _writeLocalBadges(pushed);
      _emitBadges({ universe_id: uid, source: "remote", mode: "clear_universe" });
    }

    return true;
  }

  function badgeIconPaths() {
    return {
      bronze: {
        empty: "assets/img/ui/badge_empty.webp",
        full: "assets/img/ui/badge_bronze_full.webp"
      },
      silver: {
        empty: "assets/img/ui/badge_empty.webp",
        full: "assets/img/ui/badge_silver_full.webp"
      },
      gold: {
        empty: "assets/img/ui/badge_empty.webp",
        full: "assets/img/ui/badge_gold_full.webp"
      }
    };
  }

  function clearMsg() {
    const el = $("pf_msg");
    if (!el) return;
    el.textContent = "";
    el.style.display = "none";
    el.classList.remove("ok", "err");
  }

  function setMsg(type, key, vars) {
    const el = $("pf_msg");
    if (!el) return;

    const txt = window.VRI18n?.t?.(key, "", vars) || "";
    el.classList.remove("ok", "err");

    if (!txt) {
      el.textContent = "";
      el.style.display = "none";
      return;
    }

    el.classList.add(type === "ok" ? "ok" : "err");
    el.textContent = txt;
    el.style.display = "block";
  }

  function isValidUsername(v) {
    const s = String(v || "").trim();
    if (s.length < 3 || s.length > 20) return false;
    return /^[a-zA-Z0-9_-]+$/.test(s);
  }

  function openEdit(open) {
    const wrap = $("pf_edit_wrap");
    if (!wrap) return;
    if (open) wrap.classList.add("is-open");
    else wrap.classList.remove("is-open");
  }

  function _t(key, fallback) {
    try {
      const out = window.VRI18n?.t?.(key);
      if (typeof out === "string" && out.trim()) return out;
    } catch (_) {}
    return String(fallback || "");
  }

  function getKnownUniverses() {
    const baseOrder = FALLBACK_UNIVERSES.slice();

    try {
      const list = window.VUserData?.getAllKnownUniverses?.();
      if (!Array.isArray(list) || !list.length) return baseOrder;

      const set = new Set(list.map(_norm).filter(Boolean));
      const ordered = baseOrder.filter((id) => set.has(id));
      const extras = Array.from(set).filter((id) => !ordered.includes(id));
      return ordered.concat(extras);
    } catch (_) {
      return baseOrder;
    }
  }

  function getBadgeMap() {
    try {
      const all = _getAllBadges();
      return (all && all.map && typeof all.map === "object") ? all.map : {};
    } catch (_) {
      return {};
    }
  }

  function getUniverseBadgeState(universeId, map) {
    const uid = _norm(universeId);
    const row = (map && map[uid] && typeof map[uid] === "object") ? map[uid] : {};

    return {
      bronze: !!row.bronze,
      silver: !!row.silver,
      gold: !!row.gold
    };
  }

  function renderProfileFromState() {
    const state = window.VUserData?.load?.() || {};

    const elV = $("pf_vcoins");
    const elJ = $("pf_jetons");
    const elU = $("pf_username_text");

    if (elV) elV.textContent = String(Number(state.vcoins ?? 0));
    if (elJ) elJ.textContent = String(Number(state.jetons ?? 0));
    if (elU) elU.textContent = String(state.username || "").trim() || "—";
  }

  function renderUniverses() {
    const host = $("pf_universes");
    if (!host) return;

    host.innerHTML = "";

    const icons = badgeIconPaths();
    const ids = getKnownUniverses();
    const badgeMap = getBadgeMap();

    for (const rawId of ids) {
      const uid = _norm(rawId);
      if (!uid) continue;

      const st = getUniverseBadgeState(uid, badgeMap);

      const unlocked = !!(window.VUserData?.isUniverseUnlocked?.(uid) || uid === "hell_king" || uid === "heaven_king");

      const card = document.createElement("div");
      card.className = "vr-universe-card" + (unlocked ? "" : " is-locked");

      const inner = document.createElement("div");
      inner.className = "vr-universe-inner";

      const name = document.createElement("h3");
      name.className = "vr-universe-name";
      name.textContent = _t(`universe.${uid}.title`, uid);
      inner.appendChild(name);

      const badges = document.createElement("div");
      badges.className = "vr-universe-badges";

      for (const key of ["bronze", "silver", "gold"]) {
        const unlocked = !!st[key];

        const box = document.createElement("button");
        box.type = "button";
        box.className = "vr-badge" + (unlocked ? " unlocked" : "");
        box.setAttribute("data-universe", uid);
        box.setAttribute("data-badge", key);
        box.setAttribute("aria-label", _t(`profile.badge_${key}_aria`, `badge ${key}`));

        const imgEmpty = document.createElement("img");
        imgEmpty.className = "empty";
        imgEmpty.alt = "";
        imgEmpty.src = icons[key].empty;

        const imgFull = document.createElement("img");
        imgFull.className = "full";
        imgFull.alt = "";
        imgFull.src = icons[key].full;

        box.appendChild(imgEmpty);
        box.appendChild(imgFull);
        badges.appendChild(box);
      }

      inner.appendChild(badges);
      card.appendChild(inner);
      host.appendChild(card);
    }

    try { window.VRI18n?.initI18n?.(); } catch (_) {}
  }

  function openModalWithSrc(src) {
    const modal = $("badgeModal");
    const img = $("badgeModalImg");
    if (!modal || !img || !src) return;

    img.src = src;
    modal.classList.add("is-open");
    modal.setAttribute("aria-hidden", "false");

    try { document.documentElement.style.overflow = "hidden"; } catch (_) {}
    try { document.body.style.overflow = "hidden"; } catch (_) {}
  }

  function closeModal() {
    const modal = $("badgeModal");
    const img = $("badgeModalImg");
    if (!modal || !img) return;

    img.removeAttribute("src");
    modal.classList.remove("is-open");
    modal.setAttribute("aria-hidden", "true");

    try { document.documentElement.style.overflow = ""; } catch (_) {}
    try { document.body.style.overflow = ""; } catch (_) {}
  }

  function pickBadgeSrc(badgeEl) {
    if (!badgeEl) return null;

    const full = badgeEl.querySelector("img.full");
    const empty = badgeEl.querySelector("img.empty");

    if (badgeEl.classList.contains("unlocked") && full?.getAttribute("src")) {
      return full.getAttribute("src");
    }

    if (empty?.getAttribute("src")) return empty.getAttribute("src");
    if (full?.getAttribute("src")) return full.getAttribute("src");
    return null;
  }

  async function handleSaveUsername() {
    const input = $("pf_username_input");
    if (!input) return;

    const next = String(input.value || "").trim();

    if (!isValidUsername(next)) {
      if (next.length < 3 || next.length > 20) {
        setMsg("err", "auth.username.errors.length");
      } else {
        setMsg("err", "auth.username.errors.chars");
      }
      return;
    }

    const curState = window.VUserData?.load?.() || {};
    const cur = String(curState.username || "").trim();
    const uid = String(curState.user_id || "").trim();

    if (!uid) {
      setMsg("err", "auth.username.errors.generic");
      return;
    }

    if (cur === next) {
      openEdit(false);
      setMsg("ok", "profile.username_ok_nochange");
      return;
    }

    const saveBtn = $("pf_save");
    if (saveBtn) saveBtn.disabled = true;

    try {
      const res = await window.VUserData?.setUsername?.(next);

      if (!res || !res.ok) {
        const reason = res?.reason || "generic";

        if (reason === "taken") setMsg("err", "auth.username.errors.taken");
        else if (reason === "length") setMsg("err", "auth.username.errors.length");
        else if (reason === "invalid") setMsg("err", "auth.username.errors.chars");
        else setMsg("err", "auth.username.errors.generic");

        return;
      }

      try { await window.VUserData?.refresh?.(); } catch (_) {}

      renderProfileFromState();
      openEdit(false);
      setMsg("ok", "profile.username_ok_saved");
    } finally {
      if (saveBtn) saveBtn.disabled = false;
    }
  }

  function bindUsernameUi() {
    const editBtn = $("pf_edit_toggle");
    const cancelBtn = $("pf_cancel");
    const saveBtn = $("pf_save");

    if (editBtn) {
      editBtn.addEventListener("click", () => {
        const wrap = $("pf_edit_wrap");
        const shouldOpen = !(wrap && wrap.classList.contains("is-open"));
        openEdit(shouldOpen);

        const state = window.VUserData?.load?.() || {};
        const input = $("pf_username_input");
        if (shouldOpen && input) {
          input.value = String(state.username || "").trim();
          input.focus();
        }

        if (!shouldOpen) clearMsg();
      });
    }

    if (cancelBtn) {
      cancelBtn.addEventListener("click", () => {
        openEdit(false);
        clearMsg();
      });
    }

    if (saveBtn) {
      saveBtn.addEventListener("click", handleSaveUsername);
    }
  }

  function bindBadgeModal() {
    const grid = $("pf_universes");
    const backdrop = $("badgeModalBackdrop");
    const closeBtn = $("badgeModalClose");

    if (grid) {
      grid.addEventListener("click", (e) => {
        const badgeEl = e.target?.closest?.(".vr-badge");
        if (!badgeEl) return;

        const src = pickBadgeSrc(badgeEl);
        if (!src) return;

        e.preventDefault();
        e.stopPropagation();
        openModalWithSrc(src);
      }, true);
    }

    if (backdrop) {
      backdrop.addEventListener("click", (e) => {
        e.preventDefault();
        closeModal();
      });
    }

    if (closeBtn) {
      closeBtn.addEventListener("click", (e) => {
        e.preventDefault();
        closeModal();
      });
    }

    window.addEventListener("keydown", (e) => {
      const modal = $("badgeModal");
      if (!modal || !modal.classList.contains("is-open")) return;

      if (e.key === "Escape" || e.key === "Esc") {
        e.preventDefault();
        closeModal();
      }
    });
  }

  async function refreshEverything() {
    try { await window.VUserData?.refresh?.(); } catch (_) {}
    try { await _refreshBadges(); } catch (_) {}

    renderProfileFromState();
    renderUniverses();
  }

  async function boot() {
    try {
      const lang = window.VRI18n?.getLang?.() || "fr";
      await window.VRI18n?.initI18n?.(lang);
    } catch (_) {}

    try { await window.bootstrapAuthAndProfile?.(); } catch (_) {}
    try { await window.VUserData?.init?.(); } catch (_) {}
    try { await _initBadges(); } catch (_) {}

    renderProfileFromState();
    renderUniverses();

    bindUsernameUi();
    bindBadgeModal();

    window.addEventListener("vr:profile", () => {
      renderProfileFromState();
    });

    window.addEventListener("vr:reign_badge_updated", () => {
      renderUniverses();
    });

    window.addEventListener("pageshow", () => {
      refreshEverything();
    });

    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible") {
        refreshEverything();
      }
    });

    try { window.VRI18n?.initI18n?.(); } catch (_) {}
  }

  document.addEventListener("DOMContentLoaded", boot);

  // API simple pour toi / console / logique jeu
  window.VUProfileBadges = {
    async setBadge(universeId, badgeKey, unlocked) {
      return await _setBadge(universeId, badgeKey, unlocked);
    },

    async setUniverse(universeId, state) {
      return await _setUniverse(universeId, state);
    },

    async replaceAll(map) {
      return await _replaceAllBadges(map);
    },

    async clearUniverse(universeId) {
      return await _clearUniverseBadges(universeId);
    },

    getAll() {
      return _getAllBadges();
    },

    async refresh() {
      return await _refreshBadges();
    },

    async sync() {
      return await _syncBadges();
    }
  };
})();