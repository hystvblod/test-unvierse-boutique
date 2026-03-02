// js/supabaseBootstrap.js
// Initialise window.sb + bootstrapAuthAndProfile() pour VRealms.
// ⚠️ Utilise une ANON KEY (ok côté client). Ne jamais mettre la service_role key ici.

(function () {
  "use strict";

  // --- Config Supabase (ton projet) ---
  const SUPABASE_URL = "https://fbkbqfkgdjkjdfijmggd.supabase.co";
  const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZia2JxZmtnZGpramRmaWptZ2dkIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjU5MTIyOTgsImV4cCI6MjA4MTQ4ODI5OH0.ylBfBeXBWliR13GumJrFazRjP57RyBR3mzaebF7Iy24";

  // --- Client ---
  function getCreateClient() {
    // UMD: window.supabase.createClient
    if (window.supabase && typeof window.supabase.createClient === "function") {
      return window.supabase.createClient;
    }
    // certaines builds exposent window.supabaseJs
    if (window.supabaseJs && typeof window.supabaseJs.createClient === "function") {
      return window.supabaseJs.createClient;
    }
    return null;
  }

  function initClient() {
    if (window.sb) return window.sb;
    const createClient = getCreateClient();
    if (!createClient) return null;

    window.sb = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: false
      }
    });

    return window.sb;
  }

  async function getUid(sb) {
    try {
      const r = await sb.auth.getUser();
      return r?.data?.user?.id || null;
    } catch (_) {
      return null;
    }
  }

  // --- Bootstrap global ---
  window.bootstrapAuthAndProfile = async function bootstrapAuthAndProfile() {
    const sb = initClient();
    if (!sb) return null;

    // 1) Session existante ?
    let uid = await getUid(sb);

    // 2) Sinon, auth anonyme
    if (!uid) {
      try {
        const r = await sb.auth.signInAnonymously();
        uid = r?.data?.user?.id || null;
      } catch (_) {}
    }

    // 3) Profil (créé par trigger) + récupère le row
    try {
      const prof = await sb.rpc("secure_get_me");
      if (!prof?.error && prof?.data) return prof.data;
    } catch (_) {}

    // 4) fallback minimal
    if (uid) return { id: uid };
    return null;
  };

  // Init immédiat (sans bloquer)
  try { initClient(); } catch (_) {}
})();
