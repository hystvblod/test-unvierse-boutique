// FILE: zip/js/ads.js
// VRealms - ads.js (AdMob Capacitor Community, no-import) — SANS SSV
// ✅ Version "DB only" : plus de localStorage pour consent/actions/inter cooldown
// ✅ Ajout stats pubs (24h + total) via RPC secure_get_ads_stats()
// ✅ Log interstitiel réellement affiché via RPC secure_log_ad_event('interstitial', ...)
// ⚠️ Rewarded: le log le plus safe doit être fait côté DB (dans secure_claim_reward). Ici on fait un log best-effort.
//
// ✅ Ajout "no_ads" : BLOQUE UNIQUEMENT LES INTERSTITIELS (rewarded autorisés)
//
// ✅ FIX (6 points côté Ads) :
// 1) Inter auto NE PEUT PAS se déclencher si overlay/app busy (__ads_active)
// 2) __ads_active respecté aussi côté "canShowInterstitialNow()"
// 3) Séparation interstitial vs rewarded (isRewardShowing ne doit pas bloquer l'app pour un inter)
// 4) Cleanup robuste (postAdCleanup) même après visiblitychange / resume
// 5) Garde DB-only + no_ads + stats + logs
// 6) Anti double-show best-effort (verrou simple sur inter/reward)

