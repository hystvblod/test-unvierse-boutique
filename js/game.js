// ===============================================
// VRealms - js/game.js (bundle complet) — VERSION À JOUR (PATCH FIXES)
// - Loader univers/decks/i18n
// - UI binding + swipe animé sur les choix (A/B/C)
// - State / Endings / Engine core
// - Popups Jeton & VCoins
// - VRGame + anti-retour navigateur (best-effort)
// - ✅ SAVE LOCAL PAR UNIVERS (reprise session)
// - ✅ EVENTS: toutes les 3 cartes -> 1/10, pool 30, anti-répétition 25/30
// - ✅ Fix: events anti-répétition = 25 DISTINCTS (pas “25 tirages”)
// - ✅ Fix: undo/save restore aussi les jetons UI
// - ✅ FIX(1): swipe = PointerEvents only (+ fallback touch si pas PointerEvent)
// - ✅ FIX(2): _handleDeath() n’empile plus de listeners (bind once + delegation)
// - ✅ FIX(3): events jetons: UI ne bouge que si DB ok + refresh soft après event
// - ✅ FIX(5): i18n overlay event (Continuer / Événement) avec fallback
// ===============================================


// -------------------------------------------------------
// Helpers profil (100% Supabase authoritative)
// -------------------------------------------------------
(function () {
  "use strict";

  // Cache mémoire (PAS localStorage) juste pour éviter de spam RPC
  const _mem = { me: null, ts: 0 };

  async function getMeFresh(maxAgeMs) {
    const now = Date.now();
    const age = now - (_mem.ts || 0);
    if (_mem.me && age <= (maxAgeMs || 0)) return _mem.me;

    try {
      const me = await window.VRRemoteStore?.getMe?.();
      if (me) {
        _mem.me = me;
        _mem.ts = now;
        return me;
      }
    } catch (_) {}

    return _mem.me; // peut être null
  }

  // Petit helper pour éviter NaN
  function n(x) {
    const v = Number(x);
    return Number.isFinite(v) ? v : 0;
  }

  // Expose global (utile partout dans ce bundle)
  window.VRProfile = window.VRProfile || {
    async getMe(maxAgeMs) { return await getMeFresh(maxAgeMs); },
    _n: n
  };
})();


// -------------------------------------------------------
// ✅ Save system local (par univers) — reprise session
// - Stocke uniquement l’état de RUN (pas profil Supabase)
// - Clé: vrealms_save_<universeId>
// -------------------------------------------------------
(function () {
  "use strict";

  const SAVE_PREFIX = "vrealms_save_";
  const SAVE_VERSION = 1;

  function _key(universeId) {
    return `${SAVE_PREFIX}${String(universeId || "unknown")}`;
  }

  function _safeParse(raw) {
    try { return JSON.parse(raw); } catch (_) { return null; }
  }

  function load(universeId) {
    try {
      const raw = localStorage.getItem(_key(universeId));
      if (!raw) return null;
      const data = _safeParse(raw);
      if (!data || typeof data !== "object") return null;
      if (data.version !== SAVE_VERSION) return null;
      if (data.universeId !== universeId) return null;
      return data;
    } catch (_) {
      return null;
    }
  }

  function save(universeId, payload) {
    try {
      const data = {
        version: SAVE_VERSION,
        universeId,
        ts: Date.now(),
        ...payload
      };
      localStorage.setItem(_key(universeId), JSON.stringify(data));
      return true;
    } catch (_) {
      return false;
    }
  }

  function clear(universeId) {
    try { localStorage.removeItem(_key(universeId)); } catch (_) {}
  }

  window.VRSave = { load, save, clear, _key };
})();


// -------------------------------------------------------
// Badge thresholds (sans mort)
// bronze = 40 choix, argent = 60, or = 100
// -------------------------------------------------------
const VR_BADGE_BRONZE_CHOICES = 40;
const VR_BADGE_SILVER_CHOICES = 60;
const VR_BADGE_GOLD_CHOICES = 100;


// VRealms - engine/events-loader.js
// Charge la config d'univers + le deck (par univers) + les textes des cartes (par univers + langue).
// + ✅ charge EVENTS (logic + i18n) par univers
(function () {
  "use strict";

  const SCENARIOS_PATH = "data/scenarios";

  // ✅ anciens chemins gardés en fallback pendant la transition
  const LEGACY_CONFIG_PATH = "data/universes";
  const LEGACY_DECKS_PATH = "data/decks";
  const LEGACY_I18N_PATH = "data/i18n";
  const LEGACY_EVENTS_LOGIC_PATH = "data/events";

  const VREventsLoader = {
    async loadUniverseData(universeId, lang) {
      const configPromise = this._loadConfig(universeId);
      const deckPromise = this._loadDeck(universeId);
      const textsPromise = this._loadCardTexts(universeId, lang);

      const [config, deck, cardTexts] = await Promise.all([
        configPromise,
        deckPromise,
        textsPromise
      ]);

      return { config, deck, cardTexts };
    },

    // ✅ NEW: load events (logic + i18n)
    async loadUniverseEvents(universeId, lang) {
      const logicPromise = this._loadEventsLogic(universeId);
      const textsPromise = this._loadEventsTexts(universeId, lang);

      const [logic, texts] = await Promise.all([logicPromise, textsPromise]);

      return { eventsLogic: logic, eventsTexts: texts };
    },

    async _loadConfig(universeId) {
      const urlNew = `${SCENARIOS_PATH}/${universeId}/config.json`;
      let res = await fetch(urlNew, { cache: "no-cache" });

      if (!res.ok) {
        const urlOld = `${LEGACY_CONFIG_PATH}/${universeId}.config.json`;
        res = await fetch(urlOld, { cache: "no-cache" });
      }

      if (!res.ok) {
        throw new Error(`[VREventsLoader] Impossible de charger la config univers ${universeId}`);
      }
      return res.json();
    },

    async _loadDeck(universeId) {
      const urlNew = `${SCENARIOS_PATH}/${universeId}/deck.json`;
      let res = await fetch(urlNew, { cache: "no-cache" });

      if (!res.ok) {
        const urlOld = `${LEGACY_DECKS_PATH}/${universeId}.json`;
        res = await fetch(urlOld, { cache: "no-cache" });
      }

      if (!res.ok) {
        throw new Error(`[VREventsLoader] Impossible de charger le deck pour ${universeId}`);
      }

      const deckJson = await res.json();

      // Supporte 2 formats :
      // 1) { "cards": [ ... ] }
      // 2) [ ... ] (array direct)
      const cards = Array.isArray(deckJson) ? deckJson : (deckJson?.cards || null);

      if (!Array.isArray(cards)) {
        throw new Error(`[VREventsLoader] Deck invalide pour ${universeId} (attendu array ou {cards:[]}).`);
      }
      return cards;
    },

    async _loadCardTexts(universeId, lang) {
      const urlNew = `${SCENARIOS_PATH}/${universeId}/cards_${lang}.json`;

      // ✅ FALLBACK anciens formats
      const urlOld1 = `${LEGACY_I18N_PATH}/${lang}/cards_${universeId}.json`;
      const urlOld2 = `${LEGACY_I18N_PATH}/cards_${universeId}_${lang}.json`;

      let res = await fetch(urlNew, { cache: "no-cache" });
      if (!res.ok) res = await fetch(urlOld1, { cache: "no-cache" });
      if (!res.ok) res = await fetch(urlOld2, { cache: "no-cache" });

      if (!res.ok) {
        throw new Error(`[VREventsLoader] Impossible de charger les cartes de ${universeId} en ${lang}`);
      }
      return res.json();
    },

    async _loadEventsLogic(universeId) {
      const urlNew = `${SCENARIOS_PATH}/${universeId}/logic_events.json`;
      let res = await fetch(urlNew, { cache: "no-cache" });

      if (!res.ok) {
        const urlOld = `${LEGACY_EVENTS_LOGIC_PATH}/logic_events_${universeId}.json`;
        res = await fetch(urlOld, { cache: "no-cache" });
      }

      if (!res.ok) {
        // pas bloquant : si un univers n’a pas d’events, on renvoie vide
        return { events: [] };
      }
      const data = await res.json();
      if (Array.isArray(data)) return { events: data };
      if (data && typeof data === "object" && Array.isArray(data.events)) return data;
      return { events: [] };
    },

    async _loadEventsTexts(universeId, lang) {
      const urlNew = `${SCENARIOS_PATH}/${universeId}/events_${lang}.json`;

      // ✅ FALLBACK anciens formats
      const urlOld1 = `${LEGACY_I18N_PATH}/${lang}/events_${universeId}.json`;
      const urlOld2 = `${LEGACY_I18N_PATH}/events_${universeId}_${lang}.json`;

      let res = await fetch(urlNew, { cache: "no-cache" });
      if (!res.ok) res = await fetch(urlOld1, { cache: "no-cache" });
      if (!res.ok) res = await fetch(urlOld2, { cache: "no-cache" });

      if (!res.ok) return {};
      const data = await res.json();
      return (data && typeof data === "object") ? data : {};
    }
  };

  window.VREventsLoader = VREventsLoader;
})();


