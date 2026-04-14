// GET /api/config — returns public-safe config (map tile keys, etc.)

module.exports = async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  if (req.method !== "GET") return res.status(405).json({ error: "GET only" });

  return res.status(200).json({
    stadiaApiKey: process.env.STADIA_API_KEY || "",
    supabaseUrl: process.env.SUPABASE_URL || "",
    supabasePublishableKey: process.env.SUPABASE_PUBLISHABLE_KEY || ""
  });
};
