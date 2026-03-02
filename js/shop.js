// VRealms — shop.js
// ✅ Boutique uniquement (rewarded + store IAP via purchases.js)
// ✅ Aucun univers/scénario ici

(function () {
  "use strict";

  function isShopPage() {
    try { return document.body && document.body.getAttribute("data-page") === "shop"; }
    catch { return false; }
  }
  if (!isShopPage()) return;

  function $(id) { return document.getElementById(id); }

  function setStatus(id, keyOrText) {
    const el = $(id);
    if (!el) return;
    el.textContent = keyOrText || "";
  }

  async function boot() {
    try { await window.vrWaitBootstrap?.(); } catch (_) {}
    try { await window.VUserData?.init?.(); } catch (_) {}
    try { await window.VUserData?.refresh?.(); } catch (_) {}

    // Nav boutons (pas de texte en dur)
    const back = $("btn-back");
    const profile = $("btn-profile");

    if (back) {
      back.addEventListener("click", () => {
        // retour logique : si tu as une page index, on y va, sinon history
        try {
          const ref = document.referrer || "";
          if (ref && ref.includes(location.origin)) history.back();
          else location.href = "index.html";
        } catch (_) {
          location.href = "index.html";
        }
      });
    }

    if (profile) {
      profile.addEventListener("click", () => {
        location.href = "profile.html";
      });
    }

    // Purchases.js gère :
    // - rewarded buttons (#btn-reward-jeton, #btn-reward-coins)
    // - iap buttons (data-iap="SKU") + label .vr-iap-label
    // Ici on ne duplique pas la logique pour éviter les conflits.

    // Petit clean des statuts au chargement
    setStatus("shop-status", "");
    setStatus("store-status", "");
  }

  document.addEventListener("DOMContentLoaded", boot);
})();