// -------------------------------------------------------
// ✅ Event Overlay (pas besoin de modifier game.html)
// Affiche titre + texte + bouton Continuer
// -------------------------------------------------------
(function () {
  "use strict";

  const tt = (k, fb) => {
    try {
      const v = window.VRI18n?.t?.(k);
      if (v && v !== k) return v;
    } catch (_) {}
    return fb;
  };

  function ensureOverlay() {
    const ID = "vr-event-overlay";
    let root = document.getElementById(ID);
    if (root) return root;

    root = document.createElement("div");
    root.id = ID;
    root.setAttribute("aria-hidden", "true");
    root.style.cssText =
      "position:fixed;inset:0;display:none;align-items:center;justify-content:center;" +
      "background:rgba(0,0,0,.58);z-index:2147483000;padding:16px;";

    const card = document.createElement("div");
    card.style.cssText =
      "width:min(720px, 94vw);border-radius:18px;padding:18px 18px 14px;" +
      "background:rgba(18,20,26,.94);color:#fff;box-shadow:0 18px 60px rgba(0,0,0,.55);" +
      "border:1px solid rgba(255,255,255,.14);";

    const title = document.createElement("div");
    title.id = "vr-event-title";
    title.style.cssText = "font:700 18px/1.2 system-ui,-apple-system,Segoe UI,Roboto,sans-serif;margin:0 0 10px;";

    const body = document.createElement("div");
    body.id = "vr-event-body";
    body.style.cssText = "font:14.5px/1.45 system-ui,-apple-system,Segoe UI,Roboto,sans-serif;opacity:.95;white-space:pre-wrap;";

    const row = document.createElement("div");
    row.style.cssText = "display:flex;justify-content:flex-end;gap:10px;margin-top:14px;";

    const btn = document.createElement("button");
    btn.id = "vr-event-continue";
    btn.type = "button";
    btn.textContent = tt("event.continue", "Continuer");
    btn.style.cssText =
      "border:0;border-radius:14px;padding:10px 14px;cursor:pointer;" +
      "background:rgba(255,255,255,.14);color:#fff;font:600 14px/1 system-ui,-apple-system,Segoe UI,Roboto,sans-serif;";

    row.appendChild(btn);
    card.appendChild(title);
    card.appendChild(body);
    card.appendChild(row);
    root.appendChild(card);

    document.body.appendChild(root);
    return root;
  }

  async function showEvent(title, bodyText) {
    const root = ensureOverlay();
    const tEl = document.getElementById("vr-event-title");
    const bEl = document.getElementById("vr-event-body");
    const btn = document.getElementById("vr-event-continue");

    if (btn) btn.textContent = tt("event.continue", "Continuer");
    if (tEl) tEl.textContent = title || tt("event.title", "Événement");
    if (bEl) bEl.textContent = bodyText || "";

    return new Promise((resolve) => {
      const close = () => {
        root.setAttribute("aria-hidden", "true");
        root.style.display = "none";
        try { btn.removeEventListener("click", close); } catch (_) {}
        resolve(true);
      };
      try { btn.addEventListener("click", close); } catch (_) {}
      root.setAttribute("aria-hidden", "false");
      root.style.display = "flex";
      try { btn.focus?.({ preventScroll: true }); } catch (_) {}
    });
  }

  window.VREventOverlay = { showEvent };
})();


// VRealms - engine/ui-binding.js
// (modifié: FIX(1) PointerOnly + fallback touch)
(function () {
  "use strict";

  const clamp = (val, min, max) => Math.max(min, Math.min(max, val));
  const HAS_POINTER = ("PointerEvent" in window);

  const VRUIBinding = {
    updateMeta(kingName, years, coins, tokens) {
      const kingEl = document.getElementById("meta-king-name");
      const yearsEl = document.getElementById("meta-years");
      const coinsEl = document.getElementById("meta-coins");
      const tokensEl = document.getElementById("meta-tokens");

      if (kingEl) kingEl.textContent = kingName || "—";
      if (yearsEl) yearsEl.textContent = String(years || 0);
      if (coinsEl) coinsEl.textContent = String(coins || 0);
      if (tokensEl) tokensEl.textContent = String(tokens || 0);
    },

    universeConfig: null,
    lang: "fr",
    currentCardLogic: null,
    cardTextsDict: null,

    // ✅ PEEK (15 décisions) — activé via popup jeton
    peekRemaining: 0,
    _peekChoiceActive: null,

    init(universeConfig, lang, cardTextsDict) {
      this.universeConfig = universeConfig;
      this.lang = lang || "fr";
      this.cardTextsDict = cardTextsDict || {};

      this.peekRemaining = 0;
      this._peekChoiceActive = null;
      try { document.body?.classList?.remove("vr-peek-mode"); } catch (_) {}

      this._ensurePeekStyles();
      this._setupGaugeLabels();
      this._ensureGaugePreviewBars();
      this.updateGauges();
      this._setupChoiceButtons(); // ✅ swipe sur A/B/C
    },

    enablePeek(steps) {
      const n = Math.max(0, Math.min(Number(steps || 0), 99));
      this.peekRemaining = n;

      this._ensurePeekStyles();

      try {
        if (n > 0) document.body.classList.add("vr-peek-mode");
        else document.body.classList.remove("vr-peek-mode");
      } catch (_) {}
    },

    _ensurePeekStyles() {
      try {
        const ID = "vr_peek_styles";
        if (document.getElementById(ID)) return;

        const style = document.createElement("style");
        style.id = ID;
        style.textContent = `
@keyframes vrPeekGlow {
  0%   { filter: brightness(1); }
  50%  { filter: brightness(1.25); }
  100% { filter: brightness(1); }
}
@keyframes vrPeekPulse {
  0%   { transform: translateZ(0) scale(1); }
  50%  { transform: translateZ(0) scale(1.01); }
  100% { transform: translateZ(0) scale(1); }
}
body.vr-peek-mode .vr-gauge.vr-peek-up,
body.vr-peek-mode .vr-gauge.vr-peek-down{
  animation: vrPeekGlow 650ms ease-in-out infinite;
}
body.vr-peek-mode .vr-gauge.vr-peek-up .vr-gauge-frame,
body.vr-peek-mode .vr-gauge.vr-peek-down .vr-gauge-frame{
  box-shadow: 0 0 0 2px rgba(255,255,255,.18), 0 10px 24px rgba(0,0,0,.22);
}
body.vr-peek-mode .vr-gauge-preview{
  position:absolute;
  inset:0;
  pointer-events:none;
  opacity:.55;
  clip-path: inset(calc(100% - var(--vr-pct, 0%)) 0 0 0);
}
`;
        (document.head || document.documentElement).appendChild(style);
      } catch (_) {}
    },

    _consumePeekDecision() {
      if (this.peekRemaining <= 0) return;
      this.peekRemaining = Math.max(0, this.peekRemaining - 1);
      if (this.peekRemaining <= 0) {
        this.peekRemaining = 0;
        this._clearPeek();
        try { document.body.classList.remove("vr-peek-mode"); } catch (_) {}
      }
    },

    _setupGaugeLabels() {
      const gaugesCfg = this.universeConfig?.gauges || [];
      const gaugeEls = document.querySelectorAll(".vr-gauge");
      const universeId = this.universeConfig?.id || "unknown";

      gaugeEls.forEach((el, idx) => {
        const labelEl = el.querySelector(".vr-gauge-label");
        const fillEl = el.querySelector(".vr-gauge-fill");
        const cfg = gaugesCfg[idx];
        if (!cfg) return;

        const gaugeId = cfg.id;

        const i18nKey = `gauges.${universeId}.${gaugeId}`;
        const translated =
          window.VRI18n && typeof window.VRI18n.t === "function"
            ? window.VRI18n.t(i18nKey)
            : null;

        const label =
          (translated && translated !== i18nKey ? translated : null) ||
          cfg?.[`label_${this.lang}`] ||
          cfg?.label ||
          cfg?.id;

        if (labelEl) labelEl.textContent = label || "—";

        if (fillEl) fillEl.dataset.gaugeId = gaugeId;
        el.dataset.gaugeId = gaugeId;
      });
    },

    _ensureGaugePreviewBars() {
      const gaugeEls = document.querySelectorAll(".vr-gauge");
      gaugeEls.forEach((el) => {
        let preview = el.querySelector(".vr-gauge-preview");
        if (!preview) {
          preview = document.createElement("div");
          preview.className = "vr-gauge-preview";
          preview.style.setProperty("--vr-pct", "0%");

          try {
            preview.style.position = "absolute";
            preview.style.inset = "0";
            preview.style.pointerEvents = "none";
            preview.style.opacity = "0.55";
            preview.style.clipPath = "inset(calc(100% - var(--vr-pct, 0%)) 0 0 0)";
          } catch (_) {}

          const frame = el.querySelector(".vr-gauge-frame");
          if (frame) {
            try {
              const pos = getComputedStyle(frame).position;
              if (pos === "static") frame.style.position = "relative";
            } catch (_) {}
            frame.appendChild(preview);
          }
        }
      });
    },

    updateGauges() {
      const gaugesCfg = this.universeConfig?.gauges || [];
      const fillEls = document.querySelectorAll(".vr-gauge-fill");

      fillEls.forEach((fillEl, idx) => {
        const gaugeId = fillEl.dataset.gaugeId || gaugesCfg[idx]?.id || null;
        if (!gaugeId) return;

        const val =
          window.VRState.getGaugeValue(gaugeId) ??
          this.universeConfig?.initialGauges?.[gaugeId] ??
          gaugesCfg[idx]?.start ??
          50;

        fillEl.style.setProperty("--vr-pct", `${val}%`);
      });

      const previewEls = document.querySelectorAll(".vr-gauge-preview");
      previewEls.forEach((previewEl) => previewEl.style.setProperty("--vr-pct", "0%"));

      this._clearPeekClasses();
    },

    showCard(cardLogic) {
      this.currentCardLogic = cardLogic;
      const texts = this.cardTextsDict?.[cardLogic.id];
      if (!texts) {
        console.error("[VRUIBinding] Textes introuvables pour la carte", cardLogic.id);
        return;
      }

      const titleEl = document.getElementById("card-title");
      const bodyEl = document.getElementById("card-text");
      const choiceAEl = document.getElementById("choice-A");
      const choiceBEl = document.getElementById("choice-B");
      const choiceCEl = document.getElementById("choice-C");

      if (titleEl) titleEl.textContent = texts.title || "";
      if (bodyEl) bodyEl.textContent = texts.body || "";
      if (choiceAEl) choiceAEl.textContent = texts.choices?.A || "";
      if (choiceBEl) choiceBEl.textContent = texts.choices?.B || "";
      if (choiceCEl) choiceCEl.textContent = texts.choices?.C || "";

      this._resetChoiceCards();
      this._clearPeek();
    },

    _resetChoiceCards() {
      const btns = document.querySelectorAll(".vr-choice-button[data-choice]");
      btns.forEach((b) => {
        b.style.transition = "";
        b.style.transform = "";
      });
    },

    _setupChoiceButtons() {
      const buttons = Array.from(document.querySelectorAll(".vr-choice-button[data-choice]"));

      buttons.forEach((btn) => {
        btn.addEventListener("click", (e) => {
          e.preventDefault();
          e.stopPropagation();
        });

        try { btn.style.touchAction = "none"; } catch (_) {}
        this._setupSwipeOnChoiceCard(btn);
      });
    },

    _setupSwipeOnChoiceCard(btn) {
      const TH = 62;
      const ROT_MAX = 12;
      let startX = 0;
      let startY = 0;
      let lastX = 0;
      let lastY = 0;
      let dragging = false;
      let pointerId = null;

      const getPoint = (e) => {
        if (e.touches && e.touches[0]) {
          return { x: e.touches[0].clientX || 0, y: e.touches[0].clientY || 0 };
        }
        return { x: e.clientX || 0, y: e.clientY || 0 };
      };

      const setTransform = (dx) => {
        const w = Math.max(1, window.innerWidth || 360);
        const p = clamp(dx / (w * 0.45), -1, 1);
        const rot = p * ROT_MAX;
        btn.style.transform = `translateX(${dx}px) rotate(${rot}deg)`;
      };

      const animateBack = () => {
        btn.style.transition = "transform 180ms cubic-bezier(.2,.9,.2,1)";
        btn.style.transform = "translateX(0px) rotate(0deg)";
        window.setTimeout(() => { btn.style.transition = ""; }, 200);
      };

      const animateFlyOut = (dx, done) => {
        const dir = dx >= 0 ? 1 : -1;
        const outX = dir * (Math.max(window.innerWidth || 360, 360) * 1.2);

        btn.style.transition = "transform 220ms cubic-bezier(.2,.9,.2,1)";
        btn.style.transform = `translateX(${outX}px) rotate(${dir * ROT_MAX}deg)`;

        window.setTimeout(() => {
          btn.style.transition = "";
          btn.style.transform = "";
          done && done();
        }, 235);
      };

      const onDown = (e) => {
        if (!this.currentCardLogic) return;

        try { e.preventDefault(); } catch (_) {}
        try { e.stopPropagation(); } catch (_) {}

        dragging = true;
        const p = getPoint(e);
        startX = p.x;
        startY = p.y;
        lastX = p.x;
        lastY = p.y;

        pointerId = e.pointerId ?? null;
        try { if (pointerId != null) btn.setPointerCapture(pointerId); } catch (_) {}

        const choiceId = btn.getAttribute("data-choice");
        if (choiceId && this.peekRemaining > 0) {
          this._showPeekForChoice(choiceId);
        }
      };

      const onMove = (e) => {
        if (!dragging) return;

        try { e.preventDefault(); } catch (_) {}
        try { e.stopPropagation(); } catch (_) {}

        const p = getPoint(e);
        lastX = p.x;
        lastY = p.y;

        const dx = lastX - startX;
        const dy = lastY - startY;

        if (Math.abs(dy) > Math.abs(dx) * 1.25) {
          setTransform(dx * 0.25);
          return;
        }

        setTransform(dx);
      };

      const onUp = () => {
        if (!dragging) return;
        dragging = false;

        const dx = lastX - startX;

        this._clearPeek();

        if (Math.abs(dx) >= TH && this.currentCardLogic) {
          const choiceId = btn.getAttribute("data-choice");
          if (!choiceId) {
            animateBack();
            return;
          }

          animateFlyOut(dx, () => {
            try { window.VREngine.applyChoice(this.currentCardLogic, choiceId); } catch (_) {}
          });
        } else {
          animateBack();
        }
      };

      // ✅ FIX(1): pointer only (fallback touch only if no PointerEvent)
      if (HAS_POINTER) {
        btn.addEventListener("pointerdown", onDown, { passive: false });
        btn.addEventListener("pointermove", onMove, { passive: false });
        btn.addEventListener("pointerup", onUp, { passive: true });
        btn.addEventListener("pointercancel", onUp, { passive: true });
      } else {
        btn.addEventListener("touchstart", onDown, { passive: false });
        btn.addEventListener("touchmove", onMove, { passive: false });
        btn.addEventListener("touchend", onUp, { passive: true });
        btn.addEventListener("touchcancel", onUp, { passive: true });
      }
    },

    _clearPeekClasses() {
      try {
        document.querySelectorAll(".vr-gauge").forEach((g) => {
          g.classList.remove("vr-peek-up");
          g.classList.remove("vr-peek-down");
        });
      } catch (_) {}
    },

    _clearPeek() {
      this._peekChoiceActive = null;

      const previewEls = document.querySelectorAll(".vr-gauge-preview");
      previewEls.forEach((previewEl) => previewEl.style.setProperty("--vr-pct", "0%"));

      this._clearPeekClasses();
    },

    _showPeekForChoice(choiceId) {
      if (!this.currentCardLogic?.choices?.[choiceId]) return;

      this._peekChoiceActive = choiceId;

      const gaugesCfg = this.universeConfig?.gauges || [];
      const gaugeEls = document.querySelectorAll(".vr-gauge");
      const previewEls = document.querySelectorAll(".vr-gauge-preview");

      gaugeEls.forEach((g) => {
        g.classList.remove("vr-peek-up");
        g.classList.remove("vr-peek-down");
      });

      previewEls.forEach((previewEl, idx) => {
        const cfg = gaugesCfg[idx];
        if (!cfg) return;

        const gaugeId = cfg.id;

        const baseVal =
          window.VRState.getGaugeValue(gaugeId) ??
          this.universeConfig?.initialGauges?.[gaugeId] ??
          cfg.start ??
          50;

        const d = this.currentCardLogic.choices[choiceId]?.gaugeDelta?.[gaugeId];
        const delta = (typeof d === "number") ? d : 0;

        const previewVal = clamp(baseVal + delta, 0, 100);
        previewEl.style.setProperty("--vr-pct", `${previewVal}%`);

        const gaugeEl = gaugeEls[idx];
        if (gaugeEl) {
          if (delta > 0) gaugeEl.classList.add("vr-peek-up");
          else if (delta < 0) gaugeEl.classList.add("vr-peek-down");
        }
      });
    }
  };

  window.VRUIBinding = VRUIBinding;
})();


