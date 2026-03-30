// Souvenir Studio — Standalone App
// Uses SouvenirCore from souvenir-core.js + /api/ai proxy

// ── Settings ──
const SVN_SETTINGS_KEY = "hikerscrolls_svn_settings";
let _svnProviderMeta = null;

function getSvnSettings() {
  try { return JSON.parse(localStorage.getItem(SVN_SETTINGS_KEY) || "{}"); } catch { return {}; }
}
function saveSvnSettings(s) { localStorage.setItem(SVN_SETTINGS_KEY, JSON.stringify(s)); }

// ── callAI (uses saved settings for provider/model/key) ──
async function callAI(capability, payload, overrideProvider, overrideModel) {
  const settings = getSvnSettings();
  const routing = settings.aiRouting || {};
  const provider = overrideProvider || routing[capability]?.provider || "gemini";
  const model = overrideModel || routing[capability]?.model || undefined; // server has defaults
  const userApiKey = settings.apiKeys?.[provider] || undefined;
  const resp = await fetch("/api/ai", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ capability, provider, model, userApiKey, payload })
  });
  if (!resp.ok) {
    const err = await resp.json().catch(() => ({ error: "API error " + resp.status }));
    throw new Error(err.error || "API error " + resp.status);
  }
  return (await resp.json()).result;
}

async function fetchProviderMeta() {
  if (_svnProviderMeta) return _svnProviderMeta;
  try { const r = await fetch("/api/ai/providers"); if (r.ok) _svnProviderMeta = await r.json(); } catch {}
  return _svnProviderMeta;
}

async function showSettingsModal() {
  const existing = document.querySelector(".svn-settings-overlay");
  if (existing) existing.remove();

  const meta = await fetchProviderMeta();
  const providers = meta?.providers || {};
  const serverAvailable = meta?.serverAvailable || {};
  const settings = getSvnSettings();
  const routing = settings.aiRouting || {};
  const apiKeys = settings.apiKeys || {};

  const overlay = document.createElement("div");
  overlay.className = "svn-settings-overlay";
  overlay.addEventListener("click", (e) => { if (e.target === overlay) overlay.remove(); });

  const modal = document.createElement("div");
  modal.className = "svn-settings-modal";

  const title = document.createElement("div");
  title.className = "svn-settings-title";
  title.textContent = "AI Settings";
  modal.appendChild(title);

  const desc = document.createElement("div");
  desc.className = "svn-settings-desc";
  desc.textContent = "Choose AI providers and models for each capability. Leave API keys blank to use server defaults.";
  modal.appendChild(desc);

  const capabilities = [
    { id: "text", label: "Text Analysis", desc: "Trip context, cultural research, design system" },
    { id: "vision", label: "Vision Analysis", desc: "Photo scoring, element extraction" },
    { id: "image", label: "Image Generation", desc: "Souvenir design rendering" }
  ];

  const selects = {};
  for (const cap of capabilities) {
    const section = document.createElement("div");
    section.className = "svn-settings-section";
    const lbl = document.createElement("div");
    lbl.className = "svn-settings-section-label"; lbl.textContent = cap.label;
    section.appendChild(lbl);
    const hint = document.createElement("div");
    hint.className = "svn-settings-section-hint"; hint.textContent = cap.desc;
    section.appendChild(hint);

    const row = document.createElement("div");
    row.className = "svn-settings-row";
    const provSel = document.createElement("select");
    const currentProv = routing[cap.id]?.provider || "gemini";
    for (const [id, p] of Object.entries(providers)) {
      if (!p.capabilities.includes(cap.id)) continue;
      const opt = document.createElement("option");
      opt.value = id; opt.textContent = p.name + (serverAvailable[id] ? " \u2713" : "");
      if (id === currentProv) opt.selected = true;
      provSel.appendChild(opt);
    }
    row.appendChild(provSel);

    const modelSel = document.createElement("select");
    const fillModels = (provId) => {
      modelSel.innerHTML = "";
      const models = providers[provId]?.models?.[cap.id] || [];
      const currentModel = routing[cap.id]?.model;
      for (const m of models) {
        const opt = document.createElement("option");
        opt.value = m; opt.textContent = m;
        if (m === currentModel) opt.selected = true;
        modelSel.appendChild(opt);
      }
    };
    fillModels(currentProv);
    provSel.addEventListener("change", () => fillModels(provSel.value));
    row.appendChild(modelSel);

    section.appendChild(row);
    modal.appendChild(section);
    selects[cap.id] = { prov: provSel, model: modelSel };
  }

  // Divider
  modal.appendChild(Object.assign(document.createElement("hr"), { style: "border:none;border-top:1px solid #eee;margin:16px 0;" }));

  // API Keys
  const keysTitle = document.createElement("div");
  keysTitle.className = "svn-settings-keys-title"; keysTitle.textContent = "API Keys (Optional)";
  modal.appendChild(keysTitle);
  const keysHint = document.createElement("div");
  keysHint.className = "svn-settings-keys-hint"; keysHint.textContent = "Leave blank to use server defaults (rate limited).";
  modal.appendChild(keysHint);

  const keyInputs = {};
  const keyProviders = [
    { id: "gemini", name: "Gemini", ph: "AIza..." },
    { id: "claude", name: "Claude", ph: "sk-ant-..." },
    { id: "openai", name: "OpenAI", ph: "sk-..." },
    { id: "qwen", name: "Qwen", ph: "sk-..." },
  ];
  for (const kp of keyProviders) {
    const row = document.createElement("div");
    row.className = "svn-settings-key-row";
    const label = document.createElement("div");
    label.className = "svn-settings-key-label"; label.textContent = kp.name;
    row.appendChild(label);
    const input = document.createElement("input");
    input.className = "svn-settings-key-input";
    input.type = "password"; input.value = apiKeys[kp.id] || ""; input.placeholder = kp.ph;
    row.appendChild(input);
    keyInputs[kp.id] = input;
    modal.appendChild(row);
  }

  // Save
  const saveBtn = document.createElement("button");
  saveBtn.className = "svn-settings-save"; saveBtn.textContent = "Save Settings";
  saveBtn.onclick = () => {
    const newRouting = {};
    for (const cap of capabilities) {
      newRouting[cap.id] = { provider: selects[cap.id].prov.value, model: selects[cap.id].model.value };
    }
    const newKeys = {};
    for (const kp of keyProviders) {
      const v = keyInputs[kp.id].value.trim();
      if (v) newKeys[kp.id] = v;
    }
    saveSvnSettings({ aiRouting: newRouting, apiKeys: newKeys });
    overlay.remove();
  };
  modal.appendChild(saveBtn);

  overlay.appendChild(modal);
  document.body.appendChild(overlay);
}

