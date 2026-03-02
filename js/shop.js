// VRealms — shop.js
// ✅ Boutique actuelle intacte (rewarded + store IAP via purchases.js)
// ✅ Univers sous STORE uniquement
// ✅ 1 seule image visible par catégorie
// ✅ Flèches + swipe
// ✅ 6 univers trouvés dans ton zip

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

  const COSMETICS_DATA = [
    {
      id: "hell_king",
      label: "Enfers",
      categories: {
        background: [
          { id: "hell_bg_01", name: "Trône de braise", price: 250, img: "assets/img/backgrounds/hell_king_bg.webp", kind: "bg" },
          { id: "hell_bg_02", name: "Lave obscure", price: 400, img: "assets/img/backgrounds/hell_king_bg.webp", kind: "bg" },
          { id: "hell_bg_03", name: "Fosse royale", price: 650, img: "assets/img/backgrounds/hell_king_bg.webp", kind: "bg" },
          { id: "hell_bg_04", name: "Nuit infernale", price: 900, img: "assets/img/backgrounds/hell_king_bg.webp", kind: "bg" }
        ],
        message: [
          { id: "hell_msg_01", name: "Carte de cendres", price: 200, img: "assets/img/ui/hell_card.webp", kind: "ui" },
          { id: "hell_msg_02", name: "Carte du trône", price: 350, img: "assets/img/ui/hell_card.webp", kind: "ui" },
          { id: "hell_msg_03", name: "Carte des âmes", price: 550, img: "assets/img/ui/hell_card.webp", kind: "ui" }
        ],
        choice: [
          { id: "hell_choice_01", name: "Choix braise", price: 150, img: "assets/img/ui/hell_choice.webp", kind: "ui" },
          { id: "hell_choice_02", name: "Choix magma", price: 250, img: "assets/img/ui/hell_choice.webp", kind: "ui" },
          { id: "hell_choice_03", name: "Choix souverain", price: 400, img: "assets/img/ui/hell_choice.webp", kind: "ui" }
        ]
      }
    },
    {
      id: "heaven_king",
      label: "Paradis",
      categories: {
        background: [
          { id: "heaven_bg_01", name: "Ciel sacré", price: 250, img: "assets/img/backgrounds/heaven_king_bg.png", kind: "bg" },
          { id: "heaven_bg_02", name: "Aube divine", price: 450, img: "assets/img/backgrounds/heaven_king_bg.png", kind: "bg" },
          { id: "heaven_bg_03", name: "Voile céleste", price: 700, img: "assets/img/backgrounds/heaven_king_bg.png", kind: "bg" }
        ],
        message: [
          { id: "heaven_msg_01", name: "Carte céleste", price: 220, img: "assets/img/ui/heaven_card.webp", kind: "ui" },
          { id: "heaven_msg_02", name: "Carte lumière", price: 360, img: "assets/img/ui/heaven_card.webp", kind: "ui" },
          { id: "heaven_msg_03", name: "Carte ivoire", price: 580, img: "assets/img/ui/heaven_card.webp", kind: "ui" }
        ],
        choice: [
          { id: "heaven_choice_01", name: "Choix pur", price: 160, img: "assets/img/ui/heaven_choice.webp", kind: "ui" },
          { id: "heaven_choice_02", name: "Choix halo", price: 260, img: "assets/img/ui/heaven_choice.webp", kind: "ui" },
          { id: "heaven_choice_03", name: "Choix divin", price: 420, img: "assets/img/ui/heaven_choice.webp", kind: "ui" }
        ]
      }
    },
    {
      id: "western_president",
      label: "Président",
      categories: {
        background: [
          { id: "west_bg_01", name: "Capitole sec", price: 260, img: "assets/img/backgrounds/western_president_bg.webp", kind: "bg" },
          { id: "west_bg_02", name: "Bureau doré", price: 430, img: "assets/img/backgrounds/western_president_bg.webp", kind: "bg" },
          { id: "west_bg_03", name: "Crise d’État", price: 690, img: "assets/img/backgrounds/western_president_bg.webp", kind: "bg" }
        ],
        message: [
          { id: "west_msg_01", name: "Carte officielle", price: 230, img: "assets/img/ui/western_card.webp", kind: "ui" },
          { id: "west_msg_02", name: "Carte exécutive", price: 360, img: "assets/img/ui/western_card.webp", kind: "ui" },
          { id: "west_msg_03", name: "Carte prestige", price: 590, img: "assets/img/ui/western_card.webp", kind: "ui" }
        ],
        choice: [
          { id: "west_choice_01", name: "Choix vote", price: 170, img: "assets/img/ui/western_choice.webp", kind: "ui" },
          { id: "west_choice_02", name: "Choix crise", price: 280, img: "assets/img/ui/western_choice.webp", kind: "ui" },
          { id: "west_choice_03", name: "Choix mandat", price: 440, img: "assets/img/ui/western_choice.webp", kind: "ui" }
        ]
      }
    },
    {
      id: "mega_corp_ceo",
      label: "CEO",
      categories: {
        background: [
          { id: "corp_bg_01", name: "Tour vitrée", price: 260, img: "assets/img/backgrounds/mega_corp_ceo_bg.webp", kind: "bg" },
          { id: "corp_bg_02", name: "Salle du board", price: 430, img: "assets/img/backgrounds/mega_corp_ceo_bg.webp", kind: "bg" },
          { id: "corp_bg_03", name: "Bourse rouge", price: 690, img: "assets/img/backgrounds/mega_corp_ceo_bg.webp", kind: "bg" }
        ],
        message: [
          { id: "corp_msg_01", name: "Carte business", price: 230, img: "assets/img/ui/corp_card.webp", kind: "ui" },
          { id: "corp_msg_02", name: "Carte premium", price: 360, img: "assets/img/ui/corp_card.webp", kind: "ui" },
          { id: "corp_msg_03", name: "Carte investisseurs", price: 590, img: "assets/img/ui/corp_card.webp", kind: "ui" }
        ],
        choice: [
          { id: "corp_choice_01", name: "Choix réunion", price: 170, img: "assets/img/ui/corp_choice.webp", kind: "ui" },
          { id: "corp_choice_02", name: "Choix stratégie", price: 280, img: "assets/img/ui/corp_choice.webp", kind: "ui" },
          { id: "corp_choice_03", name: "Choix marché", price: 440, img: "assets/img/ui/corp_choice.webp", kind: "ui" }
        ]
      }
    },
    {
      id: "new_world_explorer",
      label: "Explorateur",
      categories: {
        background: [
          { id: "explorer_bg_01", name: "Côte inconnue", price: 240, img: "assets/img/backgrounds/new_world_explorer_bg.webp", kind: "bg" },
          { id: "explorer_bg_02", name: "Jungle dense", price: 410, img: "assets/img/backgrounds/new_world_explorer_bg.webp", kind: "bg" },
          { id: "explorer_bg_03", name: "Camp royal", price: 670, img: "assets/img/backgrounds/new_world_explorer_bg.webp", kind: "bg" }
        ],
        message: [
          { id: "explorer_msg_01", name: "Carte de voyage", price: 210, img: "assets/img/ui/western_card.webp", kind: "ui" },
          { id: "explorer_msg_02", name: "Carte du large", price: 340, img: "assets/img/ui/western_card.webp", kind: "ui" },
          { id: "explorer_msg_03", name: "Carte d’expédition", price: 560, img: "assets/img/ui/western_card.webp", kind: "ui" }
        ],
        choice: [
          { id: "explorer_choice_01", name: "Choix de route", price: 160, img: "assets/img/ui/western_choice.webp", kind: "ui" },
          { id: "explorer_choice_02", name: "Choix du camp", price: 270, img: "assets/img/ui/western_choice.webp", kind: "ui" },
          { id: "explorer_choice_03", name: "Choix d’empire", price: 430, img: "assets/img/ui/western_choice.webp", kind: "ui" }
        ]
      }
    },
    {
      id: "vampire_lord",
      label: "Vampire",
      categories: {
        background: [
          { id: "vampire_bg_01", name: "Château noir", price: 260, img: "assets/img/backgrounds/vampire_lord_bg.webp", kind: "bg" },
          { id: "vampire_bg_02", name: "Lune rouge", price: 430, img: "assets/img/backgrounds/vampire_lord_bg.webp", kind: "bg" },
          { id: "vampire_bg_03", name: "Salle du sang", price: 690, img: "assets/img/backgrounds/vampire_lord_bg.webp", kind: "bg" }
        ],
        message: [
          { id: "vampire_msg_01", name: "Carte nocturne", price: 230, img: "assets/img/ui/hell_card.webp", kind: "ui" },
          { id: "vampire_msg_02", name: "Carte écarlate", price: 360, img: "assets/img/ui/hell_card.webp", kind: "ui" },
          { id: "vampire_msg_03", name: "Carte immortelle", price: 590, img: "assets/img/ui/hell_card.webp", kind: "ui" }
        ],
        choice: [
          { id: "vampire_choice_01", name: "Choix morsure", price: 170, img: "assets/img/ui/hell_choice.webp", kind: "ui" },
          { id: "vampire_choice_02", name: "Choix nuit", price: 280, img: "assets/img/ui/hell_choice.webp", kind: "ui" },
          { id: "vampire_choice_03", name: "Choix clan", price: 440, img: "assets/img/ui/hell_choice.webp", kind: "ui" }
        ]
      }
    }
  ];

  const CATEGORY_LABELS = {
    background: "Fond",
    message: "Carte message",
    choice: "Choix"
  };

  function escapeHtml(s) {
    return String(s || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  function renderCosmetics() {
    const root = $("cosmetics-block");
    if (!root) return;

    root.innerHTML = COSMETICS_DATA.map((universe) => {
      return `
        <section class="vr-universe-block" data-universe="${escapeHtml(universe.id)}">
          <h4 class="vr-universe-title">${escapeHtml(universe.label)}</h4>

          ${["background", "message", "choice"].map((category) => {
            const items = universe.categories[category] || [];
            const rowId = `${universe.id}__${category}`;

            return `
              <div class="vr-cos-row" data-carousel-id="${escapeHtml(rowId)}">
                <div class="vr-cos-subtitle">${escapeHtml(CATEGORY_LABELS[category] || category)}</div>

                <div class="vr-cos-carousel">
                  <button class="vr-cos-arrow vr-cos-prev" type="button" aria-label="Précédent">‹</button>

                  <div class="vr-cos-viewport">
                    <div class="vr-cos-track">
                      ${items.map((item, index) => `
                        <div class="vr-cos-slide" data-index="${index}">
                          <div class="vr-cos-card ${item.kind === "ui" ? "is-ui" : ""}" data-item="${escapeHtml(item.id)}">
                            <img src="${escapeHtml(item.img)}" alt="" draggable="false">
                            <div class="vr-cos-overlay">
                              <div class="vr-cos-name">${escapeHtml(item.name)}</div>
                              <div class="vr-cos-bottom">
                                <div class="vr-cos-price">
                                  <img src="assets/img/ui/vcoins.webp" alt="" draggable="false">
                                  <span>${escapeHtml(item.price)}</span>
                                </div>
                                <div class="vr-cos-count">${index + 1} / ${items.length}</div>
                              </div>
                            </div>
                          </div>
                        </div>
                      `).join("")}
                    </div>
                  </div>

                  <button class="vr-cos-arrow vr-cos-next" type="button" aria-label="Suivant">›</button>
                </div>

                <div class="vr-cos-dots">
                  ${items.map((_, index) => `<span class="vr-cos-dot${index === 0 ? " active" : ""}"></span>`).join("")}
                </div>
              </div>
            `;
          }).join("")}
        </section>
      `;
    }).join("");
  }

  function updateCarousel(row, index) {
    if (!row) return;

    const track = row.querySelector(".vr-cos-track");
    const slides = row.querySelectorAll(".vr-cos-slide");
    const dots = row.querySelectorAll(".vr-cos-dot");
    const prev = row.querySelector(".vr-cos-prev");
    const next = row.querySelector(".vr-cos-next");
    const total = slides.length;

    if (!track || !total) return;

    let safeIndex = Number(index) || 0;
    if (safeIndex < 0) safeIndex = 0;
    if (safeIndex > total - 1) safeIndex = total - 1;

    row.dataset.index = String(safeIndex);
    track.style.transform = `translateX(-${safeIndex * 100}%)`;

    dots.forEach((dot, i) => {
      dot.classList.toggle("active", i === safeIndex);
    });

    if (prev) prev.disabled = safeIndex <= 0;
    if (next) next.disabled = safeIndex >= total - 1;
  }

  function wireCarousels() {
    const rows = document.querySelectorAll(".vr-cos-row");

    rows.forEach((row) => {
      updateCarousel(row, 0);

      const prev = row.querySelector(".vr-cos-prev");
      const next = row.querySelector(".vr-cos-next");
      const viewport = row.querySelector(".vr-cos-viewport");

      if (prev) {
        prev.addEventListener("click", () => {
          const current = Number(row.dataset.index || 0);
          updateCarousel(row, current - 1);
        });
      }

      if (next) {
        next.addEventListener("click", () => {
          const current = Number(row.dataset.index || 0);
          updateCarousel(row, current + 1);
        });
      }

      if (viewport) {
        let startX = 0;
        let endX = 0;
        let touching = false;

        viewport.addEventListener("touchstart", (e) => {
          const t = e.changedTouches && e.changedTouches[0];
          if (!t) return;
          touching = true;
          startX = t.clientX;
          endX = t.clientX;
        }, { passive: true });

        viewport.addEventListener("touchmove", (e) => {
          const t = e.changedTouches && e.changedTouches[0];
          if (!t || !touching) return;
          endX = t.clientX;
        }, { passive: true });

        viewport.addEventListener("touchend", () => {
          if (!touching) return;
          const delta = endX - startX;
          const current = Number(row.dataset.index || 0);

          if (Math.abs(delta) > 35) {
            if (delta < 0) updateCarousel(row, current + 1);
            else updateCarousel(row, current - 1);
          }

          touching = false;
          startX = 0;
          endX = 0;
        }, { passive: true });
      }
    });
  }

  async function boot() {
    try { await window.vrWaitBootstrap?.(); } catch (_) {}
    try { await window.VUserData?.init?.(); } catch (_) {}
    try { await window.VUserData?.refresh?.(); } catch (_) {}

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

    setStatus("shop-status", "");
    setStatus("store-status", "");

    renderCosmetics();
    wireCarousels();
  }

  document.addEventListener("DOMContentLoaded", boot);
})();