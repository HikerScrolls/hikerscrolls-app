// Souvenir Studio — Standalone App
// Uses SouvenirCore from souvenir-core.js + /api/ai proxy

// ── callAI (same as demo/app.js) ──
async function callAI(capability, payload, overrideProvider, overrideModel) {
  const resp = await fetch("/api/ai", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ capability, provider: overrideProvider || "gemini", model: overrideModel || undefined, payload })
  });
  if (!resp.ok) {
    const err = await resp.json().catch(() => ({ error: "API error " + resp.status }));
    throw new Error(err.error || "API error " + resp.status);
  }
  const data = await resp.json();
  return data.result;
}

// ── State ──
let photos = []; // {id, file, base64, mimeType, blobUrl, title}
let selectedProducts = new Set(["postcard", "magnet", "sticker"]);
let results = []; // {type, strategy, base64, mime}
let generating = false;

const PRODUCT_ICONS = {
  postcard: { icon: "M", label: "Postcard", dims: "148x100mm" },
  magnet: { icon: "M", label: "Fridge Magnet", dims: "70x50mm" },
  sticker: { icon: "S", label: "Sticker", dims: "60x60mm" },
  pin: { icon: "P", label: "Enamel Pin", dims: "38mm" },
  stamp: { icon: "T", label: "Stamp", dims: "30x40mm" }
};

// ── Init ──
document.addEventListener("DOMContentLoaded", () => {
  setupUpload();
  renderProductGrid();
  setupGenerate();
  setupDownloadAll();
});

// ── Upload ──
function setupUpload() {
  const zone = document.getElementById("upload-zone");
  const input = document.getElementById("photo-input");

  zone.addEventListener("click", () => input.click());
  zone.addEventListener("dragover", (e) => { e.preventDefault(); zone.classList.add("drag-over"); });
  zone.addEventListener("dragleave", () => zone.classList.remove("drag-over"));
  zone.addEventListener("drop", (e) => {
    e.preventDefault(); zone.classList.remove("drag-over");
    handleFiles(e.dataTransfer.files);
  });
  input.addEventListener("change", (e) => { handleFiles(e.target.files); input.value = ""; });
}

async function handleFiles(fileList) {
  for (const file of fileList) {
    if (!file.type.startsWith("image/") || photos.length >= 20) continue;
    const id = "ph-" + Date.now() + "-" + Math.random().toString(36).slice(2, 6);
    const blobUrl = URL.createObjectURL(file);

    // Compress to max 768px for AI
    const base64 = await compressToBase64(file, 768);

    photos.push({ id, file, base64, mimeType: "image/jpeg", blobUrl, title: file.name.replace(/\.[^.]+$/, "").replace(/[_-]/g, " ") });
  }
  renderPhotoPreview();
  if (photos.length > 0) {
    document.getElementById("product-section").style.display = "";
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
        if (w > h) { h = Math.round(h * maxSize / w); w = maxSize; }
        else { w = Math.round(w * maxSize / h); h = maxSize; }
      }
      const canvas = document.createElement("canvas");
      canvas.width = w; canvas.height = h;
      canvas.getContext("2d").drawImage(img, 0, 0, w, h);
      const dataUrl = canvas.toDataURL("image/jpeg", 0.85);
      resolve(dataUrl.split(",")[1]); // strip "data:image/jpeg;base64,"
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
    img.className = "svn-photo-thumb";
    img.src = ph.blobUrl;
    img.alt = ph.title;
    wrap.appendChild(img);
    const del = document.createElement("button");
    del.className = "svn-photo-remove";
    del.textContent = "\u00d7";
    del.onclick = () => {
      URL.revokeObjectURL(ph.blobUrl);
      photos.splice(i, 1);
      renderPhotoPreview();
      if (photos.length === 0) document.getElementById("product-section").style.display = "none";
    };
    wrap.appendChild(del);
    container.appendChild(wrap);
  });
}