// VRealms - engine/state.js
(function () {
  "use strict";

  const clamp = (val, min, max) => Math.max(min, Math.min(max, val));

  const VRState = {
    universeId: null,
    gauges: {},
    gaugeOrder: [],
    alive: false,
    lastDeath: null,
    reignYears: 0,
    cardsPlayed: 0,

    initUniverse(universeConfig) {
      this.universeId = universeConfig.id;
      this.gauges = {};
      this.gaugeOrder = [];
      this.alive = true;
      this.lastDeath = null;
      this.reignYears = 0;
      this.cardsPlayed = 0;

      (universeConfig.gauges || []).forEach((g) => {
        this.gauges[g.id] = universeConfig?.initialGauges?.[g.id] ?? g.start ?? 50;
        this.gaugeOrder.push(g.id);
      });
    },

    isAlive() { return this.alive; },
    getGaugeValue(id) { return this.gauges[id]; },

    setGaugeValue(id, val) {
      this.gauges[id] = clamp(Number(val ?? 50), 0, 100);
      this.lastDeath = null;
      this.alive = true;
    },

    applyDeltas(deltaMap) {
      if (!this.alive) return;

      Object.entries(deltaMap || {}).forEach(([gaugeId, delta]) => {
        const current = this.gauges[gaugeId] ?? 50;
        const next = clamp(current + delta, 0, 100);
        this.gauges[gaugeId] = next;
      });

      this.lastDeath = null;
      for (const gaugeId of Object.keys(this.gauges)) {
        const v = this.gauges[gaugeId];
        if (v <= 0) { this.alive = false; this.lastDeath = { gaugeId, direction: "down" }; break; }
        if (v >= 100) { this.alive = false; this.lastDeath = { gaugeId, direction: "up" }; break; }
      }
    },

    tickYear() { if (this.alive) this.reignYears += 1; },
    getReignYears() { return this.reignYears; },
    incrementCardsPlayed() { this.cardsPlayed += 1; },
    getLastDeath() { return this.lastDeath; }
  };

  window.VRState = VRState;
})();


// VRealms - engine/endings.js
(function () {
  "use strict";

  const ENDINGS_BASE_PATH = "data/scenarios";
  const cache = new Map(); // key = universeId__lang

  async function loadEndings(universeId, lang) {
    const key = `${universeId}__${lang}`;
    if (cache.has(key)) return cache.get(key);

    const urlNew = `${ENDINGS_BASE_PATH}/${universeId}/endings_${lang}.json`;
    const urlOld1 = `data/i18n/${lang}/endings_${universeId}.json`;
    const urlOld2 = `data/i18n/endings_${universeId}_${lang}.json`;

    let res = await fetch(urlNew, { cache: "no-cache" });
    if (!res.ok) res = await fetch(urlOld1, { cache: "no-cache" });
    if (!res.ok) res = await fetch(urlOld2, { cache: "no-cache" });

    if (!res.ok) {
      const empty = {};
      cache.set(key, empty);
      return empty;
    }

    const data = await res.json();
    const safe = data && typeof data === "object" ? data : {};
    cache.set(key, safe);
    return safe;
  }

  async function showEnding(universeConfig, lastDeath) {
    const overlay = document.getElementById("vr-ending-overlay");
    const titleEl = document.getElementById("ending-title");
    const textEl = document.getElementById("ending-text");

    if (!overlay || !titleEl || !textEl) return;

    const universeId =
      universeConfig?.id || localStorage.getItem("vrealms_universe") || "hell_king";

    let lang = "fr";
    try {
      const me = await window.VRProfile?.getMe?.(4000);
      lang = (me?.lang || "fr").toString();
    } catch (_) {
      lang = localStorage.getItem("vrealms_lang") || "fr";
    }

    const endings = await loadEndings(universeId, lang);

    const gaugeId = lastDeath?.gaugeId || null;
    const direction = lastDeath?.direction || null;

    const candidates = [];
    let value = null;
    if (direction === "down") value = "0";
    if (direction === "up") value = "100";

    if (gaugeId && direction) {
      candidates.push(`${gaugeId}_${direction}`);
    }
    if (gaugeId && value != null) {
      candidates.push(`${gaugeId}_${value}`);
      candidates.push(`end_${gaugeId}_${value}`);

      const esc = String(gaugeId).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const reEnd = new RegExp(`(^|_)end_${esc}_${value}$`);
      for (const k of Object.keys(endings || {})) {
        if (reEnd.test(k)) candidates.push(k);
      }
    }

    candidates.push("default");

    let ending = null;
    for (const k of candidates) {
      if (k && endings && endings[k]) { ending = endings[k]; break; }
    }

    const t = (key) => {
      try {
        const out = window.VRI18n?.t?.(key);
        if (out && out !== key) return out;
      } catch (_) {}
      return null;
    };

    titleEl.textContent = ending?.title || t("game.ending.title") || "Fin du règne";
    textEl.textContent =
      ending?.text || ending?.body || t("game.ending.body") || "Votre règne s'achève ici.";

    overlay.classList.add("vr-ending-visible");
  }

  function hideEnding() {
    const overlay = document.getElementById("vr-ending-overlay");
    if (!overlay) return;
    overlay.classList.remove("vr-ending-visible");
  }

  window.VREndings = { showEnding, hideEnding };
})();