// ── GPX Parser (inline) ──
function _toRad(d) { return d * Math.PI / 180; }
function _haversineKm(lat1, lng1, lat2, lng2) {
  const dLat = _toRad(lat2 - lat1), dLng = _toRad(lng2 - lng1);
  const a = Math.sin(dLat/2)**2 + Math.cos(_toRad(lat1)) * Math.cos(_toRad(lat2)) * Math.sin(dLng/2)**2;
  return 6371 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
}
function parseGpx(xmlString) {
  const doc = new DOMParser().parseFromString(xmlString, "application/xml");
  if (doc.querySelector("parsererror")) throw new Error("Invalid GPX file");
  const name = doc.querySelector("metadata > name")?.textContent?.trim() || doc.querySelector("trk > name")?.textContent?.trim() || "Unnamed Trail";
  const trackPoints = [];
  doc.querySelectorAll("trkpt").forEach(el => {
    const lat = parseFloat(el.getAttribute("lat")||"0"), lng = parseFloat(el.getAttribute("lon")||"0");
    if (lat || lng) trackPoints.push({ lat, lng, ele: parseFloat(el.querySelector("ele")?.textContent) || undefined });
  });
  if (!trackPoints.length) doc.querySelectorAll("rtept").forEach(el => {
    const lat = parseFloat(el.getAttribute("lat")||"0"), lng = parseFloat(el.getAttribute("lon")||"0");
    if (lat || lng) trackPoints.push({ lat, lng, ele: parseFloat(el.querySelector("ele")?.textContent) || undefined });
  });
  if (!trackPoints.length) throw new Error("GPX file contains no track data");
  let totalDistanceKm = 0, elevationGainM = 0, elevationLossM = 0;
  for (let i = 1; i < trackPoints.length; i++) {
    totalDistanceKm += _haversineKm(trackPoints[i-1].lat, trackPoints[i-1].lng, trackPoints[i].lat, trackPoints[i].lng);
    if (trackPoints[i-1].ele != null && trackPoints[i].ele != null) {
      const diff = trackPoints[i].ele - trackPoints[i-1].ele;
      if (diff > 0) elevationGainM += diff; else elevationLossM += Math.abs(diff);
    }
  }
  return { name, trackPoints, totalDistanceKm: Math.round(totalDistanceKm * 100) / 100, elevationGainM: Math.round(elevationGainM), elevationLossM: Math.round(elevationLossM) };
}