// ── Product Selection ──
function renderProductGrid() {
  const grid = document.getElementById("product-grid");
  grid.innerHTML = "";
  const svgIcons = {
    postcard: '<svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="2" y="4" width="20" height="16" rx="2"/><line x1="2" y1="10" x2="22" y2="10"/><line x1="12" y1="10" x2="12" y2="20"/></svg>',
    magnet: '<svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M6 2v6a6 6 0 0 0 12 0V2"/><line x1="6" y1="6" x2="6" y2="2"/><line x1="18" y1="6" x2="18" y2="2"/><rect x="3" y="2" width="6" height="4" rx="1"/><rect x="15" y="2" width="6" height="4" rx="1"/></svg>',
    sticker: '<svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="12" cy="12" r="10"/><path d="M8 14s1.5 2 4 2 4-2 4-2"/><line x1="9" y1="9" x2="9.01" y2="9" stroke-width="3" stroke-linecap="round"/><line x1="15" y1="9" x2="15.01" y2="9" stroke-width="3" stroke-linecap="round"/></svg>',
    pin: '<svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 1 1 16 0Z"/><circle cx="12" cy="10" r="3"/></svg>',
    stamp: '<svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="3" y="3" width="18" height="18" rx="2"/><rect x="6" y="6" width="12" height="12" rx="1"/><circle cx="3" cy="3" r="1.5" fill="currentColor"/><circle cx="21" cy="3" r="1.5" fill="currentColor"/><circle cx="3" cy="21" r="1.5" fill="currentColor"/><circle cx="21" cy="21" r="1.5" fill="currentColor"/></svg>'
  };

  for (const [key, info] of Object.entries(PRODUCT_ICONS)) {
    const card = document.createElement("div");
    card.className = "svn-product-card" + (selectedProducts.has(key) ? " selected" : "");
    card.innerHTML = '<div class="svn-product-icon">' + (svgIcons[key] || "") + '</div><div class="svn-product-name">' + info.label + '</div><div class="svn-product-dims">' + info.dims + '</div>';
    card.onclick = () => {
      if (selectedProducts.has(key)) selectedProducts.delete(key); else selectedProducts.add(key);
      card.classList.toggle("selected");
    };
    grid.appendChild(card);
  }
}

// ── Generate ──
function setupGenerate() {
  const btn = document.getElementById("generate-btn");
  btn.addEventListener("click", async () => {
    if (generating || photos.length === 0 || selectedProducts.size === 0) return;
    generating = true;
    btn.disabled = true;
    btn.textContent = "Generating...";

    document.getElementById("progress-section").style.display = "";
    document.getElementById("results-section").style.display = "none";
    const progressFill = document.getElementById("progress-fill");
    const progressLog = document.getElementById("progress-log");
    progressLog.innerHTML = "";

    const variants = parseInt(document.getElementById("variant-count").value) || 2;
    const products = [...selectedProducts];

    // Build minimal trip data from photos
    const tripData = {
      name: "My Travel Photos",
      waypoints: [{
        title: "Travel Location",
        lat: 0, lng: 0,
        photos: photos.map(p => ({ title: p.title }))
      }],
      gpxTrack: [],
      stats: {}
    };

    const photoBase64Array = photos.map(p => ({
      base64: p.base64,
      mimeType: p.mimeType,
      location: "Travel",
      title: p.title
    }));

    let totalSteps = 6 + products.length * variants;
    let currentStep = 0;

    const onStatus = (msg) => {
      currentStep++;
      const pct = Math.min(100, Math.round(currentStep / totalSteps * 100));
      progressFill.style.width = pct + "%";
      const line = document.createElement("div");
      line.textContent = msg;
      progressLog.appendChild(line);
      progressLog.scrollTop = progressLog.scrollHeight;
    };

    try {
      results = await SouvenirCore.generate(tripData, photoBase64Array, products, variants, onStatus);
      progressFill.style.width = "100%";
      onStatus("Done! " + results.length + " souvenirs generated.");
      renderResults();
    } catch (e) {
      onStatus("Error: " + e.message);
      console.error(e);
    }

    generating = false;
    btn.disabled = false;
    btn.textContent = "Generate Souvenirs";
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
    img.className = "svn-result-img";
    img.src = "data:" + (r.mime || "image/png") + ";base64," + r.base64;
    img.alt = r.type + " " + r.strategy;
    card.appendChild(img);

    const info = document.createElement("div");
    info.className = "svn-result-info";
    info.innerHTML = '<div class="svn-result-type">' + (r.type || "souvenir") + '</div><div class="svn-result-strategy">' + (r.strategy || "") + '</div>';
    card.appendChild(info);

    const dl = document.createElement("a");
    dl.className = "svn-result-download";
    dl.textContent = "Download";
    dl.href = "data:" + (r.mime || "image/png") + ";base64," + r.base64;
    dl.download = "souvenir-" + (r.type || "item") + "-" + (i + 1) + ".png";
    card.appendChild(dl);

    grid.appendChild(card);
  });
}

// ── Download All ──
function setupDownloadAll() {
  document.getElementById("download-all-btn").addEventListener("click", () => {
    results.forEach((r, i) => {
      if (!r || !r.base64) return;
      const a = document.createElement("a");
      a.href = "data:" + (r.mime || "image/png") + ";base64," + r.base64;
      a.download = "souvenir-" + (r.type || "item") + "-" + (i + 1) + ".png";
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
    });
  });
}
