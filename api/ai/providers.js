// GET /api/ai/providers — returns available providers and models for the settings UI

const PROVIDER_META = {
  gemini: { name: "Gemini", capabilities: ["text", "vision", "image"], models: { text: ["gemini-2.0-flash", "gemini-2.0-flash-lite", "gemini-1.5-pro", "gemini-1.5-flash", "gemini-3.1-flash-lite-preview", "gemini-3.1-flash-image-preview", "gemini-3.1-pro-preview", "gemini-3-flash-preview", "gemini-3-pro-image-preview"], vision: ["gemini-2.0-flash", "gemini-2.0-flash-lite", "gemini-1.5-pro", "gemini-1.5-flash", "gemini-3.1-flash-image-preview", "gemini-3.1-flash-lite-preview", "gemini-3.1-pro-preview", "gemini-3-flash-preview"], image: ["gemini-3.1-flash-image-preview", "gemini-3-pro-image-preview"] }, defaults: { text: "gemini-2.0-flash", vision: "gemini-2.0-flash", image: "gemini-3.1-flash-image-preview" } },
  claude: { name: "Claude", capabilities: ["text"], models: { text: ["claude-sonnet-4-6", "claude-opus-4-6", "claude-haiku-4-5-20251001", "claude-sonnet-4-5-20250514", "claude-3-5-sonnet-20241022", "claude-3-5-haiku-20241022"] }, defaults: { text: "claude-sonnet-4-6" } },
  qwen: { name: "Qwen", capabilities: ["text", "vision", "image"], models: { text: ["qwen-plus", "qwen-max", "qwen3.5-plus", "qwen3.5-flash", "qwen3-plus", "qwen3-flash", "qwen-turbo", "qwen-coder-plus", "qwq-plus"], vision: ["qwen3.5-plus", "qwen3.5-flash", "qwen3-vl-plus", "qwen3-vl-max", "qwen-vl-max", "qwen-vl-plus"], image: ["qwen-image-2.0-pro", "qwen-image-2.0-pro-2026-03-03", "qwen-image-2.0", "qwen-image-max", "qwen-image-plus-2026-01-09"] }, defaults: { text: "qwen-plus", vision: "qwen3.5-flash", image: "qwen-image-2.0-pro" } },
  openai: { name: "OpenAI", capabilities: ["text", "vision", "image"], models: { text: ["gpt-4o", "gpt-4o-mini", "gpt-4-turbo", "gpt-4.1", "gpt-4.1-mini", "gpt-4.1-nano", "o4-mini", "o3", "o3-mini"], vision: ["gpt-4o", "gpt-4o-mini", "gpt-4.1", "gpt-4.1-mini"], image: ["gpt-image-1", "dall-e-3", "dall-e-2"] }, defaults: { text: "gpt-4o-mini", vision: "gpt-4o-mini", image: "dall-e-3" } },
  kimi: { name: "Kimi", capabilities: ["text", "vision"], models: { text: ["moonshot-v1-128k", "moonshot-v1-32k", "moonshot-v1-8k", "kimi-latest", "kimi-thinking"], vision: ["kimi-latest", "kimi-vision"] }, defaults: { text: "moonshot-v1-32k", vision: "kimi-latest" } },
  deepseek: { name: "Deepseek", capabilities: ["text"], models: { text: ["deepseek-chat", "deepseek-reasoner", "deepseek-coder"] }, defaults: { text: "deepseek-chat" } },
  minimax: { name: "MiniMax", capabilities: ["text", "vision", "image"], models: { text: ["abab7", "abab6.5s", "abab6.5g", "abab5.5s"], vision: ["abab6.5s", "abab6.5g", "image-01", "hailuo-t2i-01"], image: ["image-01", "hailuo-t2i-01", "hailuo-image"] }, defaults: { text: "abab7", vision: "abab6.5s", image: "hailuo-image" } },
  seedream: { name: "Seedream", capabilities: ["image"], models: { image: ["seedream-5-0-260128", "doubao-seedream-5.0-lite", "doubao-seedream-4-5-251128", "doubao-seedream-4-0-250828", "doubao-seedream-3.0-t2i"] }, defaults: { image: "seedream-5-0-260128" } },
  tavily: { name: "Tavily", capabilities: ["search"], models: { search: ["default"] }, defaults: { search: "default" } }
};

// Which providers have a server-side key configured
function getServerAvailable() {
  const ENV_KEYS = {
    gemini: "GEMINI_API_KEY", claude: "ANTHROPIC_API_KEY", qwen: "QWEN_API_KEY",
    openai: "OPENAI_API_KEY", kimi: "KIMI_API_KEY", deepseek: "DEEPSEEK_API_KEY",
    minimax: "MINIMAX_API_KEY", seedream: "SEEDREAM_API_KEY", tavily: "TAVILY_API_KEY"
  };
  const result = {};
  for (const [id, envKey] of Object.entries(ENV_KEYS)) {
    result[id] = !!process.env[envKey];
  }
  return result;
}

module.exports = async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  if (req.method !== "GET") return res.status(405).json({ error: "GET only" });

  const serverAvailable = getServerAvailable();
  return res.status(200).json({ providers: PROVIDER_META, serverAvailable });
};