// ── State ──
let photos = [];
let gpxData = null;
let selectedProducts = new Set(["postcard", "magnet", "sticker"]);
let variantsCount = 2;
let results = [];
let generating = false;

const PRODUCTS = [
  { key: "postcard", label: "Postcard", dims: "148\u00d7100mm",
    svg: '<svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="2" y="4" width="20" height="16" rx="2"/><line x1="2" y1="10" x2="22" y2="10"/><line x1="12" y1="10" x2="12" y2="20"/></svg>' },
  { key: "magnet", label: "Magnet", dims: "70\u00d750mm",
    svg: '<svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M6 2v6a6 6 0 0 0 12 0V2"/><rect x="3" y="2" width="6" height="4" rx="1"/><rect x="15" y="2" width="6" height="4" rx="1"/></svg>' },
  { key: "sticker", label: "Sticker", dims: "60\u00d760mm",
    svg: '<svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="12" cy="12" r="10"/><path d="M8 14s1.5 2 4 2 4-2 4-2"/></svg>' },
  { key: "pin", label: "Enamel Pin", dims: "38mm",
    svg: '<svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 1 1 16 0Z"/><circle cx="12" cy="10" r="3"/></svg>' },
  { key: "stamp", label: "Stamp", dims: "30\u00d740mm",
    svg: '<svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="3" y="3" width="18" height="18" rx="2"/><rect x="6" y="6" width="12" height="12" rx="1"/></svg>' }
];

const CHECK_SVG = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>';

// ── Init ──
document.addEventListener("DOMContentLoaded", () => {
  setupUpload();
  setupGpxUpload();
  renderProductGrid();
  setupVariantSelector();
  setupGenerate();
  setupDownloadAll();
  setupNewBtn();
  const settingsBtn = document.getElementById("settings-btn");
  if (settingsBtn) settingsBtn.addEventListener("click", showSettingsModal);
});

// ── Step Indicator ──
function setStep(n) {
  for (let i = 1; i <= 3; i++) {
    const el = document.getElementById("step-ind-" + i);
    if (!el) continue;
    el.classList.remove("active", "done");
    if (i === n) el.classList.add("active");
    else if (i < n) el.classList.add("done");
  }
}

// ── Upload ──
function setupUpload() {
  const zone = document.getElementById("upload-zone");
  const input = document.getElementById("photo-input");
  const browseBtn = zone.querySelector(".svn-upload-btn");

  zone.addEventListener("click", (e) => { if (e.target !== browseBtn) input.click(); });
  if (browseBtn) browseBtn.addEventListener("click", (e) => { e.stopPropagation(); input.click(); });
  zone.addEventListener("dragover", (e) => { e.preventDefault(); zone.classList.add("drag-over"); });
  zone.addEventListener("dragleave", () => zone.classList.remove("drag-over"));
  zone.addEventListener("drop", (e) => { e.preventDefault(); zone.classList.remove("drag-over"); handleFiles(e.dataTransfer.files); });
  input.addEventListener("change", (e) => { handleFiles(e.target.files); input.value = ""; });
}

async function handleFiles(fileList) {
  for (const file of fileList) {
    if (!file.type.startsWith("image/") || photos.length >= 20) continue;
    const id = "ph-" + Date.now() + "-" + Math.random().toString(36).slice(2, 6);
    const blobUrl = URL.createObjectURL(file);
    const base64 = await compressToBase64(file, 768);
    photos.push({ id, file, base64, mimeType: "image/jpeg", blobUrl, title: file.name.replace(/\.[^.]+$/, "").replace(/[_-]/g, " ") });
  }
  renderPhotoPreview();
  if (photos.length > 0) {
    document.getElementById("product-section").style.display = "";
    setStep(2);
  }
}

