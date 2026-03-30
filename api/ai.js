// HikerScrolls — Unified AI Proxy (Vercel Serverless Function)
// POST /api/ai → routes to Gemini, Claude, Qwen, OpenAI, Kimi, Deepseek, MiniMax, Seedream, Tavily

// ── Rate limiter (in-memory, resets on cold start) ──
const rateLimits = new Map();
const RATE_LIMIT = parseInt(process.env.RATE_LIMIT_PER_MIN || "10", 10);

function checkRateLimit(ip) {
  const now = Date.now();
  const windowMs = 60_000;
  let entry = rateLimits.get(ip);
  if (!entry || now - entry.start > windowMs) {
    entry = { start: now, count: 0 };
    rateLimits.set(ip, entry);
  }
  entry.count++;
  return entry.count <= RATE_LIMIT;
}

// ── Environment key mapping ──
const ENV_KEYS = {
  gemini: "GEMINI_API_KEY",
  claude: "ANTHROPIC_API_KEY",
  qwen: "QWEN_API_KEY",
  openai: "OPENAI_API_KEY",
  kimi: "KIMI_API_KEY",
  deepseek: "DEEPSEEK_API_KEY",
  minimax: "MINIMAX_API_KEY",
  seedream: "SEEDREAM_API_KEY",
  tavily: "TAVILY_API_KEY",
};

function getServerKey(provider) {
  const envName = ENV_KEYS[provider];
  return envName ? process.env[envName] || "" : "";
}

// ── Provider adapters (server-side) ──

async function fetchRetry(url, opts, maxRetries = 3) {
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const r = await fetch(url, opts);
    if (r.ok) return r;
    if ((r.status === 503 || r.status === 429 || r.status === 529) && attempt < maxRetries) {
      await new Promise(res => setTimeout(res, (attempt + 1) * 3000 + Math.random() * 2000));
      continue;
    }
    let errBody = "";
    try { errBody = await r.text(); } catch {}
    throw new Error(`API ${r.status}: ${errBody.slice(0, 300)}`);
  }
}