// VRealms - engine/engine-core.js
(function () {
  "use strict";

  const RECENT_MEMORY_SIZE = 4;
  const BASE_COINS_PER_CARD = 5;
  const HISTORY_MAX = 30;

  // ✅ EVENTS règles
  const EVENT_CHECK_EVERY_N_CARDS = 3; // toutes les 3 cartes (par univers)
  const EVENT_CHANCE = 0.10;           // 1/10
  const EVENT_NO_REPEAT_UNTIL = 25;    // pas de répétition avant 25 DISTINCTS
  const EVENT_EXCLUDE_LAST = 5;        // après reset, on exclut les 5 derniers (tirages)

  const HELL_KING_DYNASTIES = ["Lucifer","Belzebuth","Lilith","Asmodée","Mammon","Baal","Astaroth","Abaddon"];

  function getDynastyName(reignIndex) {
    const baseName = HELL_KING_DYNASTIES[reignIndex % HELL_KING_DYNASTIES.length];
    const number = Math.floor(reignIndex / HELL_KING_DYNASTIES.length) + 1;
    return `${baseName} ${number}`;
  }

  function deepClone(obj) {
    try { return JSON.parse(JSON.stringify(obj)); } catch (_) { return obj; }
  }

  function asInt(x, fallback) {
    const n = Number(x);
    return Number.isFinite(n) ? Math.trunc(n) : (fallback || 0);
  }

  const VREngine = {
    universeId: null,
    universeConfig: null,
    deck: [],
    cardTextsDict: {},
    currentCardLogic: null,
    recentCards: [],
    reignIndex: 0,
    coinsStreak: 0,
    lang: "fr",

    // ✅ revive (seconde chance) — 1 fois par run
    _reviveUsed: false,

    history: [],

    // petit miroir UI (PAS persisté officiellement DB)
    _uiCoins: 0,
    _uiTokens: 0,

    // ✅ restore flags
    _restored: false,

    // ✅ EVENTS runtime (persistés via save locale)
    eventsLogic: { events: [] },
    eventsTexts: {},
    _eventById: new Map(),
    _allEventIds: [],
    _eventPool: [],
    _seenEvents: [],
    _cardsSinceEventRoll: 0,
    _eventShowing: false,

    // ✅ FIX(2): binding death UI once
    _deathUiBound: false,

    _distinctSeenCount() {
      try { return new Set(Array.isArray(this._seenEvents) ? this._seenEvents : []).size; }
      catch (_) { return 0; }
    },

    _rebuildEventIndex() {
      this._eventById = new Map();
      const arr = Array.isArray(this.eventsLogic?.events) ? this.eventsLogic.events : [];
      arr.forEach((ev) => {
        if (ev && ev.id) this._eventById.set(ev.id, ev);
      });

      this._allEventIds = Array.from(this._eventById.keys());

      if (!Array.isArray(this._eventPool)) this._eventPool = [];
      if (!Array.isArray(this._seenEvents)) this._seenEvents = [];

      // ✅ sanitize pool/seen against current ids
      const allow = new Set(this._allEventIds);
      this._eventPool = this._eventPool.filter(id => allow.has(id));
      this._seenEvents = this._seenEvents.filter(id => allow.has(id));

      if (!this._eventPool.length && this._allEventIds.length) {
        this._eventPool = this._allEventIds.slice();
      }

      if (!Number.isFinite(this._cardsSinceEventRoll)) this._cardsSinceEventRoll = 0;
    },

    _makeSavePayload() {
      try {
        return {
          state: {
            alive: !!window.VRState?.alive,
            lastDeath: window.VRState?.lastDeath || null,
            reignYears: Number(window.VRState?.reignYears || 0),
            cardsPlayed: Number(window.VRState?.cardsPlayed || 0),
            gauges: deepClone(window.VRState?.gauges || {})
          },
          engine: {
            reignIndex: Number(this.reignIndex || 0),
            recentCards: deepClone(this.recentCards || []),
            coinsStreak: Number(this.coinsStreak || 0),
            currentCardId: this.currentCardLogic?.id || null,
            reviveUsed: !!this._reviveUsed,

            // ✅ persist events per-universe
            events: {
              cardsSinceRoll: asInt(this._cardsSinceEventRoll, 0),
              pool: Array.isArray(this._eventPool) ? deepClone(this._eventPool) : [],
              seen: Array.isArray(this._seenEvents) ? deepClone(this._seenEvents) : []
            },

            // ✅ persist UI mirrors
            ui: {
              coins: asInt(this._uiCoins, 0),
              tokens: asInt(this._uiTokens, 0)
            }
          },
          session: {
            reignLength: Number(window.VRGame?.session?.reignLength || 0)
          }
        };
      } catch (_) {
        return null;
      }
    },

    _saveRunSoft() {
      try {
        const universeId =
          this.universeId ||
          window.VRState?.universeId ||
          localStorage.getItem("vrealms_universe") ||
          "unknown";

        const payload = this._makeSavePayload();
        if (!payload) return;
        window.VRSave?.save?.(universeId, payload);
      } catch (_) {}
    },

    _restoreFromSaveIfAny() {
      try {
        const universeId = this.universeId;
        if (!universeId) return false;

        const saved = window.VRSave?.load?.(universeId);
        if (!saved) return false;

        const s = saved.state || {};
        const e = saved.engine || {};
        const sess = saved.session || {};

        // state
        if (s && typeof s === "object") {
          if (s.gauges && typeof s.gauges === "object") {
            window.VRState.gauges = deepClone(s.gauges) || window.VRState.gauges;
          }
          window.VRState.alive = (s.alive !== false);
          window.VRState.lastDeath = s.lastDeath || null;
          window.VRState.reignYears = Number(s.reignYears || 0);
          window.VRState.cardsPlayed = Number(s.cardsPlayed || 0);
        }

        // engine
        this.reignIndex = Math.max(0, Number(e.reignIndex || 0));
        this.recentCards = Array.isArray(e.recentCards) ? deepClone(e.recentCards) : [];
        this.coinsStreak = Number(e.coinsStreak || 0);
        this._reviveUsed = !!e.reviveUsed;

        // ✅ restore events per universe
        const evs = e.events || {};
        this._cardsSinceEventRoll = asInt(evs.cardsSinceRoll, 0);
        this._eventPool = Array.isArray(evs.pool) ? deepClone(evs.pool) : [];
        this._seenEvents = Array.isArray(evs.seen) ? deepClone(evs.seen) : [];

        // ✅ restore UI mirrors
        const ui = e.ui || {};
        if (Number.isFinite(Number(ui.coins))) this._uiCoins = asInt(ui.coins, this._uiCoins);
        if (Number.isFinite(Number(ui.tokens))) this._uiTokens = asInt(ui.tokens, this._uiTokens);

        // session mirror
        if (window.VRGame?.session) {
          window.VRGame.session.reignLength = Number(sess.reignLength || 0);
        }

        // current card
        const cardId = e.currentCardId || null;
        const card = cardId ? this.deck.find(c => c && c.id === cardId) : null;

        if (card) {
          this.currentCardLogic = card;
          window.VRUIBinding.showCard(card);
        } else {
          const deck = this.deck || [];
          if (!deck.length) return false;

          const candidates = deck.filter(c => c && !this.recentCards.includes(c.id));
          const pool = candidates.length ? candidates : deck;

          const picked = pool[Math.floor(Math.random() * pool.length)];
          if (!picked) return false;

          this.currentCardLogic = picked;
          window.VRUIBinding.showCard(picked);
        }

        window.VRUIBinding.updateGauges();

        const kingName = getDynastyName(Math.max(0, this.reignIndex - 1));
        window.VRUIBinding.updateMeta(
          kingName,
          window.VRState.getReignYears(),
          this._uiCoins,
          this._uiTokens
        );

        this._restored = true;
        return true;
      } catch (_) {
        return false;
      }
    },

    async init(universeId, lang) {
      this.universeId = universeId;

      // ✅ 100% Supabase lang si possible (fallback param)
      let finalLang = (lang || "fr").toString();
      try {
        const me = await window.VRProfile?.getMe?.(4000);
        finalLang = (me?.lang || finalLang || "fr").toString();
      } catch (_) {}
      this.lang = finalLang;

      const { config, deck, cardTexts } =
        await window.VREventsLoader.loadUniverseData(universeId, this.lang);

      // ✅ load events for this universe (non bloquant)
      let eventsLogic = { events: [] };
      let eventsTexts = {};
      try {
        const ev = await window.VREventsLoader.loadUniverseEvents(universeId, this.lang);
        eventsLogic = ev?.eventsLogic || { events: [] };
        eventsTexts = ev?.eventsTexts || {};
      } catch (_) {}

      this.universeConfig = config;
      this.deck = Array.isArray(deck) ? deck : [];
      this.cardTextsDict = cardTexts || {};
      this.recentCards = [];
      this.reignIndex = 0;
      this.coinsStreak = 0;
      this.history = [];
      this.currentCardLogic = null;
      this._restored = false;
      this._reviveUsed = false;

      // ✅ events init
      this.eventsLogic = eventsLogic || { events: [] };
      this.eventsTexts = eventsTexts || {};
      this._eventPool = [];
      this._seenEvents = [];
      this._cardsSinceEventRoll = 0;
      this._eventShowing = false;
      this._rebuildEventIndex();

      // init UI balances from remote
      try {
        const me = await window.VRProfile?.getMe?.(0);
        this._uiCoins = window.VRProfile._n(me?.vcoins);
        this._uiTokens = window.VRProfile._n(me?.jetons);
      } catch (_) {
        this._uiCoins = 0;
        this._uiTokens = 0;
      }

      window.VRState.initUniverse(this.universeConfig);
      window.VRUIBinding.init(this.universeConfig, this.lang, this.cardTextsDict);

      // ✅ RESTORE si une save existe (sinon nouvelle run)
      const restored = this._restoreFromSaveIfAny();

      // important: rebuild + sanitize pool/seen après restore
      this._rebuildEventIndex();

      if (!restored) {
        this._startNewReign();
        this._saveRunSoft();
      } else {
        // garde-fou si pool vide
        if (!this._eventPool.length && this._allEventIds.length) {
          this._eventPool = this._allEventIds.slice();
        }
        this._saveRunSoft();
      }
    },

    async _refreshUIBalancesSoft() {
      try {
        const me = await window.VRProfile?.getMe?.(800);
        if (me) {
          this._uiCoins = window.VRProfile._n(me.vcoins);
          this._uiTokens = window.VRProfile._n(me.jetons);
        }
      } catch (_) {}
    },

    _resetGaugesToInitial() {
      try {
        const cfg = this.universeConfig || {};
        const init = (cfg && cfg.initialGauges) ? cfg.initialGauges : {};
        const gauges = (cfg.gauges || []);
        gauges.forEach((g) => {
          const v = (init && Object.prototype.hasOwnProperty.call(init, g.id)) ? init[g.id] : (g.start ?? 50);
          window.VRState.gauges[g.id] = (Number.isFinite(Number(v)) ? Number(v) : 50);
        });
      } catch (_) {}
    },

    _startNewReign() {
      this.reignIndex += 1;
      window.VRState.alive = true;
      window.VRState.lastDeath = null;
      window.VRState.reignYears = 0;
      window.VRState.cardsPlayed = 0;

      // ✅ reset gauges (50% / initialGauges)
      this._resetGaugesToInitial();

      this.recentCards = [];
      this.coinsStreak = 0;
      this.history = [];
      this.currentCardLogic = null;

      // ✅ reset revive for this run
      this._reviveUsed = false;

      // ✅ reset event counter for this run (par univers)
      this._cardsSinceEventRoll = 0;
      // pool/seen on garde (persistant par univers)
      if (!this._eventPool.length && this._allEventIds.length) {
        this._eventPool = this._allEventIds.slice();
      }

      const kingName = getDynastyName(this.reignIndex - 1);
      const years = window.VRState.getReignYears();

      window.VRUIBinding.updateMeta(kingName, years, this._uiCoins, this._uiTokens);

      this._refreshUIBalancesSoft().then(() => {
        window.VRUIBinding.updateMeta(kingName, years, this._uiCoins, this._uiTokens);
      });

      this._nextCard();
      this._saveRunSoft();
    },

    // ✅ Clear save locale du RUN (par univers)
    _clearRunSave() {
      try {
        const universeId =
          this.universeId ||
          window.VRState?.universeId ||
          localStorage.getItem("vrealms_universe") ||
          "unknown";
        window.VRSave?.clear?.(universeId);
      } catch (_) {}
    },

    // ✅ Recommencer = clear save + reset jauges + nouvelle partie (début)
    restartRun() {
      try { this._clearRunSave(); } catch (_) {}

      // reset “run” en RAM pour repartir au tout début
      this._reviveUsed = false;
      this.history = [];
      this.recentCards = [];
      this.coinsStreak = 0;
      this.currentCardLogic = null;

      // reset “début” (dynastie 1) + events clean
      this.reignIndex = 0;
      this._cardsSinceEventRoll = 0;
      this._eventShowing = false;
      this._eventPool = this._allEventIds.slice();
      this._seenEvents = [];

      if (window.VRGame?.session) window.VRGame.session.reignLength = 0;

      // relance run
      this._startNewReign();
    },

    // ✅ Revivre (seconde chance) : reset jauges + reprendre sur une carte (même règne)
    reviveSecondChance() {
      if (this._reviveUsed) return false; // une seule fois par run
      this._reviveUsed = true;

      // reset jauges + revive
      this._resetGaugesToInitial();
      try {
        window.VRState.alive = true;
        window.VRState.lastDeath = null;
      } catch (_) {}

      try { window.VRUIBinding?.updateGauges?.(); } catch (_) {}

      // reprise sur une carte
      try { this._nextCard_internalOnly(); } catch (_) { try { this._nextCard(); } catch (_) {} }

      try { this._saveRunSoft(); } catch (_) {}
      return true;
    },

    _nextCard() {
      if (!window.VRState.isAlive()) return;
      if (this._eventShowing) return;

      if (!Array.isArray(this.deck) || this.deck.length === 0) {
        console.error("[VREngine] Deck vide : impossible de piocher une carte.");
        return;
      }

      const candidates = this.deck.filter((c) => !this.recentCards.includes(c.id));
      let card = null;

      if (candidates.length > 0) {
        card = candidates[Math.floor(Math.random() * candidates.length)];
      } else {
        card = this.deck[Math.floor(Math.random() * this.deck.length)];
      }

      if (!card) return;

      this.currentCardLogic = card;
      this._rememberCard(card.id);
      window.VRState.incrementCardsPlayed();
      window.VRUIBinding.showCard(card);

      this._saveRunSoft();
    },

    _rememberCard(cardId) {
      this.recentCards.push(cardId);
      if (this.recentCards.length > RECENT_MEMORY_SIZE) this.recentCards.shift();
    },

    _pushHistorySnapshot(cardLogic) {
      const snap = {
        cardId: cardLogic?.id || null,
        gauges: deepClone(window.VRState.gauges),
        alive: true,
        lastDeath: null,
        reignYears: window.VRState.reignYears,
        cardsPlayed: window.VRState.cardsPlayed,
        recentCards: deepClone(this.recentCards),
        coinsStreak: this.coinsStreak,
        uiCoins: this._uiCoins,
        uiTokens: this._uiTokens,
        sessionReignLength: Number(window.VRGame?.session?.reignLength || 0),

        // ✅ aussi pour undo: on garde le compteur (sinon dé-sync)
        cardsSinceEventRoll: asInt(this._cardsSinceEventRoll, 0),
        eventPool: deepClone(this._eventPool || []),
        seenEvents: deepClone(this._seenEvents || [])
      };
      this.history.push(snap);
      if (this.history.length > HISTORY_MAX) this.history.shift();
    },

    undoChoices(steps) {
      const n = Math.max(1, Math.min(Number(steps || 1), 10));
      if (!this.history.length) return false;

      let snap = null;
      for (let i = 0; i < n; i++) {
        if (!this.history.length) break;
        snap = this.history.pop();
      }
      if (!snap) return false;

      window.VRState.gauges = deepClone(snap.gauges) || window.VRState.gauges;
      window.VRState.alive = true;
      window.VRState.lastDeath = null;
      window.VRState.reignYears = Number(snap.reignYears || 0);
      window.VRState.cardsPlayed = Number(snap.cardsPlayed || 0);

      this.recentCards = deepClone(snap.recentCards) || [];
      this.coinsStreak = Number(snap.coinsStreak || 0);
      this._uiCoins = Number(snap.uiCoins || 0);
      this._uiTokens = Number(snap.uiTokens || 0);

      // ✅ restore events state
      this._cardsSinceEventRoll = asInt(snap.cardsSinceEventRoll, 0);
      this._eventPool = Array.isArray(snap.eventPool) ? deepClone(snap.eventPool) : this._eventPool;
      this._seenEvents = Array.isArray(snap.seenEvents) ? deepClone(snap.seenEvents) : this._seenEvents;

      if (window.VRGame?.session) {
        window.VRGame.session.reignLength = Number(snap.sessionReignLength || 0);
      }

      const card = this.deck.find(c => c.id === snap.cardId) || this.currentCardLogic;
      if (card) {
        this.currentCardLogic = card;
        window.VRUIBinding.showCard(card);
      }

      window.VRUIBinding.updateGauges();

      const kingName = getDynastyName(this.reignIndex - 1);
      window.VRUIBinding.updateMeta(
        kingName,
        window.VRState.getReignYears(),
        this._uiCoins,
        this._uiTokens
      );

      this._saveRunSoft();
      return true;
    },

    _maybeRollEventAfterCardResolved() {
      this._cardsSinceEventRoll = asInt(this._cardsSinceEventRoll, 0) + 1;

      if (this._cardsSinceEventRoll < EVENT_CHECK_EVERY_N_CARDS) {
        this._saveRunSoft();
        return false;
      }

      this._cardsSinceEventRoll = 0;

      // si pas d’events dans cet univers => rien
      if (!this._allEventIds.length) {
        this._saveRunSoft();
        return false;
      }

      // tirage 1/10
      const hit = Math.random() < EVENT_CHANCE;
      this._saveRunSoft();
      return hit;
    },

    _refillEventPoolIfNeeded() {
      const all = this._allEventIds || [];
      if (!all.length) return;

      if (!Array.isArray(this._seenEvents)) this._seenEvents = [];
      if (!Array.isArray(this._eventPool)) this._eventPool = [];

      if (this._eventPool.length !== 0) return;

      // ✅ règle: pas de répétition avant 25 DISTINCTS
      const distinct = this._distinctSeenCount();

      if (distinct < EVENT_NO_REPEAT_UNTIL) {
        const seenSet = new Set(this._seenEvents);
        this._eventPool = all.filter(id => !seenSet.has(id));
        if (!this._eventPool.length) this._eventPool = all.slice();
        return;
      }

      // après 25 distincts, on exclut les 5 derniers tirages
      const last = this._seenEvents.slice(-EVENT_EXCLUDE_LAST);
      const lastSet = new Set(last);
      this._eventPool = all.filter(id => !lastSet.has(id));
      if (!this._eventPool.length) this._eventPool = all.slice();
    },

    _pickRandomEventId() {
      this._refillEventPoolIfNeeded();
      if (!this._eventPool.length) return null;

      const idx = Math.floor(Math.random() * this._eventPool.length);
      const id = this._eventPool[idx];

      // retire du pool
      this._eventPool.splice(idx, 1);

      // push seen (ordre réel des tirages)
      this._seenEvents.push(id);

      return id || null;
    },

    async _triggerRandomEvent() {
      if (this._eventShowing) return false;
      if (!window.VRState.isAlive()) return false;

      const id = this._pickRandomEventId();
      if (!id) return false;

      const ev = this._eventById.get(id) || null;
      const texts = this.eventsTexts?.[id] || null;

      // applique effets (jauges + vcoins + jetons)
      try {
        const deltaMap = ev?.effects || ev?.gaugeDelta || ev?.deltas || {};
        if (deltaMap && typeof deltaMap === "object") {
          window.VRState.applyDeltas(deltaMap);
        }

        // vcoins (best-effort)
        const dv =
          (typeof ev?.vcoins === "number") ? ev.vcoins :
          (typeof ev?.vcoinsDelta === "number") ? ev.vcoinsDelta :
          0;

        if (dv) {
          this._uiCoins += dv;
          try { window.VUserData?.addVcoins?.(dv); } catch (_) {}
        }

        // ✅ FIX(3): jetons strict
        const dj =
          (typeof ev?.jetons === "number") ? ev.jetons :
          (typeof ev?.jetonsDelta === "number") ? ev.jetonsDelta :
          0;

        if (dj) {
          if (dj > 0) {
            const ok = await (window.VUserData?.addJetons?.(dj) || Promise.resolve(false));
            if (ok !== false) this._uiTokens += dj;
          } else {
            const cost = Math.abs(dj);
            const ok = await (window.VUserData?.spendJetons?.(cost) || Promise.resolve(false));
            if (ok) this._uiTokens -= cost;
          }
        }
      } catch (e) {
        console.error("[VREngine] event apply error:", e);
      }

      // ✅ recoller à la DB après event (safe)
      await this._refreshUIBalancesSoft();

      // UI update
      const kingName = document.getElementById("meta-king-name")?.textContent || getDynastyName(this.reignIndex - 1);
      window.VRUIBinding.updateGauges();
      window.VRUIBinding.updateMeta(kingName, window.VRState.getReignYears(), this._uiCoins, this._uiTokens);

      // show overlay
      this._eventShowing = true;
      this._saveRunSoft();

      const t = (k, fb) => {
        try {
          const out = window.VRI18n?.t?.(k);
          if (out && out !== k) return out;
        } catch (_) {}
        return fb;
      };

      const title = texts?.title || t("event.title", "Événement");
      const body = texts?.body || texts?.text || "";

      try {
        await window.VREventOverlay?.showEvent?.(title, body);
      } catch (_) {}

      this._eventShowing = false;

      // si l’event a tué le joueur -> handleDeath
      if (!window.VRState.isAlive()) {
        await this._handleDeath();
        return true;
      }

      // sinon next card
      this._saveRunSoft();
      this._nextCard();
      return true;
    },

    applyChoice(cardLogic, choiceId) {
      if (!cardLogic || !cardLogic.choices || !cardLogic.choices[choiceId]) return;

      this._pushHistorySnapshot(cardLogic);

      const choiceData = cardLogic.choices[choiceId];
      const deltas = choiceData.gaugeDelta || {};
      window.VRState.applyDeltas(deltas);

      this.coinsStreak += 1;

      this._uiCoins += BASE_COINS_PER_CARD;
      try { window.VUserData?.addVcoins?.(BASE_COINS_PER_CARD); } catch (_) {}

      window.VRGame?.onCardResolved?.();
      window.VRState.tickYear();

      const years = window.VRState.getReignYears();
      const kingName = getDynastyName(this.reignIndex - 1);
      window.VRUIBinding.updateMeta(kingName, years, this._uiCoins, this._uiTokens);
      window.VRUIBinding.updateGauges();

      try { window.VRUIBinding?._consumePeekDecision?.(); } catch (_) {}
      try { window.VRGame?.maybeShowInterstitial?.(); } catch (_) {}

      // ✅ SAVE après résolution du choix
      this._saveRunSoft();

      // petit refresh soft pour recoller à la DB
      this._refreshUIBalancesSoft().then(() => {
        window.VRUIBinding.updateMeta(
          kingName,
          window.VRState.getReignYears(),
          this._uiCoins,
          this._uiTokens
        );
      });

      // si mort -> ending direct
      if (!window.VRState.isAlive()) {
        this._handleDeath();
        return;
      }

      // ✅ EVENTS: toutes les 3 cartes jouées (par univers) -> tirage
      const shouldEvent = this._maybeRollEventAfterCardResolved();
      if (shouldEvent) {
        this._triggerRandomEvent();
        return;
      }

      // sinon carte normale
      this._nextCard();
    },

    _nextCard_internalOnly() {
      this._nextCard();
    },

    // ✅ FIX(2): bind death UI once + delegation stable
    _bindDeathUIOnce() {
      if (this._deathUiBound) return;
      this._deathUiBound = true;

      const revivePopup = document.getElementById("vr-revive-popup");

      // Escape: ferme seulement si popup ouvert
      document.addEventListener("keydown", (e) => {
        if (e.key !== "Escape") return;
        const rp = document.getElementById("vr-revive-popup");
        if (!rp) return;
        const open = (rp.style && rp.style.display === "flex") || rp.getAttribute("aria-hidden") === "false";
        if (open) {
          try { rp.__close?.(); } catch (_) {}
        }
      });

      if (revivePopup) {
        revivePopup.addEventListener("click", async (e) => {
          // click sur fond => close
          if (e.target === revivePopup) {
            try { revivePopup.__close?.(); } catch (_) {}
            return;
          }

          const btn = e.target?.closest?.("[data-revive-action]");
          if (!btn) return;

          const action = btn.getAttribute("data-revive-action");
          if (!action) return;

          try { await (revivePopup.__act?.(action, btn) || Promise.resolve()); } catch (_) {}
        });
      }
    },

    async _handleDeath() {
      const lastDeath = window.VRState.getLastDeath();
      await window.VRGame?.onRunEnded?.();
      await window.VREndings.showEnding(this.universeConfig, lastDeath);

      this._saveRunSoft();

      const btn = document.getElementById("ending-restart-btn");
      const reviveBtn = document.getElementById("ending-revive-btn");
      const returnBtn = document.getElementById("ending-return-btn");
      const revivePopup = document.getElementById("vr-revive-popup");

      const t = (key, fallback) => {
        try {
          const out = window.VRI18n?.t?.(key);
          if (out && out !== key) return out;
        } catch (_) {}
        return fallback || key;
      };

      const showDialog = (el, focusEl) => {
        if (!el) return;
        try { el.removeAttribute("inert"); } catch (_) {}
        el.setAttribute("aria-hidden", "false");
        el.style.display = "flex";
        try { focusEl?.focus?.({ preventScroll: true }); } catch (_) {}
      };

      const hideDialog = (el, focusBackEl) => {
        if (!el) return;
        const active = document.activeElement;
        if (active && el.contains(active)) {
          try { active.blur(); } catch (_) {}
          try { focusBackEl?.focus?.({ preventScroll: true }); } catch (_) {}
        }
        try { el.setAttribute("inert", ""); } catch (_) {}
        el.setAttribute("aria-hidden", "true");
        el.style.display = "none";
      };

      const openRevivePopup = () => {
        if (!revivePopup) return;
        const first = revivePopup?.querySelector?.("[data-revive-action]");
        showDialog(revivePopup, first || reviveBtn || btn);
      };

      const closeRevivePopup = () => hideDialog(revivePopup, reviveBtn || btn);

      // ✅ Recommencer (clear save + reset jauges + nouvelle partie début)
      if (btn) {
        btn.onclick = () => {
          window.VREndings.hideEnding();
          this.restartRun();
        };
      }

      // ✅ Retour (clear save + index.html)
      if (returnBtn) {
        returnBtn.onclick = () => {
          try { this._clearRunSave(); } catch (_) {}
          try { window.location.href = "index.html"; } catch (_) {}
        };
      }

      // ✅ Revivre (popup Jeton OU Pub)
      if (reviveBtn) {
        reviveBtn.disabled = !!this._reviveUsed;
        reviveBtn.onclick = () => {
          if (this._reviveUsed) return;
          openRevivePopup();
        };
      }

      // ✅ FIX(2): bind once (delegation)
      this._bindDeathUIOnce();

      // update handlers (pas d’empilement)
      if (revivePopup) {
        revivePopup.__close = closeRevivePopup;

        revivePopup.__act = async (action, clickedEl) => {
          if (action === "cancel") {
            closeRevivePopup();
            return;
          }

          // lock (sur le bouton cliqué)
          try { if (clickedEl) clickedEl.disabled = true; } catch (_) {}
          try { if (reviveBtn) reviveBtn.disabled = true; } catch (_) {}

          try {
            let ok = false;

            if (action === "token") {
              ok = await (window.VUserData?.spendJetons?.(1) || Promise.resolve(false));
              if (!ok) {
                try { window.showToast?.(t("token.toast.no_tokens", "Tu n'as pas de jeton")); } catch (_) {}
              }
            }

            if (action === "ad") {
              ok = await (window.VRAds?.showRewardedAd?.({ placement: "revive" }) || Promise.resolve(false));
              if (!ok) {
                try { window.showToast?.(t("revive.toast.ad_fail", "Pub indisponible")); } catch (_) {}
              }
            }

            if (ok) {
              closeRevivePopup();
              window.VREndings.hideEnding();

              const did = this.reviveSecondChance();
              if (!did) this.restartRun();
            } else {
              try { if (reviveBtn) reviveBtn.disabled = !!this._reviveUsed; } catch (_) {}
            }
          } catch (e) {
            console.error("[VREngine] revive popup error:", e);
            try { if (reviveBtn) reviveBtn.disabled = !!this._reviveUsed; } catch (_) {}
          } finally {
            try { if (clickedEl) clickedEl.disabled = false; } catch (_) {}
          }
        };
      }

      this.coinsStreak = 0;
      this._saveRunSoft();
    }
  };

  window.VREngine = VREngine;
})();