function compressToBase64(file, maxSize) {
  return new Promise((resolve) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      URL.revokeObjectURL(url);
      let w = img.width, h = img.height;
      if (w > maxSize || h > maxSize) {
        if (w > h) { h = Math.round(h * maxSize / w); w = maxSize; } else { w = Math.round(w * maxSize / h); h = maxSize; }
      }
      const canvas = document.createElement("canvas");
      canvas.width = w; canvas.height = h;
      canvas.getContext("2d").drawImage(img, 0, 0, w, h);
      resolve(canvas.toDataURL("image/jpeg", 0.85).split(",")[1]);
    };
    img.src = url;
  });
}

function renderPhotoPreview() {
  const container = document.getElementById("photo-preview");
  container.innerHTML = "";
  photos.forEach((ph, i) => {
    const wrap = document.createElement("div");
    wrap.className = "svn-photo-thumb-wrap";
    const img = document.createElement("img");
    img.className = "svn-photo-thumb"; img.src = ph.blobUrl; img.alt = ph.title;
    wrap.appendChild(img);
    const del = document.createElement("button");
    del.className = "svn-photo-remove"; del.textContent = "\u00d7";
    del.onclick = () => { URL.revokeObjectURL(ph.blobUrl); photos.splice(i, 1); renderPhotoPreview(); if (!photos.length) { document.getElementById("product-section").style.display = "none"; setStep(1); } };
    wrap.appendChild(del);
    container.appendChild(wrap);
  });
}

// ── GPX Upload ──
function setupGpxUpload() {
  const drop = document.getElementById("gpx-drop");
  const input = document.getElementById("gpx-input");
  const status = document.getElementById("gpx-status");
  if (!drop) return;

  drop.addEventListener("click", () => input.click());
  drop.addEventListener("dragover", (e) => { e.preventDefault(); drop.style.borderColor = "#2d6a4f"; });
  drop.addEventListener("dragleave", () => { if (!gpxData) drop.style.borderColor = ""; });
  drop.addEventListener("drop", (e) => { e.preventDefault(); if (e.dataTransfer.files[0]) handleGpxFile(e.dataTransfer.files[0]); });
  input.addEventListener("change", (e) => { if (e.target.files[0]) handleGpxFile(e.target.files[0]); });
}

async function handleGpxFile(file) {
  const drop = document.getElementById("gpx-drop");
  const status = document.getElementById("gpx-status");
  try {
    gpxData = parseGpx(await file.text());
    drop.classList.add("has-gpx");
    status.textContent = gpxData.name + " — " + gpxData.trackPoints.length + " points, " + gpxData.totalDistanceKm + " km, \u2191" + gpxData.elevationGainM + "m";
  } catch (e) {
    gpxData = null;
    drop.classList.remove("has-gpx");
    status.textContent = "Failed: " + e.message;
  }
}

// ── Product Selection ──
function renderProductGrid() {
  const grid = document.getElementById("product-grid");
  grid.innerHTML = "";
  for (const p of PRODUCTS) {
    const card = document.createElement("div");
    card.className = "svn-product-card" + (selectedProducts.has(p.key) ? " selected" : "");
    card.innerHTML = '<div class="svn-product-check">' + CHECK_SVG + '</div><div class="svn-product-icon">' + p.svg + '</div><div class="svn-product-name">' + p.label + '</div><div class="svn-product-dims">' + p.dims + '</div>';
    card.onclick = () => {
      if (selectedProducts.has(p.key)) selectedProducts.delete(p.key); else selectedProducts.add(p.key);
      card.classList.toggle("selected");
    };
    grid.appendChild(card);
  }
}

// ── Variant Selector ──
function setupVariantSelector() {
  document.querySelectorAll(".svn-var-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".svn-var-btn").forEach(b => b.classList.remove("active"));
      btn.classList.add("active");
      variantsCount = parseInt(btn.dataset.val);
      document.getElementById("variant-count").value = btn.dataset.val;
    });
  });
}

