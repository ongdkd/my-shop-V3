// ═══════════════════════════════════════════════════════════
// CONFIG — fill these in before using the app
// ═══════════════════════════════════════════════════════════

// Project URL — Supabase Dashboard → Settings → General (or the "Connect" button)
// e.g. 'https://abcdefghijklm.supabase.co'
window.SUPABASE_URL = 'https://hbboruauvxywsklffmhn.supabase.co';

// API key — Settings → API Keys:
//  * new projects: the "publishable" key (sb_publishable_...)
//  * old projects: the legacy "anon" key (eyJhbGci...)
// NEVER put the sb_secret_... / service_role key here!
window.SUPABASE_ANON_KEY = 'sb_publishable_UF-JWpzyM3EWLRzR-2R12g_fxfBV10m';

// Username login: typing "admin" signs in as "admin" + this domain.
// Create the matching user in Supabase Auth, e.g. admin@orderhub.local
window.ADMIN_USERNAME_DOMAIN = '@orderhub.local';

// Cloudinary unsigned upload (same values as the old Apps Script version)
window.CLOUDINARY_CLOUD_NAME    = 'dk5f1v2ro';
window.CLOUDINARY_UPLOAD_PRESET = 'gas_cover_img';