// -------------------------------------------------------
// Token UI + Actions (inchangé)
// -------------------------------------------------------
(function () {
  "use strict";

  function t(key, fallback) {
    try {
      const out = window.VRI18n?.t?.(key);
      if (out && out !== key) return out;
    } catch (_) {}
    return fallback || key;
  }

  function toast(msg) {
    try {
      if (typeof window.showToast === "function") return window.showToast(msg);
    } catch (_) {}

    try {
      const id = "__vr_toast";
      let el = document.getElementById(id);
      if (!el) {
        el = document.createElement("div");
        el.id = id;
        el.style.cssText =
          "position:fixed;left:50%;bottom:12%;transform:translateX(-50%);" +
          "background:rgba(0,0,0,.85);color:#fff;padding:10px 14px;border-radius:12px;" +
          "font:14px/1.35 system-ui,-apple-system,Segoe UI,Roboto,sans-serif;" +
          "z-index:2147483647;max-width:84vw;text-align:center";
        document.body.appendChild(el);
      }
      el.textContent = String(msg || "");
      el.style.opacity = "1";
      clearTimeout(el.__t1); clearTimeout(el.__t2);
      el.__t1 = setTimeout(() => { el.style.transition = "opacity .25s"; el.style.opacity = "0"; }, 2200);
      el.__t2 = setTimeout(() => { try { el.remove(); } catch (_) {} }, 2600);
    } catch (_) {}
  }

  const VRTokenUI = {
    selectMode: false,

    init() {
      const btnJeton = document.getElementById("btn-jeton");
      const popup = document.getElementById("vr-token-popup");
      const overlay = document.getElementById("vr-token-gauge-overlay");
      const cancelGaugeBtn = document.getElementById("btn-cancel-gauge-select");
      const gaugesRow = document.getElementById("vr-gauges-row");

      if (!btnJeton || !popup) return;

      try {
        const vg = document.getElementById("view-game");
        if (vg) {
          if (popup && vg.contains(popup)) document.body.appendChild(popup);
          if (overlay && vg.contains(overlay)) document.body.appendChild(overlay);
        }
      } catch (_) {}

      const _showDialog = (el, focusEl) => {
        if (!el) return;
        try { el.removeAttribute("inert"); } catch (_) {}
        el.setAttribute("aria-hidden", "false");
        el.style.display = "flex";
        try { focusEl?.focus?.({ preventScroll: true }); } catch (_) {}
      };

      const _hideDialog = (el, focusBackEl) => {
        if (!el) return;
        const active = document.activeElement;
        if (active && el.contains(active)) {
          try { active.blur(); } catch (_) {}
          try { focusBackEl?.focus?.({ preventScroll: true }); } catch (_) {}
        }
        try { el.setAttribute("inert", ""); } catch (_) {}
        el.setAttribute("aria-hidden", "true");
        el.style.display = "none";
      };

      const openPopup = () => {
        if (this.selectMode) return;
        const first = popup?.querySelector?.("[data-token-action]");
        _showDialog(popup, first || btnJeton);
      };

      const closePopup = () => {
        _hideDialog(popup, btnJeton);
      };

      const openGaugeOverlay = () => {
        if (!overlay) return;
        _showDialog(overlay, cancelGaugeBtn || btnJeton);
      };

      const closeGaugeOverlay = () => {
        if (!overlay) return;
        _hideDialog(overlay, btnJeton);
      };

      const startSelectGauge50 = () => {
        this.selectMode = true;
        document.body.classList.add("vr-token-select-mode");
        closePopup();
        openGaugeOverlay();
        toast(t("token.toast.select_gauge", "Choisis une jauge à remettre à 50%"));
      };

      const stopSelectGauge50 = () => {
        this.selectMode = false;
        document.body.classList.remove("vr-token-select-mode");
        closeGaugeOverlay();
      };

      btnJeton.addEventListener("click", () => openPopup());

      popup.addEventListener("click", (e) => {
        if (e.target === popup) closePopup();
      });

      document.addEventListener("keydown", (e) => {
        if (e.key === "Escape") {
          if (this.selectMode) stopSelectGauge50();
          closePopup();
        }
      });

      // inject peek button if missing
      try {
        const host = (popup.querySelector("[data-token-action]")?.parentElement) || popup;

        if (host && !host.querySelector('[data-token-action="peek15"]')) {
          const btn = document.createElement("button");
          btn.type = "button";
          btn.setAttribute("data-token-action", "peek15");
          btn.style.cssText =
            "display:flex;flex-direction:column;align-items:flex-start;gap:4px;width:100%;" +
            "padding:12px 14px;border-radius:14px;border:1px solid rgba(255,255,255,.14);" +
            "background:rgba(255,255,255,.08);color:inherit;font:inherit;text-align:left;cursor:pointer;";

          const title = document.createElement("div");
          title.style.cssText = "font-weight:700;font-size:14px;line-height:1.2;";
          title.textContent = t("token.popup.peek.title", "Voir les effets (15)");

          const desc = document.createElement("div");
          desc.style.cssText = "opacity:.85;font-size:12.5px;line-height:1.25;";
          desc.textContent = t(
            "token.popup.peek.text",
            "Pendant 15 choix, les jauges concernées clignotent et affichent un aperçu."
          );

          btn.appendChild(title);
          btn.appendChild(desc);

          const before =
            host.querySelector('[data-token-action="gauge50"]') ||
            host.querySelector('[data-token-action="back3"]') ||
            host.querySelector('[data-token-action="close"]');

          if (before && before.parentNode === host) host.insertBefore(btn, before);
          else host.appendChild(btn);
        }
      } catch (_) {}

      popup.querySelectorAll("[data-token-action]").forEach((el) => {
        el.addEventListener("click", async () => {
          const action = el.getAttribute("data-token-action");
          if (!action) return;

          if (action === "close") { closePopup(); return; }

          if (action === "adtoken" || action === "ad_token") {
            closePopup();

            const ok = await (window.VRAds?.showRewardedAd?.({ placement: "token" }) || Promise.resolve(false));
            if (ok) {
              try { await window.VUserData?.addJetons?.(1); } catch (_) {}

              try {
                const me = await window.VRProfile?.getMe?.(0);
                if (me) {
                  window.VREngine._uiCoins = window.VRProfile._n(me.vcoins);
                  window.VREngine._uiTokens = window.VRProfile._n(me.jetons);
                }
              } catch (_) {}

              const kingName = document.getElementById("meta-king-name")?.textContent || "—";
              window.VRUIBinding?.updateMeta?.(
                kingName,
                window.VRState?.getReignYears?.() || 0,
                window.VREngine?._uiCoins || 0,
                window.VREngine?._uiTokens || 0
              );

              toast(t("token.toast.reward_ok", "+1 jeton ajouté"));
            } else {
              toast(t("token.toast.reward_fail", "Pub indisponible"));
            }
            return;
          }

          if (action === "peek15") {
            const okSpend = await window.VUserData?.spendJetons?.(1);
            if (!okSpend) {
              toast(t("token.toast.no_tokens", "Tu n'as pas de jeton"));
              closePopup();
              return;
            }

            closePopup();
            try { window.VRUIBinding?.enablePeek?.(15); } catch (_) {}
            toast(t("token.toast.peek_on", "Peek activé : 15 prochaines décisions"));
            return;
          }

          if (action === "gauge50") {
            const me = await window.VRProfile?.getMe?.(0);
            if (window.VRProfile._n(me?.jetons) <= 0) {
              toast(t("token.toast.no_tokens", "Tu n'as pas de jeton"));
              closePopup();
              return;
            }
            startSelectGauge50();
            return;
          }

          if (action === "back3") {
            const okSpend = await window.VUserData?.spendJetons?.(1);
            if (!okSpend) {
              toast(t("token.toast.no_tokens", "Tu n'as pas de jeton"));
              closePopup();
              return;
            }

            closePopup();

            const ok = window.VREngine?.undoChoices?.(3);
            if (!ok) {
              try { await window.VUserData?.addJetons?.(1); } catch (_) {}
              toast(t("token.toast.undo_fail", "Impossible de revenir en arrière"));
            } else {
              toast(t("token.toast.undo_done", "Retour -3 effectué"));
            }

            try {
              const me2 = await window.VRProfile?.getMe?.(0);
              if (me2) {
                window.VREngine._uiCoins = window.VRProfile._n(me2.vcoins);
                window.VREngine._uiTokens = window.VRProfile._n(me2.jetons);
              }
            } catch (_) {}

            const kingName = document.getElementById("meta-king-name")?.textContent || "—";
            window.VRUIBinding?.updateMeta?.(
              kingName,
              window.VRState?.getReignYears?.() || 0,
              window.VREngine?._uiCoins || 0,
              window.VREngine?._uiTokens || 0
            );

            return;
          }

          if (action === "back_menu") {
            closePopup();
            try { window.location.href = "index.html"; } catch (_) {}
            return;
          }
        });
      });

      if (cancelGaugeBtn) cancelGaugeBtn.addEventListener("click", () => stopSelectGauge50());
      if (overlay) overlay.addEventListener("click", (e) => { if (e.target === overlay) stopSelectGauge50(); });

      if (gaugesRow) {
        gaugesRow.addEventListener("click", async (e) => {
          if (!this.selectMode) return;

          const gaugeEl = e.target?.closest?.(".vr-gauge");
          if (!gaugeEl) return;

          const gaugeId = gaugeEl.dataset.gaugeId;
          if (!gaugeId) return;

          const spent = await window.VUserData?.spendJetons?.(1);
          if (!spent) {
            toast(t("token.toast.no_tokens", "Tu n'as pas de jeton"));
            stopSelectGauge50();
            return;
          }

          window.VRState?.setGaugeValue?.(gaugeId, 50);
          window.VRUIBinding?.updateGauges?.();

          try { window.VREngine?._saveRunSoft?.(); } catch (_) {}

          try {
            const me = await window.VRProfile?.getMe?.(0);
            if (me) {
              window.VREngine._uiCoins = window.VRProfile._n(me.vcoins);
              window.VREngine._uiTokens = window.VRProfile._n(me.jetons);
            }
          } catch (_) {}

          const kingName = document.getElementById("meta-king-name")?.textContent || "—";
          window.VRUIBinding?.updateMeta?.(
            kingName,
            window.VRState?.getReignYears?.() || 0,
            window.VREngine?._uiCoins || 0,
            window.VREngine?._uiTokens || 0
          );

          toast(t("token.toast.gauge_set_50", "Jauge remise à 50%"));
          stopSelectGauge50();
        });
      }
    }
  };

  window.VRTokenUI = VRTokenUI;
})();