// ── Generate ──
function setupGenerate() {
  document.getElementById("generate-btn").addEventListener("click", async () => {
    if (generating || !photos.length || !selectedProducts.size) return;
    generating = true;
    const btn = document.getElementById("generate-btn");
    btn.disabled = true; btn.innerHTML = "Generating...";

    setStep(3);
    document.getElementById("progress-section").style.display = "";
    document.getElementById("results-section").style.display = "none";
    const progressFill = document.getElementById("progress-fill");
    const progressPct = document.getElementById("progress-pct");
    const progressLog = document.getElementById("progress-log");
    progressLog.innerHTML = ""; progressFill.style.width = "0%";

    const products = [...selectedProducts];
    const totalSteps = 6 + products.length * variantsCount;
    let step = 0;

    const onStatus = (msg) => {
      step++;
      const pct = Math.min(100, Math.round(step / totalSteps * 100));
      progressFill.style.width = pct + "%";
      progressPct.textContent = pct + "%";
      const line = document.createElement("div");
      line.textContent = msg;
      progressLog.appendChild(line);
      progressLog.scrollTop = progressLog.scrollHeight;
    };

    const tripData = {
      name: gpxData ? gpxData.name : "My Travel Photos",
      waypoints: [{ title: "Travel Location", lat: gpxData ? gpxData.trackPoints[0].lat : 0, lng: gpxData ? gpxData.trackPoints[0].lng : 0, photos: photos.map(p => ({ title: p.title })) }],
      gpxTrack: gpxData ? gpxData.trackPoints : [],
      stats: gpxData ? { distanceKm: gpxData.totalDistanceKm, elevationGainM: gpxData.elevationGainM, elevationLossM: gpxData.elevationLossM } : {}
    };
    const photoBase64Array = photos.map(p => ({ base64: p.base64, mimeType: p.mimeType, location: "Travel", title: p.title }));

    try {
      results = await SouvenirCore.generate(tripData, photoBase64Array, products, variantsCount, onStatus);
      progressFill.style.width = "100%"; progressPct.textContent = "100%";
      onStatus("Done! " + results.length + " souvenirs generated.");
      renderResults();
    } catch (e) {
      onStatus("Error: " + e.message);
      console.error(e);
    }

    generating = false;
    btn.disabled = false;
    btn.innerHTML = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2l2.4 7.2L22 12l-7.6 2.8L12 22l-2.4-7.2L2 12l7.6-2.8Z"/></svg> Generate Souvenirs';
  });
}

// ── Results ──
function renderResults() {
  document.getElementById("results-section").style.display = "";
  const grid = document.getElementById("results-grid");
  grid.innerHTML = "";
  results.forEach((r, i) => {
    if (!r || !r.base64) return;
    const card = document.createElement("div");
    card.className = "svn-result-card";
    const img = document.createElement("img");
    img.className = "svn-result-img"; img.src = "data:" + (r.mime || "image/png") + ";base64," + r.base64;
    card.appendChild(img);
    const info = document.createElement("div");
    info.className = "svn-result-info";
    info.innerHTML = '<div class="svn-result-type">' + (r.type || "souvenir") + '</div><div class="svn-result-strategy">' + (r.strategy || "").replace(/_/g, " ") + '</div>';
    card.appendChild(info);
    const dl = document.createElement("a");
    dl.className = "svn-result-download"; dl.textContent = "Download";
    dl.href = "data:" + (r.mime || "image/png") + ";base64," + r.base64;
    dl.download = "souvenir-" + (r.type || "item") + "-" + (i + 1) + ".png";
    card.appendChild(dl);
    grid.appendChild(card);
  });
}

// ── Download All + Start Over ──
function setupDownloadAll() {
  document.getElementById("download-all-btn").addEventListener("click", () => {
    results.forEach((r, i) => {
      if (!r?.base64) return;
      const a = document.createElement("a");
      a.href = "data:" + (r.mime || "image/png") + ";base64," + r.base64;
      a.download = "souvenir-" + (r.type || "item") + "-" + (i + 1) + ".png";
      document.body.appendChild(a); a.click(); document.body.removeChild(a);
    });
  });
}

function setupNewBtn() {
  const btn = document.getElementById("new-btn");
  if (btn) btn.addEventListener("click", () => {
    photos.forEach(p => URL.revokeObjectURL(p.blobUrl));
    photos = []; results = []; gpxData = null;
    selectedProducts = new Set(["postcard", "magnet", "sticker"]);
    const gpxDrop = document.getElementById("gpx-drop");
    const gpxStatus = document.getElementById("gpx-status");
    if (gpxDrop) gpxDrop.classList.remove("has-gpx");
    if (gpxStatus) gpxStatus.textContent = "Add a GPX file for route-aware designs (distance, elevation, trail shape)";
    document.getElementById("photo-preview").innerHTML = "";
    document.getElementById("product-section").style.display = "none";
    document.getElementById("progress-section").style.display = "none";
    document.getElementById("results-section").style.display = "none";
    renderProductGrid(); setStep(1);
  });
}
