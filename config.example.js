// -----------------------------------------------------------------------------
// OPTIONAL baked-in configuration.
//
// You do NOT have to use this file — the app has a Setup screen where you can
// paste your Supabase URL and anon key, and it remembers them in the browser.
//
// Use this file only if you want the keys shipped with the site so every staff
// member is connected automatically without touching the Setup screen:
//   1. Copy this file to  config.js   (same folder).
//   2. Fill in the two values below (from Supabase -> Project Settings -> API).
//   3. Commit config.js and deploy.  index.html already loads config.js.
//
// The anon key is a *public* key and is safe to expose in a static site.
// -----------------------------------------------------------------------------
window.SPANEL_CONFIG = {
  SUPABASE_URL: "https://YOUR-PROJECT-ref.supabase.co",
  SUPABASE_ANON_KEY: "YOUR-PUBLIC-ANON-KEY",
};