(function () {
  "use strict";

  // ------- Raccourcis globaux -------
  var Capacitor = (window.Capacitor || {});
  var AdMob = (Capacitor.Plugins && Capacitor.Plugins.AdMob) ? Capacitor.Plugins.AdMob : null;
  var App = (Capacitor.App) ? Capacitor.App
          : ((Capacitor.Plugins && Capacitor.Plugins.App) ? Capacitor.Plugins.App : null);

  // ------- STRICT PROD -------
  var __DEV_ADS__ = false;      // true pour tests locaux
  var SHOW_DIAG_PANEL = false;  // overlay debug (laisse false en prod)

  // ✅ Tes Ad Units (PROD)
  var AD_UNIT_ID_INTERSTITIEL = "ca-app-pub-6837328794080297/8465879302";
  var AD_UNIT_ID_REWARDED     = "ca-app-pub-6837328794080297/8202263221";

  // ✅ Règle interstitiel : 1 pub tous les X choix (cumul global)
  var INTERSTITIEL_EVERY_X_ACTIONS = 8;
  var INTER_COOLDOWN_MS = 0; // anti-spam (0 = off)

  // --- Récompenses par défaut (utilisées par l'UI si besoin)
  window.REWARD_JETONS = typeof window.REWARD_JETONS === "number" ? window.REWARD_JETONS : 1;
  window.REWARD_VCOINS = typeof window.REWARD_VCOINS === "number" ? window.REWARD_VCOINS : 200;

  // --- Flags d'état ---
  var isRewardShowing = false;     // TRUE uniquement pendant rewarded
  var currentAdKind = null;        // "interstitial" | "rewarded" | null
  var __showLock = false;          // anti double show best-effort

  window.__ads_active = false;     // flag global anti-back/anti-overlays côté app

  // --- Compteurs (désormais server-side) ---
  var ACTIONS_KEY = "vr_actions_count";    // conservé pour compat (plus utilisé en localStorage)
  var LAST_INTER_KEY = "vr_last_inter_ts"; // conservé pour compat (plus utilisé en localStorage)

  // Cache mémoire (synchro via DB)
  var actionsCount = 0;
  var lastInterTs = 0;

  // --- Consent server-side (cache mémoire) ---
  var _adsState = {
    rgpdConsent: null,   // "accept" | "refuse" | null
    adsConsent: null,    // boolean|null
    adsEnabled: null     // boolean|null
  };

  // --- Stats pubs (cache mémoire) ---
  var _adsStats = {
    rewarded_total: 0,
    rewarded_24h: 0,
    inter_total: 0,
    inter_24h: 0
  };

  // --- No Ads (cache mémoire) ---
  // ⚠️ no_ads BLOQUE UNIQUEMENT les interstitiels (rewarded restent OK)
  var _noAds = false;

  function sbReady() {
    return !!(window.sb && window.sb.auth && typeof window.sb.rpc === "function");
  }

  // =============================
  // Helpers plateforme
  // =============================
  function isNative() {
    try {
      return !!(Capacitor && Capacitor.isNativePlatform && Capacitor.isNativePlatform());
    } catch (_) {
      return false;
    }
  }

  // =============================
  // No Ads (read-only) - SERVER SIDE
  // =============================
  async function syncNoAdsFromServer() {
    try {
      if (!sbReady()) return _noAds;

      // Assure que la session existe
      try { await window.sb.auth.getUser(); } catch (_) {}

      var r = await window.sb.rpc("secure_get_no_ads");
      if (r && !r.error) {
        _noAds = (r.data === true);
      }
      return _noAds;
    } catch (_) {
      return _noAds;
    }
  }

  function isNoAds() {
    return _noAds === true;
  }

  // =============================
  // Consent / Request options (NPA) - SERVER SIDE
  // =============================
  function getPersonalizedAdsGranted() {
    // Plus de localStorage.
    // Logique : si RGPD refuse => false
    // sinon on regarde adsConsent / adsEnabled
    try {
      var rgpd = _adsState.rgpdConsent; // "accept"|"refuse"|null
      var adsConsent = _adsState.adsConsent; // boolean|null
      var adsEnabled = _adsState.adsEnabled; // boolean|null

      if (rgpd === "refuse") return false;

      if (rgpd === "accept") {
        if (typeof adsConsent === "boolean") return adsConsent === true;
        if (typeof adsEnabled === "boolean") return adsEnabled === true;
        return false;
      }

      if (typeof adsConsent === "boolean") return adsConsent === true;
      if (typeof adsEnabled === "boolean") return adsEnabled === true;

      return false;
    } catch (_) {
      return false;
    }
  }

  function buildAdMobRequestOptions() {
    // npa: "1" => non-personnalisées, "0" => personnalisées
    return { npa: getPersonalizedAdsGranted() ? "0" : "1" };
  }

  async function syncAdsStateFromServer() {
    try {
      if (!sbReady()) return false;

      // Assure que la session existe
      try { await window.sb.auth.getUser(); } catch (_) {}

      var r = await window.sb.rpc("secure_get_ads_state");
      if (r && !r.error && r.data) {
        _adsState.rgpdConsent = (typeof r.data.rgpdConsent === "string") ? r.data.rgpdConsent : null;
        _adsState.adsConsent  = (typeof r.data.adsConsent === "boolean") ? r.data.adsConsent : null;
        _adsState.adsEnabled  = (typeof r.data.adsEnabled === "boolean") ? r.data.adsEnabled : null;

        actionsCount = parseInt(r.data.actionsCount || 0, 10) || 0;
        lastInterTs  = parseInt(r.data.lastInterTs || 0, 10) || 0;
        return true;
      }
      return false;
    } catch (_) {
      return false;
    }
  }

  async function refreshAdsStats() {
    try {
      if (!sbReady()) return _adsStats;

      var r = await window.sb.rpc("secure_get_ads_stats");
      if (r && !r.error && r.data) {
        _adsStats.rewarded_total = parseInt(r.data.rewarded_total || 0, 10) || 0;
        _adsStats.rewarded_24h   = parseInt(r.data.rewarded_24h || 0, 10) || 0;
        _adsStats.inter_total    = parseInt(r.data.inter_total || 0, 10) || 0;
        _adsStats.inter_24h      = parseInt(r.data.inter_24h || 0, 10) || 0;
      }
      return _adsStats;
    } catch (_) {
      return _adsStats;
    }
  }

  // =============================
  // Helpers anti-surcouches avant/après show() — WHITELIST SAFE
  // =============================
  var APP_OVERLAYS = [
    "#popup-consent",
    "#update-banner",
    ".tooltip-box",
    ".popup-consent-bg",
    ".modal-app",
    ".dialog-app",
    ".backdrop-app",
    ".overlay-app",
    ".loading-app"
  ];

  function hideOverlays() {
    try {
      APP_OVERLAYS.forEach(function (sel) {
        document.querySelectorAll(sel).forEach(function (el) {
          el.__prevDisplay = el.style.display;
          el.style.display = "none";
        });
      });
    } catch (_) {}
  }

  function restoreOverlays() {
    try {
      APP_OVERLAYS.forEach(function (sel) {
        document.querySelectorAll(sel).forEach(function (el) {
          el.style.display = (typeof el.__prevDisplay === "string") ? el.__prevDisplay : "";
          try { delete el.__prevDisplay; } catch (_) {}
        });
      });
    } catch (_) {}
  }

  function preShowAdCleanup() {
    try {
      hideOverlays();
      window.__ads_active = true;
    } catch (_) {}
  }

  function postAdCleanup() {
    try {
      window.__ads_active = false;
      restoreOverlays();
    } catch (_) {}
  }

  // Quand l’app revient au premier plan : on nettoie SI pas rewarded en cours
  document.addEventListener("visibilitychange", function () {
    if (!document.hidden) {
      if (!(currentAdKind === "rewarded" && isRewardShowing)) postAdCleanup();
    }
  });

  // =============================
  // Panneau diag (optionnel)
  // =============================
  function diag(msg) {
    if (!SHOW_DIAG_PANEL) return;
    try {
      var el = document.getElementById("__ads_diag");
      if (!el) {
        el = document.createElement("div");
        el.id = "__ads_diag";
        el.style.cssText =
          "position:fixed;left:8px;bottom:8px;z-index:999999;" +
          "background:rgba(0,0,0,.6);color:#fff;padding:6px 8px;border-radius:8px;" +
          "font:12px/1.35 monospace;max-width:80vw;";
        document.body.appendChild(el);
      }
      var sep = el.textContent ? "\n" : "";
      el.textContent += sep + "[" + new Date().toLocaleTimeString() + "] " + msg;
    } catch (_) {}
  }

  // =============================
  // Écouteurs AdMob (1 seule fois)
  // =============================
  function registerAdEventsOnce() {
    try {
      if (!AdMob || !AdMob.addListener || window.__adListenersRegistered) return;
      window.__adListenersRegistered = true;

      var SAFE = function (fn) {
        return function (arg) { try { fn && fn(arg); } catch (_) {} };
      };

      var map = [
        ["onAdFullScreenContentOpened", function () {
          // ⚠️ NE PAS forcer isRewardShowing ici (ça s'applique aussi aux inter)
          window.__ads_active = true;
          diag("Ad opened");
        }],
        ["onAdDismissedFullScreenContent", function () {
          diag("Ad dismissed");
          if (currentAdKind === "rewarded") isRewardShowing = false;
          currentAdKind = null;
          __showLock = false;
          postAdCleanup();
        }],
        ["onAdFailedToShowFullScreenContent", function () {
          diag("Ad failed to show");
          if (currentAdKind === "rewarded") isRewardShowing = false;
          currentAdKind = null;
          __showLock = false;
          postAdCleanup();
        }],
        ["onRewarded", function () {
          diag("Rewarded granted");
        }]
      ];

      for (var i = 0; i < map.length; i++) {
        try { AdMob.addListener(map[i][0], SAFE(map[i][1])); } catch (_) {}
      }
    } catch (_) {}
  }

  // =============================
  // Init (silencieux si web)
  // =============================
  (async function initAdMobOnce() {
    try {
      if (!isNative()) return;
      if (!AdMob || !AdMob.initialize) return;

      // Sync server-side consent & counters (tout via DB)
      await syncAdsStateFromServer().catch(function () {});
      await syncNoAdsFromServer().catch(function () {}); // ✅ no_ads
      await refreshAdsStats().catch(function () {});

      await AdMob.initialize({
        requestTrackingAuthorization: false,
        initializeForTesting: __DEV_ADS__
      });

      registerAdEventsOnce();
    } catch (_) {}
  })();

  // =============================
  // Helpers "wait" (dismissed / rewarded / app return)
  // =============================
  function waitDismissedOnce() {
    return new Promise(function (resolve) {
      var off1 = null, off2 = null;
      function done(ok) {
        try { off1 && off1.remove && off1.remove(); } catch (_) {}
        try { off2 && off2.remove && off2.remove(); } catch (_) {}
        resolve(!!ok);
      }
      try {
        off1 = AdMob.addListener("onAdDismissedFullScreenContent", function () { done(true); });
        off2 = AdMob.addListener("onAdFailedToShowFullScreenContent", function () { done(false); });
      } catch (_) {
        done(false);
      }
    });
  }

  function waitRewardedOnce(timeoutMs) {
    return new Promise(function (resolve) {
      var off = null, timer = null;
      function done(ok) {
        try { off && off.remove && off.remove(); } catch (_) {}
        if (timer) { clearTimeout(timer); timer = null; }
        resolve(!!ok);
      }
      try {
        off = AdMob.addListener("onRewarded", function () { done(true); });
      } catch (_) {
        done(false);
        return;
      }
      timer = setTimeout(function () { done(false); }, timeoutMs || 30000);
    });
  }

  function waitAppReturnOnce() {
    return new Promise(function (resolve) {
      var resolved = false;
      function done() {
        if (resolved) return;
        resolved = true;
        cleanup();
        resolve(true);
      }

      function onVis() { try { if (!document.hidden) done(); } catch (_) {} }
      function onFocus() { done(); }

      var off1 = null, off2 = null;

      function cleanup() {
        try { document.removeEventListener("visibilitychange", onVis); } catch (_) {}
        try { window.removeEventListener("focus", onFocus); } catch (_) {}
        try { off1 && off1.remove && off1.remove(); } catch (_) {}
        try { off2 && off2.remove && off2.remove(); } catch (_) {}
      }

      try { document.addEventListener("visibilitychange", onVis, { once: true }); } catch (_) {}
      try { window.addEventListener("focus", onFocus, { once: true }); } catch (_) {}

      try {
        if (App && App.addListener) {
          off1 = App.addListener("resume", done);
          off2 = App.addListener("appStateChange", function (state) {
            try { if (state && state.isActive) done(); } catch (_) {}
          });
        }
      } catch (_) {}
    });
  }

  // =============================
  // Interstitiel (LOAD/SHOW)
  // =============================
  function canShowInterstitialNow() {
    // ✅ Bloque si app busy (event/ending/overlay/rewarded/etc.)
    if (window.__ads_active) return false;
    if (__showLock) return false;

    // Si une rewarded est en cours -> jamais d'inter
    if (currentAdKind === "rewarded" && isRewardShowing) return false;

    if (!INTER_COOLDOWN_MS) return true;
    var now = Date.now();
    return (now - lastInterTs) >= INTER_COOLDOWN_MS;
  }

  async function markInterstitialShownNow() {
    // Plus de localStorage -> DB
    lastInterTs = Date.now();
    try {
      if (sbReady()) {
        var r = await window.sb.rpc("secure_ads_mark_interstitial_shown");
        if (r && !r.error && typeof r.data !== "undefined") {
          lastInterTs = parseInt(r.data || lastInterTs, 10) || lastInterTs;
        }
      }
    } catch (_) {}
  }

  async function showInterstitialAd() {
    try {
      // ✅ no_ads => on bloque UNIQUEMENT l'interstitiel
      if (isNoAds()) return false;

      if (!isNative()) return false;
      if (!AdMob || !AdMob.prepareInterstitial || !AdMob.showInterstitial) return false;
      if (!canShowInterstitialNow()) return false;

      __showLock = true;
      currentAdKind = "interstitial";

      await AdMob.prepareInterstitial({
        adId: AD_UNIT_ID_INTERSTITIEL,
        requestOptions: buildAdMobRequestOptions()
      });

      preShowAdCleanup();

      var dismissedP = waitDismissedOnce();
      var res = await AdMob.showInterstitial();

      await Promise.race([dismissedP.catch(function () {}), waitAppReturnOnce()]);
      postAdCleanup();

      currentAdKind = null;
      __showLock = false;

      if (res !== false) {
        await markInterstitialShownNow();

        // ✅ Log interstitiel réellement affiché (DB)
        try {
          if (sbReady()) {
            await window.sb.rpc("secure_log_ad_event", { p_kind: "interstitial", p_placement: "auto" });
          }
        } catch (_) {}

        // Refresh stats best-effort
        try { await refreshAdsStats(); } catch (_) {}

        // Preload best-effort
        setTimeout(function () {
          try {
            AdMob.prepareInterstitial({
              adId: AD_UNIT_ID_INTERSTITIEL,
              requestOptions: buildAdMobRequestOptions()
            }).catch(function () {});
          } catch (_) {}
        }, 1200);

        return true;
      }

      return false;
    } catch (_) {
      try {
        AdMob.prepareInterstitial({
          adId: AD_UNIT_ID_INTERSTITIEL,
          requestOptions: buildAdMobRequestOptions()
        }).catch(function () {});
      } catch (_) {}
      try { postAdCleanup(); } catch (_) {}
      currentAdKind = null;
      __showLock = false;
      return false;
    }
  }

  // =============================
  // Rewarded (LOAD/SHOW)
  // =============================
  async function showRewardedAd(opts) {
    opts = opts || {};
    try {
      // ⚠️ no_ads NE BLOQUE PAS les rewarded (volontaire)
      if (!isNative()) return false;
      if (!AdMob || !AdMob.prepareRewardVideoAd || !AdMob.showRewardVideoAd) return false;

      // si app busy, on refuse (évite double overlay)
      if (window.__ads_active || __showLock) return false;

      __showLock = true;
      currentAdKind = "rewarded";

      await AdMob.prepareRewardVideoAd({
        adId: AD_UNIT_ID_REWARDED,
        requestOptions: buildAdMobRequestOptions()
      });

      preShowAdCleanup();
      isRewardShowing = true;

      var rewardedP = waitRewardedOnce(30000);
      var dismissedP = waitDismissedOnce();

      var showPromise = AdMob.showRewardVideoAd();

      var gotReward = await rewardedP;
      await Promise.race([dismissedP.catch(function () {}), waitAppReturnOnce()]);
      postAdCleanup();

      try { await showPromise; } catch (_) {}

      isRewardShowing = false;
      currentAdKind = null;
      __showLock = false;

      // ⚠️ Best-effort log rewarded view.
      // Le plus safe: logger côté DB au moment du credit (secure_claim_reward).
      if (gotReward) {
        try {
          if (sbReady()) {
            var plc = (opts && opts.placement) ? String(opts.placement) : "rewarded";
            await window.sb.rpc("secure_log_ad_event", { p_kind: "rewarded", p_placement: plc });
          }
        } catch (_) {}
        try { await refreshAdsStats(); } catch (_) {}
      }

      return !!gotReward;
    } catch (_) {
      try { postAdCleanup(); } catch (_) {}
      isRewardShowing = false;
      currentAdKind = null;
      __showLock = false;
      return false;
    }
  }

  // =============================
  // Compteur actions → déclenche interstitiel tous les X choix (server-side)
  // =============================
  function getActionsCount() {
    return actionsCount || 0;
  }

  async function resetActionsCount() {
    actionsCount = 0;
    try {
      if (sbReady()) {
        await window.sb.rpc("secure_ads_reset_actions");
        var s = await window.sb.rpc("secure_get_ads_state");
        if (s && !s.error && s.data) {
          actionsCount = parseInt(s.data.actionsCount || 0, 10) || 0;
          lastInterTs = parseInt(s.data.lastInterTs || 0, 10) || 0;
        }
      }
    } catch (_) {}
  }

  async function markActionAndMaybeShowInterstitial() {
    // Incrémente puis vérifie (pub APRES le Xème choix) => DB
    try {
      if (sbReady()) {
        var r = await window.sb.rpc("secure_ads_mark_action", { p_delta: 1 });
        if (r && !r.error) {
          actionsCount = parseInt(r.data || actionsCount, 10) || actionsCount;
        } else {
          // fallback soft: resync
          await syncAdsStateFromServer().catch(function () {});
        }
      } else {
        // sans Supabase -> on incrémente en mémoire uniquement (aucun persist)
        actionsCount = (actionsCount || 0) + 1;
      }
    } catch (_) {
      actionsCount = (actionsCount || 0) + 1;
    }

    // ✅ no_ads => on ne déclenche jamais l'interstitiel auto
    if (!isNoAds()) {
      // ✅ si overlay/app busy => on NE déclenche pas
      if (window.__ads_active) return actionsCount;

      if (INTERSTITIEL_EVERY_X_ACTIONS > 0 && (actionsCount % INTERSTITIEL_EVERY_X_ACTIONS) === 0) {
        try { await showInterstitialAd(); } catch (_) {}
      }
    }

    return actionsCount;
  }

  // =============================
  // Expose API attendue par ton jeu
  // =============================
  window.VRAds = window.VRAds || {};
  window.VRAds.isNative = isNative;
  window.VRAds.showInterstitialAd = showInterstitialAd;
  window.VRAds.showRewardedAd = showRewardedAd;

  // ➜ API "actions"
  window.VRAds.getActionsCount = getActionsCount;
  window.VRAds.resetActionsCount = resetActionsCount;
  window.VRAds.markAction = markActionAndMaybeShowInterstitial;

  // ➜ API "stats"
  window.VRAds.getStats = function () { return _adsStats; };
  window.VRAds.refreshStats = refreshAdsStats;

  // ➜ API "state"
  window.VRAds.refreshState = syncAdsStateFromServer;

  // ➜ API "no_ads" (utile pour UI/diagnostic)
  window.VRAds.isNoAds = isNoAds;
  window.VRAds.refreshNoAds = syncNoAdsFromServer;

})();
