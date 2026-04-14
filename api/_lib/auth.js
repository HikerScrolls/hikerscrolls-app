// Server-side JWT verification utility
// IMPORTANT: Uses SUPABASE_SECRET_KEY — never expose this key to the client.

const { createClient } = require("@supabase/supabase-js");

let _supabase = null;

function getSupabaseAdmin() {
  if (_supabase) return _supabase;
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SECRET_KEY;
  if (!url || !key) return null;
  _supabase = createClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false }
  });
  return _supabase;
}

/**
 * Extract and verify the auth token from a request.
 * Returns the user object if valid, or null.
 */
async function verifyAuth(req) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith("Bearer ")) return null;

  const token = authHeader.slice(7);
  const supabase = getSupabaseAdmin();
  if (!supabase) return null;

  try {
    const { data, error } = await supabase.auth.getUser(token);
    if (error || !data.user) return null;
    return data.user;
  } catch {
    return null;
  }
}

module.exports = { verifyAuth, getSupabaseAdmin };
