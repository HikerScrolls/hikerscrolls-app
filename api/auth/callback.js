// GET /api/auth/callback — handles Supabase email confirmation + OAuth redirects
// Supabase sends users here after email verification, password reset, or OAuth login.
// Exchanges the auth code, then redirects to the app.

const { createClient } = require("@supabase/supabase-js");

module.exports = async function handler(req, res) {
  const url = new URL(req.url, `https://${req.headers.host}`);
  const code = url.searchParams.get("code");
  const next = url.searchParams.get("next") || "/demo/";

  if (!code) {
    // No code — check for error params from Supabase
    const error = url.searchParams.get("error_description") || url.searchParams.get("error");
    if (error) {
      return res.redirect(302, next + "?auth_error=" + encodeURIComponent(error));
    }
    return res.redirect(302, next);
  }

  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseServiceKey = process.env.SUPABASE_SECRET_KEY;

  if (!supabaseUrl || !supabaseServiceKey) {
    return res.redirect(302, next + "?auth_error=" + encodeURIComponent("Server auth not configured"));
  }

  try {
    const supabase = createClient(supabaseUrl, supabaseServiceKey, {
      auth: { autoRefreshToken: false, persistSession: false }
    });

    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (error) throw error;

    // Determine redirect param based on callback type
    return res.redirect(302, next + "?auth_confirmed=true");
  } catch (err) {
    return res.redirect(302, next + "?auth_error=" + encodeURIComponent(err.message || "Auth callback failed"));
  }
};