const PROVIDERS = {
  gemini: {
    async text(key, model, sys, user, temp) {
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`;
      const body = { contents: [{ role: "user", parts: [{ text: user }] }], generationConfig: { temperature: temp || 0.7, maxOutputTokens: 8192 } };
      if (sys) body.systemInstruction = { parts: [{ text: sys }] };
      const r = await fetchRetry(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const d = await r.json();
      return { text: d.candidates?.[0]?.content?.parts?.[0]?.text || "" };
    },
    async vision(key, model, sys, parts, temp) {
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`;
      const body = { contents: [{ role: "user", parts }], generationConfig: { temperature: temp || 0.7, maxOutputTokens: 8192 } };
      if (sys) body.systemInstruction = { parts: [{ text: sys }] };
      const r = await fetchRetry(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const d = await r.json();
      return { text: d.candidates?.[0]?.content?.parts?.[0]?.text || "" };
    },
    async image(key, model, parts) {
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`;
      const body = { contents: [{ role: "user", parts }], generationConfig: { temperature: 1.0, responseModalities: ["TEXT", "IMAGE"] } };
      const r = await fetchRetry(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const d = await r.json();
      for (const p of (d.candidates?.[0]?.content?.parts || [])) {
        if (p.inlineData?.mimeType?.startsWith("image/")) return { base64: p.inlineData.data, mime: p.inlineData.mimeType };
      }
      return null;
    }
  },

  claude: {
    async text(key, model, sys, user, temp) {
      const body = { model: model || "claude-sonnet-4-6", max_tokens: 8192, temperature: temp || 0.7, messages: [{ role: "user", content: user }] };
      if (sys) body.system = sys;
      const r = await fetchRetry("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-api-key": key, "anthropic-version": "2023-06-01" },
        body: JSON.stringify(body)
      });
      const d = await r.json();
      return { text: d.content?.[0]?.text || "" };
    }
  },

  qwen: {
    async text(key, model, sys, user, temp) {
      const msgs = [];
      if (sys) msgs.push({ role: "system", content: sys });
      msgs.push({ role: "user", content: user });
      const r = await fetchRetry("https://dashscope-intl.aliyuncs.com/compatible-mode/v1/chat/completions", {
        method: "POST", headers: { "Content-Type": "application/json", "Authorization": "Bearer " + key }, body: JSON.stringify({ model, messages: msgs, temperature: temp || 0.7, max_tokens: 8192 })
      });
      const d = await r.json();
      return { text: d.choices?.[0]?.message?.content || "" };
    },
    async vision(key, model, sys, parts, temp) {
      const content = [];
      for (const p of parts) {
        if (p.text) content.push({ type: "text", text: p.text });
        else if (p.inlineData) content.push({ type: "image_url", image_url: { url: "data:" + p.inlineData.mimeType + ";base64," + p.inlineData.data } });
      }
      const msgs = [];
      if (sys) msgs.push({ role: "system", content: sys });
      msgs.push({ role: "user", content });
      const r = await fetchRetry("https://dashscope-intl.aliyuncs.com/compatible-mode/v1/chat/completions", {
        method: "POST", headers: { "Content-Type": "application/json", "Authorization": "Bearer " + key }, body: JSON.stringify({ model, messages: msgs, temperature: temp || 0.7, max_tokens: 8192 })
      });
      const d = await r.json();
      return { text: d.choices?.[0]?.message?.content || "" };
    },
    async image(key, model, parts) {
      const prompt = parts.filter(p => p.text).map(p => p.text).join("\n");
      const r = await fetchRetry("https://dashscope-intl.aliyuncs.com/api/v1/services/aigc/multimodal-generation/generation", {
        method: "POST", headers: { "Content-Type": "application/json", "Authorization": "Bearer " + key },
        body: JSON.stringify({ model, input: { prompt, size: "1024*1024", n: 1, prompt_extend: true, watermark: false } })
      });
      const d = await r.json();
      const imgUrl = d.output?.results?.[0]?.url;
      if (!imgUrl) return null;
      const imgR = await fetch(imgUrl);
      const buf = Buffer.from(await imgR.arrayBuffer());
      return { base64: buf.toString("base64"), mime: "image/png" };
    }
  },

  openai: {
    async text(key, model, sys, user, temp) {
      const msgs = [];
      if (sys) msgs.push({ role: "system", content: sys });
      msgs.push({ role: "user", content: user });
      const r = await fetchRetry("https://api.openai.com/v1/chat/completions", {
        method: "POST", headers: { "Content-Type": "application/json", "Authorization": "Bearer " + key }, body: JSON.stringify({ model, messages: msgs, temperature: temp || 0.7, max_tokens: 8192 })
      });
      const d = await r.json();
      return { text: d.choices?.[0]?.message?.content || "" };
    },
    async vision(key, model, sys, parts, temp) {
      const content = [];
      for (const p of parts) {
        if (p.text) content.push({ type: "text", text: p.text });
        else if (p.inlineData) content.push({ type: "image_url", image_url: { url: "data:" + p.inlineData.mimeType + ";base64," + p.inlineData.data } });
      }
      const msgs = [];
      if (sys) msgs.push({ role: "system", content: sys });
      msgs.push({ role: "user", content });
      const r = await fetchRetry("https://api.openai.com/v1/chat/completions", {
        method: "POST", headers: { "Content-Type": "application/json", "Authorization": "Bearer " + key }, body: JSON.stringify({ model, messages: msgs, temperature: temp || 0.7, max_tokens: 8192 })
      });
      const d = await r.json();
      return { text: d.choices?.[0]?.message?.content || "" };
    },
    async image(key, model, parts) {
      const prompt = parts.filter(p => p.text).map(p => p.text).join("\n");
      const r = await fetchRetry("https://api.openai.com/v1/images/generations", {
        method: "POST", headers: { "Content-Type": "application/json", "Authorization": "Bearer " + key },
        body: JSON.stringify({ model, prompt, n: 1, size: "1024x1024", response_format: "b64_json" })
      });
      const d = await r.json();
      const b64 = d.data?.[0]?.b64_json;
      return b64 ? { base64: b64, mime: "image/png" } : null;
    }
  },

  seedream: {
    async image(key, model, parts) {
      const prompt = parts.filter(p => p.text).map(p => p.text).join("\n");
      const r = await fetchRetry("https://api.apiyi.com/v1/images/generations", {
        method: "POST", headers: { "Content-Type": "application/json", "Authorization": "Bearer " + key },
        body: JSON.stringify({ model, prompt, size: "2K", response_format: "b64_json", n: 1, watermark: false, guidance_scale: 7.5 })
      });
      const d = await r.json();
      const b64 = d.data?.[0]?.b64_json;
      if (b64) return { base64: b64, mime: "image/png" };
      const url = d.data?.[0]?.url;
      if (url) {
        const ir = await fetch(url);
        const buf = Buffer.from(await ir.arrayBuffer());
        return { base64: buf.toString("base64"), mime: "image/png" };
      }
      return null;
    }
  },

  kimi: {
    async text(key, model, sys, user, temp) {
      const msgs = [];
      if (sys) msgs.push({ role: "system", content: sys });
      msgs.push({ role: "user", content: user });
      const r = await fetchRetry("https://api.moonshot.cn/v1/chat/completions", {
        method: "POST", headers: { "Content-Type": "application/json", "Authorization": "Bearer " + key }, body: JSON.stringify({ model, messages: msgs, temperature: temp || 0.7 })
      });
      const d = await r.json();
      return { text: d.choices?.[0]?.message?.content || "" };
    },
    async vision(key, model, sys, parts, temp) {
      const content = [];
      for (const p of parts) {
        if (p.text) content.push({ type: "text", text: p.text });
        else if (p.inlineData) content.push({ type: "image_url", image_url: { url: "data:" + p.inlineData.mimeType + ";base64," + p.inlineData.data } });
      }
      const msgs = [];
      if (sys) msgs.push({ role: "system", content: sys });
      msgs.push({ role: "user", content });
      const r = await fetchRetry("https://api.moonshot.cn/v1/chat/completions", {
        method: "POST", headers: { "Content-Type": "application/json", "Authorization": "Bearer " + key }, body: JSON.stringify({ model, messages: msgs, temperature: temp || 0.7 })
      });
      const d = await r.json();
      return { text: d.choices?.[0]?.message?.content || "" };
    }
  },

  deepseek: {
    async text(key, model, sys, user, temp) {
      const msgs = [];
      if (sys) msgs.push({ role: "system", content: sys });
      msgs.push({ role: "user", content: user });
      const r = await fetchRetry("https://api.deepseek.com/chat/completions", {
        method: "POST", headers: { "Content-Type": "application/json", "Authorization": "Bearer " + key }, body: JSON.stringify({ model, messages: msgs, temperature: temp || 0.7, max_tokens: 8192 })
      });
      const d = await r.json();
      return { text: d.choices?.[0]?.message?.content || "" };
    }
  },

  minimax: {
    async text(key, model, sys, user, temp) {
      const msgs = [];
      if (sys) msgs.push({ role: "system", content: sys });
      msgs.push({ role: "user", content: user });
      const r = await fetchRetry("https://api.minimax.chat/v1/text/chatcompletion_v2", {
        method: "POST", headers: { "Content-Type": "application/json", "Authorization": "Bearer " + key }, body: JSON.stringify({ model, messages: msgs, temperature: temp || 0.7, max_tokens: 8192 })
      });
      const d = await r.json();
      return { text: d.choices?.[0]?.message?.content || "" };
    },
    async vision(key, model, sys, parts, temp) {
      const content = [];
      for (const p of parts) {
        if (p.text) content.push({ type: "text", text: p.text });
        else if (p.inlineData) content.push({ type: "image_url", image_url: { url: "data:" + p.inlineData.mimeType + ";base64," + p.inlineData.data } });
      }
      const msgs = [];
      if (sys) msgs.push({ role: "system", content: sys });
      msgs.push({ role: "user", content });
      const r = await fetchRetry("https://api.minimax.chat/v1/text/chatcompletion_v2", {
        method: "POST", headers: { "Content-Type": "application/json", "Authorization": "Bearer " + key }, body: JSON.stringify({ model, messages: msgs, temperature: temp || 0.7 })
      });
      const d = await r.json();
      return { text: d.choices?.[0]?.message?.content || "" };
    },
    async image(key, model, parts) {
      const prompt = parts.filter(p => p.text).map(p => p.text).join("\n");
      const r = await fetchRetry("https://api.minimax.io/v1/image_generation", {
        method: "POST", headers: { "Content-Type": "application/json", "Authorization": "Bearer " + key },
        body: JSON.stringify({ model: model || "image-01", prompt, aspect_ratio: "1:1", response_format: "b64_json", n: 1, prompt_optimizer: true })
      });
      const d = await r.json();
      if (d.base_resp?.status_code && d.base_resp.status_code !== 0) throw new Error("MiniMax: " + (d.base_resp.status_msg || d.base_resp.status_code));
      const url = d.data?.image_urls?.[0] || d.data?.image_url || d.data?.[0]?.url;
      if (!url) throw new Error("MiniMax: no image in response");
      if (url.startsWith("http")) {
        const ir = await fetch(url);
        const buf = Buffer.from(await ir.arrayBuffer());
        return { base64: buf.toString("base64"), mime: "image/png" };
      }
      return { base64: url, mime: "image/png" };
    }
  },

  tavily: {
    async search(key, _model, query) {
      const r = await fetchRetry("https://api.tavily.com/search", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ api_key: key, query, max_results: 5 })
      });
      const d = await r.json();
      return { results: d.results || [] };
    }
  }
};

// ── Main handler ──
module.exports = async function handler(req, res) {
  // CORS
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  try {
    let { capability, provider, model, userApiKey, payload } = req.body;
    // Default models per provider
    const DEFAULT_MODELS = { gemini: "gemini-2.0-flash", claude: "claude-sonnet-4-6", qwen: "qwen-plus", openai: "gpt-4o-mini", kimi: "moonshot-v1-32k", deepseek: "deepseek-chat", minimax: "abab7" };
    if (!model) model = DEFAULT_MODELS[provider] || "gemini-2.0-flash";

    if (!capability || !provider) {
      return res.status(400).json({ error: "Missing capability or provider" });
    }

    const providerImpl = PROVIDERS[provider];
    if (!providerImpl) {
      return res.status(400).json({ error: `Unknown provider: ${provider}` });
    }

    if (!providerImpl[capability]) {
      return res.status(400).json({ error: `Provider ${provider} does not support ${capability}` });
    }

    // Determine API key: user-provided or server-side
    let apiKey = userApiKey;
    let usingServerKey = false;
    if (!apiKey) {
      apiKey = getServerKey(provider);
      usingServerKey = true;
    }
    if (!apiKey) {
      return res.status(400).json({ error: `No API key available for ${provider}. Provide your own key in settings.` });
    }

    // Rate limit only for server key usage
    if (usingServerKey) {
      const ip = req.headers["x-forwarded-for"]?.split(",")[0]?.trim() || req.socket?.remoteAddress || "unknown";
      if (!checkRateLimit(ip)) {
        return res.status(429).json({ error: "Rate limit exceeded. Please provide your own API key for unlimited access." });
      }
    }

    // Route to provider
    let result;
    if (capability === "text") {
      result = await providerImpl.text(apiKey, model, payload.systemPrompt, payload.userPrompt, payload.temperature);
    } else if (capability === "vision") {
      result = await providerImpl.vision(apiKey, model, payload.systemPrompt, payload.parts, payload.temperature);
    } else if (capability === "image") {
      result = await providerImpl.image(apiKey, model, payload.parts);
    } else if (capability === "search") {
      result = await providerImpl.search(apiKey, model, payload.query);
    } else {
      return res.status(400).json({ error: `Unknown capability: ${capability}` });
    }

    return res.status(200).json({ ok: true, result });
  } catch (err) {
    console.error("[api/ai] Error:", err.message);
    return res.status(500).json({ error: err.message });
  }
};