// VRealms - VCoins UI + Actions (inchangé)
(function () {
  "use strict";

  function t(key, fallback) {
    try {
      const out = window.VRI18n?.t?.(key);
      if (out && out !== key) return out;
    } catch (_) {}
    return fallback || key;
  }

  function toast(msg) {
    try {
      if (typeof window.showToast === "function") return window.showToast(msg);
    } catch (_) {}

    try {
      const id = "__vr_toast";
      let el = document.getElementById(id);
      if (!el) {
        el = document.createElement("div");
        el.id = id;
        el.style.cssText =
          "position:fixed;left:50%;bottom:12%;transform:translateX(-50%);" +
          "background:rgba(0,0,0,.85);color:#fff;padding:10px 14px;border-radius:12px;" +
          "font:14px/1.35 system-ui,-apple-system,Segoe UI,Roboto,sans-serif;" +
          "z-index:2147483647;max-width:84vw;text-align:center";
        document.body.appendChild(el);
      }
      el.textContent = String(msg || "");
      el.style.opacity = "1";
      clearTimeout(el.__t1); clearTimeout(el.__t2);
      el.__t1 = setTimeout(() => { el.style.transition = "opacity .25s"; el.style.opacity = "0"; }, 2200);
      el.__t2 = setTimeout(() => { try { el.remove(); } catch (_) {} }, 2600);
    } catch (_) {}
  }

  const VRCoinUI = {
    init() {
      const btnVcoins = document.getElementById("btn-vcoins");
      const popup = document.getElementById("vr-coins-popup");
      if (!btnVcoins || !popup) return;

      try {
        const vg = document.getElementById("view-game");
        if (vg && popup && vg.contains(popup)) document.body.appendChild(popup);
      } catch (_) {}

      const _showDialog = (el, focusEl) => {
        if (!el) return;
        try { el.removeAttribute("inert"); } catch (_) {}
        el.setAttribute("aria-hidden", "false");
        el.style.display = "flex";
        try { focusEl?.focus?.({ preventScroll: true }); } catch (_) {}
      };

      const _hideDialog = (el, focusBackEl) => {
        if (!el) return;
        const active = document.activeElement;
        if (active && el.contains(active)) {
          try { active.blur(); } catch (_) {}
          try { focusBackEl?.focus?.({ preventScroll: true }); } catch (_) {}
        }
        try { el.setAttribute("inert", ""); } catch (_) {}
        el.setAttribute("aria-hidden", "true");
        el.style.display = "none";
      };

      const openPopup = () => {
        const first = popup?.querySelector?.("[data-coins-action]");
        _showDialog(popup, first || btnVcoins);
      };

      const closePopup = () => {
        _hideDialog(popup, btnVcoins);
      };

      btnVcoins.addEventListener("click", () => openPopup());

      popup.addEventListener("click", (e) => {
        if (e.target === popup) closePopup();
      });

      document.addEventListener("keydown", (e) => {
        if (e.key === "Escape") closePopup();
      });

      popup.querySelectorAll("[data-coins-action]").forEach((el) => {
        el.addEventListener("click", async () => {
          const action = el.getAttribute("data-coins-action");
          if (!action) return;

          if (action === "close") { closePopup(); return; }

          if (action === "open_shop") {
            closePopup();
            try { window.location.href = "shop.html"; } catch (_) {}
            return;
          }

          if (action === "adcoins") {
            closePopup();

            const ok = await (window.VRAds?.showRewardedAd?.({ placement: "coins_500" }) || Promise.resolve(false));
            if (ok) {
              try { await window.VUserData?.addVcoins?.(500); } catch (_) {}

              try {
                const me = await window.VRProfile?.getMe?.(0);
                if (me) {
                  window.VREngine._uiCoins = window.VRProfile._n(me.vcoins);
                  window.VREngine._uiTokens = window.VRProfile._n(me.jetons);
                }
              } catch (_) {}

              const kingName = document.getElementById("meta-king-name")?.textContent || "—";
              window.VRUIBinding?.updateMeta?.(
                kingName,
                window.VRState?.getReignYears?.() || 0,
                window.VREngine?._uiCoins || 0,
                window.VREngine?._uiTokens || 0
              );

              toast(t("coins.toast.reward_ok", "+500 pièces ajoutées"));
            } else {
              toast(t("coins.toast.reward_fail", "Pub indisponible"));
            }
            return;
          }
        });
      });
    }
  };

  window.VRCoinUI = VRCoinUI;
})();


