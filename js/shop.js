// VRealms — shop.js
// ✅ Boutique uniquement (rewarded + store IAP via purchases.js)
// ✅ Ajout placeholders cosmetics (sans toucher à purchases.js)

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

  function wireCosmeticsPlaceholders() {
    const root = document.getElementById("cosmetics-block");
    if (!root) return;

    // ✅ Placeholder: click = affiche dans store-status (sans casser IAP)
    root.addEventListener("click", (e) => {
      const card = e.target && e.target.closest ? e.target.closest(".vr-cos-card") : null;
      if (!card) return;

      const universeBlock = card.closest(".vr-universe-block");
      const row = card.closest(".vr-cos-row");

      const universe = universeBlock ? (universeBlock.getAttribute("data-universe") || "") : "";
      const category = row ? (row.getAttribute("data-category") || "") : "";
      const item = card.getAttribute("data-item") || "";

      // ✅ on affiche un statut simple (tu pourras remplacer par achat + equip plus tard)
      // Pas de texte en dur critique: on laisse juste un message neutre.
      setStatus("store-status", ""); // reset
      setStatus("shop-status", "");  // reset
      setStatus("store-status", universe + " / " + category + " / " + item);
    }, { passive: true });
  }

  async function boot() {
    try { await window.vrWaitBootstrap?.(); } catch (_) {}
    try { await window.VUserData?.init?.(); } catch (_) {}
    try { await window.VUserData?.refresh?.(); } catch (_) {}

    // Nav boutons
    const back = $("btn-back");
    const profile = $("btn-profile");

    if (back) {
      back.addEventListener("click", () => {
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

    setStatus("shop-status", "");
    setStatus("store-status", "");

    // ✅ cosmetics placeholders
    wireCosmeticsPlaceholders();
  }

  document.addEventListener("DOMContentLoaded", boot);
})();