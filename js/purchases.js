/* global CdvPurchase */
(function () {
  "use strict";

  const TAG = "[IAP]";
  const DEBUG = true;

  const log = (...a) => { if (DEBUG) console.log(TAG, ...a); };
  const warn = (...a) => { if (DEBUG) console.warn(TAG, ...a); };

  function $(id) { return document.getElementById(id); }
  function setText(id, txt) { const el = $(id); if (el) el.textContent = String(txt || ""); }

  const CURRENT_UNLOCKABLE_UNIVERSES = [
    "western_president",
    "mega_corp_ceo",
    "new_world_explorer",
    "vampire_lord"
  ];

  function universeSku(universeId) {
    return "vuniverse_universe_" + String(universeId || "").trim().toLowerCase();
  }

  const SKU = {
    vuniverse_no_ads:       { kind: "noads" },
    vuniverse_diamond:      { kind: "diamond" },
    vuniverse_coins_1200:   { kind: "vcoins", amount: 1200 },
    vuniverse_coins_3000:   { kind: "vcoins", amount: 3000 },
    vuniverse_jetons_12:    { kind: "jetons", amount: 12 },
    vuniverse_jetons_30:    { kind: "jetons", amount: 30 }
  };

  CURRENT_UNLOCKABLE_UNIVERSES.forEach((id) => {
    SKU[universeSku(id)] = { kind: "universe", universe: id };
  });

  const PRICES_BY_ID = Object.create(null);
  const IN_FLIGHT_TX = new Set();

  const PENDING_KEY  = "vuniverse_iap_pending_v1";
  const CREDITED_KEY = "vuniverse_iap_credited_v1";
  let STORE_READY = false;

  const readJson  = (k, d=[]) => { try { return JSON.parse(localStorage.getItem(k)||"null") ?? d; } catch { return d; } };
  const writeJson = (k, v)    => { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} };

  function addPending(txId, productId) {
    if (!txId) return;
    const L = readJson(PENDING_KEY, []);
    if (!L.find(x => x.txId === txId)) {
      L.push({ txId, productId, ts: Date.now() });
      writeJson(PENDING_KEY, L.slice(-80));
    }
  }

  function removePending(txId) {
    if (!txId) return;
    writeJson(PENDING_KEY, readJson(PENDING_KEY, []).filter(x => x.txId !== txId));
  }

  function isCredited(txId) {
    if (!txId) return false;
    const L = readJson(CREDITED_KEY, []);
    return L.includes(txId);
  }

  function markCredited(txId) {
    if (!txId) return;
    const L = readJson(CREDITED_KEY, []);
    if (!L.includes(txId)) {
      L.push(txId);
      writeJson(CREDITED_KEY, L.slice(-250));
    }
  }

  function emit(name, detail) {
    try { window.dispatchEvent(new CustomEvent(name, { detail: detail || {} })); } catch (_) {}
  }

  window.VRIAP = window.VRIAP || {};
  window.VRIAP.isAvailable = function () { return !!window.CdvPurchase?.store; };
  window.VRIAP.getPrice = function (productId) { return PRICES_BY_ID[String(productId || "")] || ""; };
  window.VRIAP.order = function (productId) { return safeOrder(productId); };

  async function ensureAuthStrict() {
    try {
      try { await window.vrWaitBootstrap?.(); } catch (_) {}
      const uid = await window.VRRemoteStore?.ensureAuth?.();
      if (uid) return uid;

      const sb = window.sb;
      if (sb?.auth?.getUser) {
        const r = await sb.auth.getUser();
        return r?.data?.user?.id || null;
      }
    } catch (_) {}
    return null;
  }

  function sbReady() {
    return !!(window.sb && window.sb.auth);
  }

  async function refreshNoAdsUI() {
    let noAds = false;
    try {
      noAds = !!window.VUserData?.hasNoAds?.();
      if (!noAds && window.VUserData?.refresh) {
        await window.VUserData.refresh().catch(() => false);
        noAds = !!window.VUserData?.hasNoAds?.();
      }
    } catch (_) {}
    setText("noads-status", noAds ? "✅ No Pub : activé" : "ℹ️ No Pub : désactivé");
    return noAds;
  }

  async function applyUniverseEntitlement(universeId) {
    const res = await window.VUserData?.markUniversePurchased?.(universeId);
    if (!res?.ok) throw new Error(res?.reason || "universe_local_unlock_failed");
    try { await window.VUserData?.refresh?.(); } catch (_) {}
    return true;
  }

  async function applyDiamondEntitlement() {
    const res = await window.VUserData?.activateDiamondPurchase?.();
    if (!res?.ok) throw new Error(res?.reason || "diamond_local_unlock_failed");
    try { await window.VUserData?.refresh?.(); } catch (_) {}
    return true;
  }

  async function applyNoAdsEntitlement() {
    const res = await window.VUserData?.activateNoAdsPurchase?.();
    if (!res?.ok) throw new Error(res?.reason || "noads_local_unlock_failed");
    try { await window.VUserData?.refresh?.(); } catch (_) {}
    return true;
  }

  async function creditByProductClientSide(productId, txId) {
    const cfg = SKU[productId];
    if (!cfg) throw new Error("unknown_sku");

    if (cfg.kind === "vcoins") {
      const uid = await ensureAuthStrict();
      if (!uid) throw new Error("no_session");
      const r = await window.VRRemoteStore?.addVcoins?.(cfg.amount);
      if (r === null || r === undefined) throw new Error("credit_vcoins_failed");
    } else if (cfg.kind === "jetons") {
      const uid = await ensureAuthStrict();
      if (!uid) throw new Error("no_session");
      const r = await window.VRRemoteStore?.addJetons?.(cfg.amount);
      if (r === null || r === undefined) throw new Error("credit_jetons_failed");
    } else if (cfg.kind === "noads") {
      await applyNoAdsEntitlement();
    } else if (cfg.kind === "universe") {
      await applyUniverseEntitlement(cfg.universe);
    } else if (cfg.kind === "diamond") {
      await applyDiamondEntitlement();
    } else {
      throw new Error("unknown_kind");
    }

    if (txId) markCredited(txId);

    emit("vr:iap_credited", {
      productId: String(productId || ""),
      kind: String(cfg.kind || ""),
      amount: Number(cfg.amount || 0),
      universeId: String(cfg.universe || ""),
      txId: String(txId || "")
    });

    return true;
  }

  function parseMaybeJson(x) {
    try {
      if (!x) return null;
      if (typeof x === "object") return x;
      return JSON.parse(x);
    } catch {
      return null;
    }
  }

  function getTxIdFromTx(tx) {
    try {
      const rec = tx?.transaction?.receipt || tx?.receipt;
      const r = typeof rec === "string" ? parseMaybeJson(rec) : rec;

      if (r?.payload) {
        const p = typeof r.payload === "string" ? parseMaybeJson(r.payload) : r.payload;
        if (p?.purchaseToken) return p.purchaseToken;
      }
    } catch (_) {}

    return (
      tx?.purchaseToken ||
      tx?.androidPurchaseToken ||
      tx?.transactionId ||
      tx?.orderId ||
      tx?.id ||
      null
    );
  }

  function getProductIdFromTx(tx) {
    let pid =
      tx?.products?.[0]?.id ||
      tx?.productIds?.[0] ||
      tx?.productId ||
      tx?.sku ||
      tx?.transaction?.productId ||
      tx?.transaction?.lineItems?.[0]?.productId ||
      null;

    if (!pid) {
      const rec = tx?.transaction?.receipt || tx?.receipt;
      const r = typeof rec === "string" ? parseMaybeJson(rec) : rec;
      if (Array.isArray(r?.productIds) && r.productIds[0]) pid = r.productIds[0];
      else if (r?.productId) pid = r.productId;
      else if (r?.payload) {
        const p = typeof r.payload === "string" ? parseMaybeJson(r.payload) : r.payload;
        pid = p?.productId || (Array.isArray(p?.productIds) && p.productIds[0]) || pid;
      }
    }
    return pid || null;
  }

  function updateDisplayedPrices() {
    try {
      document.querySelectorAll("[data-price-for]").forEach((node) => {
        const id = node.getAttribute("data-price-for");
        const price = PRICES_BY_ID[id];
        node.textContent = price ? `(${price})` : "";
      });
    } catch (_) {}
  }

  window.refreshDisplayedPrices = function () {
    updateDisplayedPrices();
  };

  function getStoreApi() {
    const S = window.CdvPurchase?.store;
    return { S };
  }

  async function replayLocalPending() {
    const pendings = readJson(PENDING_KEY, []);
    if (!pendings.length) return;

    for (const it of pendings) {
      if (!it?.txId || !it?.productId) continue;
      if (isCredited(it.txId)) {
        removePending(it.txId);
        continue;
      }
      try {
        await creditByProductClientSide(it.productId, it.txId);
        removePending(it.txId);
        setText("shop-status", "✅ Achat restauré");
      } catch (e) {
        warn("replay pending failed", it.productId, it.txId, e?.message || e);
      }
    }
  }

  async function start() {
    const { S } = getStoreApi();
    if (!S) return;

    if (sbReady()) {
      await ensureAuthStrict();
    }

    try {
      const P = window.CdvPurchase?.ProductType;

      S.register({ id: "vuniverse_no_ads",     type: P.NON_CONSUMABLE, platform: S.Platform.GOOGLE_PLAY });
      S.register({ id: "vuniverse_diamond",    type: P.NON_CONSUMABLE, platform: S.Platform.GOOGLE_PLAY });
      S.register({ id: "vuniverse_coins_1200", type: P.CONSUMABLE,     platform: S.Platform.GOOGLE_PLAY });
      S.register({ id: "vuniverse_coins_3000", type: P.CONSUMABLE,     platform: S.Platform.GOOGLE_PLAY });
      S.register({ id: "vuniverse_jetons_12",  type: P.CONSUMABLE,     platform: S.Platform.GOOGLE_PLAY });
      S.register({ id: "vuniverse_jetons_30",  type: P.CONSUMABLE,     platform: S.Platform.GOOGLE_PLAY });

      CURRENT_UNLOCKABLE_UNIVERSES.forEach((universeId) => {
        S.register({
          id: universeSku(universeId),
          type: P.NON_CONSUMABLE,
          platform: S.Platform.GOOGLE_PLAY
        });
      });
    } catch (e) {
      warn("register failed", e?.message || e);
    }

    S.when()
      .productUpdated((p) => {
        try {
          const id = p?.id;
          const price = p?.pricing?.price || p?.pricing?.formattedPrice || null;
          if (id && price) {
            PRICES_BY_ID[id] = price;
            updateDisplayedPrices();
            emit("vr:iap_price", { productId: String(id), price: String(price) });
          }
        } catch (_) {}
      })
      .approved(async (tx) => {
        const txId = getTxIdFromTx(tx);
        const productId = getProductIdFromTx(tx);

        if (!productId) return;

        if (txId && (IN_FLIGHT_TX.has(txId) || isCredited(txId))) {
          try { await tx.finish(); } catch (_) {}
          return;
        }

        if (txId) {
          IN_FLIGHT_TX.add(txId);
          addPending(txId, productId);
        }

        try {
          setText("shop-status", "…");
          await creditByProductClientSide(productId, txId);
          removePending(txId);
          setText("shop-status", "✅ Achat crédité");
        } catch (e) {
          setText("shop-status", "❌ Achat non crédité");
          warn("credit failed", productId, txId, e?.message || e);

          emit("vr:iap_credit_failed", {
            productId: String(productId || ""),
            txId: String(txId || ""),
            error: String(e?.message || e || "credit_failed")
          });

          if (txId) IN_FLIGHT_TX.delete(txId);
          return;
        }

        try { await tx.finish(); } catch (e) { warn("finish failed", e?.message || e); }
        if (txId) IN_FLIGHT_TX.delete(txId);

        try { window.VRAds?.refreshNoAds && (await window.VRAds.refreshNoAds()); } catch (_) {}
        try { await refreshNoAdsUI(); } catch (_) {}
      });

    try { await replayLocalPending(); } catch (_) {}

    try {
      await S.initialize([S.Platform.GOOGLE_PLAY]);
      await S.update();
      STORE_READY = true;
    } catch (e) {
      warn("store init/update failed", e?.message || e);
    }

    try { updateDisplayedPrices(); } catch (_) {}
    try { await refreshNoAdsUI(); } catch (_) {}
  }

  function wireTopNav() {
    const bProfile = $("btn-profile");
    const bSettings = $("btn-settings");
    const bShop = $("btn-shop");

    if (bProfile) bProfile.addEventListener("click", () => { window.location.href = "profile.html"; });
    if (bSettings) bSettings.addEventListener("click", () => { window.location.href = "settings.html"; });
    if (bShop) bShop.addEventListener("click", () => { window.location.href = "shop.html"; });
  }

  async function doRewarded(placement) {
    try {
      if (!window.VRAds || typeof window.VRAds.showRewardedAd !== "function") {
        setText("shop-status", "Ad system not ready");
        return false;
      }
      setText("shop-status", "…");
      const ok = await window.VRAds.showRewardedAd({ placement: String(placement || "shop") });
      if (!ok) { setText("shop-status", "❌ Pub non validée"); return false; }

      setText("shop-status", "✅ Récompense validée");
      return true;
    } catch (_) {
      setText("shop-status", "❌ Erreur rewarded");
      return false;
    }
  }

  async function safeOrder(productId) {
    const { S } = getStoreApi();
    if (!S) {
      setText("shop-status", "⚠️ IAP indisponible (web).");
      emit("vr:iap_unavailable", { productId: String(productId || "") });
      return;
    }

    if (sbReady()) {
      await ensureAuthStrict();
    }

    if (!STORE_READY) {
      try { await S.update(); STORE_READY = true; } catch (_) {}
    }

    const p = S.get ? S.get(productId, S.Platform.GOOGLE_PLAY) : (S.products?.byId?.[productId]);
    if (!p) {
      setText("shop-status", "⚠️ Produit introuvable: " + productId);
      emit("vr:iap_order_failed", { productId: String(productId || ""), error: "product_not_found" });
      return;
    }

    const offer = p.getOffer && p.getOffer();
    let err = null;
    if (offer?.order) err = await offer.order();
    else if (p?.order) err = await p.order();

    if (err?.isError) {
      warn("order err", err.code, err.message);
      emit("vr:iap_order_failed", {
        productId: String(productId || ""),
        error: String(err.message || err.code || "order_error")
      });
    }
  }

  function wireShopButtons() {
    const bRJ = $("btn-reward-jeton");
    const bRC = $("btn-reward-coins");
    const bNoAds = $("btn-buy-noads");
    const bDiamond = $("btn-buy-diamond");

    const bC1200 = $("btn-buy-coins-1200");
    const bC3000 = $("btn-buy-coins-3000");

    const bJ12 = $("btn-buy-jetons-12");
    const bJ30 = $("btn-buy-jetons-30");

    if (bRJ) bRJ.addEventListener("click", () => doRewarded("shop_jeton"));
    if (bRC) bRC.addEventListener("click", () => doRewarded("shop_coins"));

    if (bNoAds) bNoAds.addEventListener("click", () => safeOrder("vuniverse_no_ads"));
    if (bDiamond) bDiamond.addEventListener("click", () => safeOrder("vuniverse_diamond"));

    if (bC1200) bC1200.addEventListener("click", () => safeOrder("vuniverse_coins_1200"));
    if (bC3000) bC3000.addEventListener("click", () => safeOrder("vuniverse_coins_3000"));

    if (bJ12) bJ12.addEventListener("click", () => safeOrder("vuniverse_jetons_12"));
    if (bJ30) bJ30.addEventListener("click", () => safeOrder("vuniverse_jetons_30"));
  }

  window.restorePurchases = async function () {
    try {
      await replayLocalPending();
      const { S } = getStoreApi();
      if (S?.update) await S.update();
    } catch (_) {}
  };

  window.safeOrder = safeOrder;
  window.buyProduct = safeOrder;

  function startWhenReady() {
    try { wireTopNav(); wireShopButtons(); } catch (_) {}

    const fire = () => { start().catch((e) => warn("start failed", e?.message || e)); };

    const already =
      (window.cordova && (
        (window.cordova.deviceready && window.cordova.deviceready.fired) ||
        (window.channel && window.channel.onCordovaReady && window.channel.onCordovaReady.fired)
      )) ||
      window._cordovaReady === true;

    if (already) fire();
    else {
      document.addEventListener("deviceready", function () {
        window._cordovaReady = true;
        fire();
      }, { once: true });

      setTimeout(() => { if (window._cordovaReady) fire(); }, 1200);
      setTimeout(() => { try { updateDisplayedPrices(); } catch (_) {} }, 1500);
    }

    refreshNoAdsUI().catch(() => {});
  }

  startWhenReady();
})();