// VRealms - game.js (VRGame + anti-retour navigateur)
window.VRGame = {
  currentUniverse: null,

  // session run
  session: { reignLength: 0 },

  async onUniverseSelected(universeId) {
    this.currentUniverse = universeId;
    this.session.reignLength = 0;

    this.applyUniverseBackground(universeId);

    // ✅ 100% Supabase lang (fallback local)
    let lang = "fr";
    try {
      const me = await window.VRProfile?.getMe?.(0);
      lang = (me?.lang || "fr").toString();
    } catch (_) {
      lang = localStorage.getItem("vrealms_lang") || "fr";
    }

    try { await window.VREngine.init(universeId, lang); }
    catch (e) { console.error("[VRGame] Erreur init moteur:", e); }
  },

  applyUniverseBackground(universeId) {
    const viewGame = document.getElementById("view-game");
    if (!viewGame) return;

    if (universeId) document.body.dataset.universe = universeId;
    else delete document.body.dataset.universe;

    Array.from(viewGame.classList).forEach((cls) => {
      if (cls.startsWith("vr-bg-")) viewGame.classList.remove(cls);
    });

    if (universeId) viewGame.classList.add(`vr-bg-${universeId}`);
  },

  // interstitiel global via ads.js (persistant) : 1 toutes les X actions
  async maybeShowInterstitial() {
    try {
      await (window.VRAds?.markAction?.() || Promise.resolve(0));
    } catch (e) {
      console.warn("[VRGame] interstitial skipped:", e);
    }
  },

  async maybeUnlockRunBadges() {
    try {
      if (!window.VRState?.isAlive?.()) return;

      const reign = Number(this.session?.reignLength || 0);
      const universeId = String(this.currentUniverse || localStorage.getItem("vrealms_universe") || "").trim();
      if (!universeId) return;

      const all = window.VUProfileBadges?.getAll?.() || { map: {} };
      const row = (all.map && all.map[universeId]) ? all.map[universeId] : {};

      if (reign >= VR_BADGE_BRONZE_CHOICES && !row.bronze) {
        await window.VUProfileBadges?.setBadge?.(universeId, "bronze", true);
      }
      if (reign >= VR_BADGE_SILVER_CHOICES && !row.silver) {
        await window.VUProfileBadges?.setBadge?.(universeId, "silver", true);
      }
      if (reign >= VR_BADGE_GOLD_CHOICES && !row.gold) {
        await window.VUProfileBadges?.setBadge?.(universeId, "gold", true);
      }
    } catch (e) {
      console.warn("[VRGame] badge unlock skipped:", e);
    }
  },

  onCardResolved() {
    this.session.reignLength += 1;
    Promise.resolve().then(() => this.maybeUnlockRunBadges());
  },

  // ✅ maintenant async + 100% DB pour stats
  async onRunEnded() {
    try {
      const reign = Number(this.session.reignLength || 0);

      const sb = window.sb;
      if (sb && typeof sb.rpc === "function") {
        let did = false;
        try {
          const r = await sb.rpc("secure_finish_run", { p_reign_length: reign });
          if (!r?.error) did = true;
        } catch (_) {}

        if (!did) {
          try { await sb.rpc("secure_inc_total_runs", { p_delta: 1 }); } catch (_) {}
          try { await sb.rpc("secure_set_best_reign_length", { p_value: reign }); } catch (_) {}
        }
      }

      try {
        const me = await window.VRProfile?.getMe?.(0);
        if (me) {
          window.VREngine._uiCoins = window.VRProfile._n(me.vcoins);
          window.VREngine._uiTokens = window.VRProfile._n(me.jetons);
        }
      } catch (_) {}

      this.session.reignLength = 0;
    } catch (e) {
      console.error("[VRGame] onRunEnded error:", e);
      this.session.reignLength = 0;
    }
  }
};


// ===== Init page jeu seule (game.html) =====
(function () {
  function setupNavigationGuards() {
    try {
      history.pushState({ vr_game: 1 }, "", location.href);
      history.pushState({ vr_game: 2 }, "", location.href);

      window.addEventListener("popstate", () => {
        try { history.pushState({ vr_game: 3 }, "", location.href); } catch (_) {}
      });
    } catch (_) {}

    const EDGE = 18;
    const blockEdge = (e) => {
      try {
        const x = (e.touches && e.touches[0]) ? e.touches[0].clientX : e.clientX;
        if (typeof x === "number" && x <= EDGE) {
          e.preventDefault();
          e.stopPropagation();
        }
      } catch (_) {}
    };

    try { document.addEventListener("touchstart", blockEdge, { passive: false, capture: true }); } catch (_) {}
    try { document.addEventListener("pointerdown", blockEdge, { passive: false, capture: true }); } catch (_) {}

    try { document.documentElement.style.overscrollBehavior = "none"; } catch (_) {}
    try { document.body.style.overscrollBehavior = "none"; } catch (_) {}
  }

  function setupSaveGuards() {
    const flush = () => {
      try { window.VREngine?._saveRunSoft?.(); } catch (_) {}
    };

    try {
      document.addEventListener("visibilitychange", () => {
        if (document.visibilityState === "hidden") flush();
      });
    } catch (_) {}

    try { window.addEventListener("pagehide", () => flush()); } catch (_) {}
    try { window.addEventListener("beforeunload", () => flush()); } catch (_) {}
  }

  async function initApp() {
    setupNavigationGuards();
    setupSaveGuards();

    try {
      if (window.VRI18n && typeof window.VRI18n.initI18n === "function") {
        await window.VRI18n.initI18n();
      }
    } catch (e) {
      console.error("[VRealms] Erreur init i18n:", e);
    }

    try {
      if (window.VUserData && typeof window.VUserData.init === "function") {
        await window.VUserData.init();
      }
    } catch (_) {}

    const hasGameView = !!document.getElementById("view-game");
    if (!hasGameView) return;

    try { window.VRTokenUI?.init?.(); } catch (_) {}
    try { window.VRCoinUI?.init?.(); } catch (_) {}

    const universeId = localStorage.getItem("vrealms_universe") || "hell_king";
    if (window.VRGame && typeof window.VRGame.onUniverseSelected === "function") {
      window.VRGame.onUniverseSelected(universeId);
    }
  }

  document.addEventListener("DOMContentLoaded", initApp);
})();