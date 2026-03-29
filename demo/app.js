/* ================================================
   HikerScrolls — Standalone Website Template
   Ported from Obsidian plugin v6.38
   Templates: Scrollytelling, Scrapbook, Illustrated
   ================================================ */

// === Constants ===
const TILE = 256;
const POOL = 600;
const CAM_OX = 0.7;
const CAM_OY = 0.5;


// ══════════════════════════════════════════════════════════════
// ══ A2: GPX Parser (ported from plugin) ══════════════════════
// ══════════════════════════════════════════════════════════════

function _gpxText(el, sel) { return el.querySelector(sel)?.textContent?.trim() || null; }
function _gpxNum(el, sel) { const t = _gpxText(el, sel); return t ? (isNaN(+t) ? undefined : +t) : undefined; }
function _toRad(d) { return d * Math.PI / 180; }
function _haversineKm(lat1, lng1, lat2, lng2) {
  const dLat = _toRad(lat2 - lat1), dLng = _toRad(lng2 - lng1);
  const a = Math.sin(dLat/2)**2 + Math.cos(_toRad(lat1)) * Math.cos(_toRad(lat2)) * Math.sin(dLng/2)**2;
  return 6371 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
}

function parseGpx(xmlString) {
  const doc = new DOMParser().parseFromString(xmlString, "application/xml");
  if (doc.querySelector("parsererror")) throw new Error("Invalid GPX file");
  const name = _gpxText(doc, "metadata > name") || _gpxText(doc, "trk > name") || "Unnamed Trail";
  const trackPoints = [];
  doc.querySelectorAll("trkpt").forEach(el => {
    const lat = parseFloat(el.getAttribute("lat")||"0"), lng = parseFloat(el.getAttribute("lon")||"0");
    if (lat || lng) trackPoints.push({ lat, lng, ele: _gpxNum(el, "ele"), time: _gpxText(el, "time") || undefined });
  });
  if (!trackPoints.length) {
    doc.querySelectorAll("rtept").forEach(el => {
      const lat = parseFloat(el.getAttribute("lat")||"0"), lng = parseFloat(el.getAttribute("lon")||"0");
      if (lat || lng) trackPoints.push({ lat, lng, ele: _gpxNum(el, "ele") });
    });
  }
  if (!trackPoints.length) throw new Error("GPX file contains no track data");
  const lats = trackPoints.map(p => p.lat), lngs = trackPoints.map(p => p.lng);
  const bounds = { north: Math.max(...lats), south: Math.min(...lats), east: Math.max(...lngs), west: Math.min(...lngs) };
  const latPad = (bounds.north - bounds.south) * 0.1 || 0.01, lngPad = (bounds.east - bounds.west) * 0.1 || 0.01;
  bounds.north += latPad; bounds.south -= latPad; bounds.east += lngPad; bounds.west -= lngPad;
  let totalDistanceKm = 0, elevationGainM = 0, elevationLossM = 0;
  for (let i = 1; i < trackPoints.length; i++) {
    totalDistanceKm += _haversineKm(trackPoints[i-1].lat, trackPoints[i-1].lng, trackPoints[i].lat, trackPoints[i].lng);
    if (trackPoints[i-1].ele != null && trackPoints[i].ele != null) {
      const diff = trackPoints[i].ele - trackPoints[i-1].ele;
      if (diff > 0) elevationGainM += diff; else elevationLossM += Math.abs(diff);
    }
  }
  return { name, trackPoints, bounds, totalDistanceKm: Math.round(totalDistanceKm * 100) / 100, elevationGainM: Math.round(elevationGainM), elevationLossM: Math.round(elevationLossM) };
}

// ══════════════════════════════════════════════════════════════
// ══ A3: EXIF GPS Extractor (pure JS, no library) ═════════════
// ══════════════════════════════════════════════════════════════

function extractExifGps(arrayBuffer) {
  const result = { hasGps: false };
  try {
    const view = new DataView(arrayBuffer);
    if (view.getUint16(0) !== 0xFFD8) return result; // not JPEG
    let offset = 2;
    while (offset < view.byteLength - 1) {
      const marker = view.getUint16(offset);
      if (marker === 0xFFE1) { // APP1 (EXIF)
        const len = view.getUint16(offset + 2);
        const exifData = arrayBuffer.slice(offset + 4, offset + 2 + len);
        return _parseExifBlock(exifData);
      }
      if ((marker & 0xFF00) !== 0xFF00) break;
      offset += 2 + view.getUint16(offset + 2);
    }
  } catch (e) {}
  return result;
}

function _parseExifBlock(buffer) {
  const result = { hasGps: false };
  const view = new DataView(buffer);
  // Check "Exif\0\0"
  if (view.getUint32(0) !== 0x45786966 || view.getUint16(4) !== 0) return result;
  const tiffStart = 6;
  const le = view.getUint16(tiffStart) === 0x4949; // little-endian?
  const g16 = (o) => le ? view.getUint16(tiffStart + o, true) : view.getUint16(tiffStart + o, false);
  const g32 = (o) => le ? view.getUint32(tiffStart + o, true) : view.getUint32(tiffStart + o, false);
  // Read IFD0
  const ifd0Offset = g32(4);
  const ifd0Count = g16(ifd0Offset);
  let gpsIFDOffset = 0;
  for (let i = 0; i < ifd0Count; i++) {
    const entryOffset = ifd0Offset + 2 + i * 12;
    const tag = g16(entryOffset);
    if (tag === 0x8825) { // GPSInfoIFDPointer
      gpsIFDOffset = g32(entryOffset + 8);
      break;
    }
  }
  if (!gpsIFDOffset) return result;
  // Read GPS IFD
  const gpsCount = g16(gpsIFDOffset);
  let latRef = "N", lngRef = "E", latVals = null, lngVals = null, altVal = null;
  for (let i = 0; i < gpsCount; i++) {
    const eo = gpsIFDOffset + 2 + i * 12;
    if (eo + 12 > view.byteLength - tiffStart) break;
    const tag = g16(eo);
    const type = g16(eo + 2);
    const valOffset = g32(eo + 8);
    if (tag === 1) { // GPSLatitudeRef
      latRef = String.fromCharCode(view.getUint8(tiffStart + eo + 8));
    } else if (tag === 2 && type === 5) { // GPSLatitude (3 rationals)
      latVals = _readRationals(view, tiffStart, valOffset, 3, le);
    } else if (tag === 3) { // GPSLongitudeRef
      lngRef = String.fromCharCode(view.getUint8(tiffStart + eo + 8));
    } else if (tag === 4 && type === 5) { // GPSLongitude
      lngVals = _readRationals(view, tiffStart, valOffset, 3, le);
    } else if (tag === 6 && type === 5) { // GPSAltitude
      const r = _readRationals(view, tiffStart, valOffset, 1, le);
      if (r) altVal = r[0];
    }
  }
  if (latVals && lngVals) {
    let lat = latVals[0] + latVals[1] / 60 + latVals[2] / 3600;
    let lng = lngVals[0] + lngVals[1] / 60 + lngVals[2] / 3600;
    if (latRef === "S") lat = -lat;
    if (lngRef === "W") lng = -lng;
    if (lat !== 0 || lng !== 0) {
      result.hasGps = true; result.lat = lat; result.lng = lng;
      if (altVal != null) result.alt = altVal;
    }
  }
  return result;
}

function _readRationals(view, tiffStart, offset, count, le) {
  try {
    const vals = [];
    for (let i = 0; i < count; i++) {
      const o = tiffStart + offset + i * 8;
      const num = le ? view.getUint32(o, true) : view.getUint32(o, false);
      const den = le ? view.getUint32(o + 4, true) : view.getUint32(o + 4, false);
      vals.push(den ? num / den : 0);
    }
    return vals;
  } catch (e) { return null; }
}

// ══════════════════════════════════════════════════════════════
// ══ A5: IndexedDB Photo Storage ══════════════════════════════
// ══════════════════════════════════════════════════════════════

const PHOTO_DB_NAME = "hikerscrolls-photos";
const PHOTO_DB_VERSION = 1;
const PHOTO_STORE = "photos";

function _openPhotoDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(PHOTO_DB_NAME, PHOTO_DB_VERSION);
    req.onupgradeneeded = () => { req.result.createObjectStore(PHOTO_STORE); };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function savePhotoToIDB(id, arrayBuffer) {
  const db = await _openPhotoDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(PHOTO_STORE, "readwrite");
    tx.objectStore(PHOTO_STORE).put(arrayBuffer, id);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

async function getPhotoFromIDB(id) {
  const db = await _openPhotoDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(PHOTO_STORE, "readonly");
    const req = tx.objectStore(PHOTO_STORE).get(id);
    req.onsuccess = () => resolve(req.result || null);
    req.onerror = () => reject(req.error);
  });
}

async function deletePhotoFromIDB(id) {
  const db = await _openPhotoDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(PHOTO_STORE, "readwrite");
    tx.objectStore(PHOTO_STORE).delete(id);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

async function compressPhoto(file) {
  return new Promise((resolve) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      URL.revokeObjectURL(url);
      const MAX = 1200;
      let w = img.width, h = img.height;
      if (w > MAX || h > MAX) {
        if (w > h) { h = Math.round(h * MAX / w); w = MAX; }
        else { w = Math.round(w * MAX / h); h = MAX; }
      }
      const canvas = document.createElement("canvas");
      canvas.width = w; canvas.height = h;
      canvas.getContext("2d").drawImage(img, 0, 0, w, h);
      canvas.toBlob(blob => {
        blob.arrayBuffer().then(buf => resolve(buf));
      }, "image/jpeg", 0.8);
    };
    img.src = url;
  });
}

// Blob URL cache for photos loaded from IndexedDB
const _photoBlobCache = new Map();

async function getPhotoBlobUrl(photoId) {
  if (_photoBlobCache.has(photoId)) return _photoBlobCache.get(photoId);
  const buf = await getPhotoFromIDB(photoId);
  if (!buf) return null;
  const blob = new Blob([buf], { type: "image/jpeg" });
  const url = URL.createObjectURL(blob);
  _photoBlobCache.set(photoId, url);
  return url;
}

// ══════════════════════════════════════════════════════════════
// ══ A1: localStorage Trip Management ═════════════════════════
// ══════════════════════════════════════════════════════════════

const LOCAL_TRIPS_KEY = "hikerscrolls_local_trips";

function getLocalTrips() {
  try { return JSON.parse(localStorage.getItem(LOCAL_TRIPS_KEY) || "[]"); }
  catch { return []; }
}

function saveLocalTrips(trips) {
  localStorage.setItem(LOCAL_TRIPS_KEY, JSON.stringify(trips));
}

function saveLocalTrip(trip) {
  const trips = getLocalTrips();
  const idx = trips.findIndex(t => t.id === trip.id);
  if (idx >= 0) trips[idx] = trip; else trips.push(trip);
  saveLocalTrips(trips);
}

function deleteLocalTrip(tripId) {
  const trips = getLocalTrips().filter(t => t.id !== tripId);
  saveLocalTrips(trips);
  // Also clean up photos from IndexedDB
  const trip = getLocalTrips().find(t => t.id === tripId);
  if (trip?.waypoints) {
    for (const wp of trip.waypoints) {
      for (const ph of (wp.photos || [])) {
        deletePhotoFromIDB(ph.id).catch(() => {});
      }
    }
  }
}

// ══════════════════════════════════════════════════════════════
// ══ A4: Creation Wizard (5-step, full port from plugin) ══════
// ══════════════════════════════════════════════════════════════

function showCreationWizard() {
  const existing = document.querySelector(".hj-wizard-overlay");
  if (existing) existing.remove();

  // ── Wizard State ──
  let step = 1;
  let config = { name: "", date: new Date().toISOString().split("T")[0], endDate: "", region: "", description: "", template: "scrollytelling", mapStyle: "opentopomap" };
  let gpxData = null;
  let locations = []; // {id, title, lat, lng, photos:[], gpsSource, description}
  let sections = []; // {id, title, locationIds:[], text}
  let photoBuffers = new Map(); // id → compressed ArrayBuffer
  let photoCounter = 0;
  let locCounter = 0;
  let secCounter = 0;
  let useAiLocation = false;
  let wizardMap = null; // Leaflet map instance
  let wizardMarkers = []; // Leaflet marker refs
  let _thumbCache = new Map();

  // ── Overlay + Modal ──
  const overlay = document.createElement("div");
  overlay.className = "hj-wizard-overlay";
  overlay.style.cssText = "position:fixed;inset:0;background:rgba(0,0,0,0.6);z-index:10000;display:flex;align-items:center;justify-content:center;";

  const modal = document.createElement("div");
  modal.className = "hj-wizard-modal";
  modal.style.cssText = "background:white;border-radius:16px;max-width:820px;width:95%;max-height:90vh;display:flex;flex-direction:column;box-shadow:0 20px 60px rgba(0,0,0,0.3);overflow:hidden;";

  overlay.appendChild(modal);
  document.body.appendChild(overlay);

  // ── Helpers ──
  const _el = (tag, parent, opts = {}) => {
    const el = document.createElement(tag);
    if (opts.cls) el.className = opts.cls;
    if (opts.text) el.textContent = opts.text;
    if (opts.html) el.innerHTML = opts.html;
    if (opts.style) el.style.cssText = opts.style;
    if (parent) parent.appendChild(el);
    return el;
  };

  function destroyMap() {
    if (wizardMap) { wizardMap.remove(); wizardMap = null; }
    wizardMarkers = [];
  }

  function initLeafletMap(container, opts = {}) {
    destroyMap();
    const height = opts.height || 380;
    container.style.height = height + "px";
    container.style.borderRadius = "8px";
    container.style.border = "1px solid #e2e8f0";
    container.style.marginBottom = "12px";

    const center = [0, 0];
    let zoom = 2;
    if (gpxData && gpxData.trackPoints.length > 0) {
      const b = gpxData.bounds;
      center[0] = (b.north + b.south) / 2;
      center[1] = (b.east + b.west) / 2;
      zoom = 12;
    }

    wizardMap = L.map(container, { center, zoom, zoomControl: true, attributionControl: false });
    L.tileLayer("https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}.png", {
      subdomains: "abcd", maxZoom: 19
    }).addTo(wizardMap);

    // Draw GPX route
    if (gpxData && gpxData.trackPoints.length > 1) {
      const latlngs = gpxData.trackPoints.map(p => [p.lat, p.lng]);
      L.polyline(latlngs, { color: "#dc2626", weight: 3, opacity: 0.7 }).addTo(wizardMap);
      wizardMap.fitBounds(L.latLngBounds(latlngs).pad(0.1));
    }

    setTimeout(() => wizardMap.invalidateSize(), 100);
    return wizardMap;
  }

  function refreshMapMarkers() {
    if (!wizardMap) return;
    wizardMarkers.forEach(m => wizardMap.removeLayer(m));
    wizardMarkers = [];
    const colors = { exif: "#2563eb", "ai-high": "#10b981", "ai-medium": "#f59e0b", "ai-unknown": "#6b7280", manual: "#dc2626" };
    locations.forEach((loc, i) => {
      const color = colors[loc.gpsSource] || "#dc2626";
      const marker = L.circleMarker([loc.lat, loc.lng], {
        radius: 8, fillColor: color, color: "#fff", weight: 2, fillOpacity: 0.9
      }).addTo(wizardMap);
      marker.bindTooltip(loc.title || "Location " + (i + 1), { direction: "top", offset: [0, -10] });
      wizardMarkers.push(marker);
    });
  }

  // ══════════════════════════════════════════════════════════
  // ── Main Render ──
  // ══════════════════════════════════════════════════════════
  function render() {
    destroyMap();
    modal.innerHTML = "";

    // Header
    const header = _el("div", modal, { style: "padding:16px 24px;border-bottom:1px solid #e5e7eb;display:flex;justify-content:space-between;align-items:center;" });
    const titles = ["Trip Info & GPX", "Select Locations", "Assign Photos", "Blog Sections", "Review & Create"];
    _el("div", header, { text: "Step " + step + ": " + titles[step - 1], style: "font-size:1rem;font-weight:600;color:#1e293b;" });
    const closeBtn = _el("button", header, { text: "\u00d7", style: "background:none;border:none;font-size:1.5rem;cursor:pointer;color:#94a3b8;padding:0 4px;" });
    closeBtn.onclick = () => { destroyMap(); overlay.remove(); };

    // Step dots
    const dots = _el("div", modal, { style: "display:flex;gap:6px;padding:8px 24px;justify-content:center;" });
    for (let i = 1; i <= 5; i++) {
      const dot = _el("div", dots, { text: String(i), style: "width:28px;height:28px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:0.75rem;font-weight:700;transition:all 0.3s;" + (i === step ? "background:#2d6a4f;color:white;" : i < step ? "background:#f0fdf4;color:#16a34a;border:1px solid #bbf7d0;" : "background:#f1f5f9;color:#94a3b8;border:1px solid #e2e8f0;") });
    }

    // Content area
    const content = _el("div", modal, { style: "flex:1;overflow-y:auto;padding:16px 24px;" });

    switch (step) {
      case 1: renderStep1(content); break;
      case 2: renderStep2(content); break;
      case 3: renderStep3(content); break;
      case 4: renderStep4(content); break;
      case 5: renderStep5(content); break;
    }

    // Footer
    const footer = _el("div", modal, { style: "padding:12px 24px;border-top:1px solid #e5e7eb;display:flex;justify-content:space-between;" });
    if (step > 1) {
      const backBtn = _el("button", footer, { text: "\u2190 Back", style: "padding:8px 20px;border:1px solid #d1d5db;border-radius:8px;background:white;cursor:pointer;font-size:0.85rem;" });
      backBtn.onclick = () => { step--; render(); };
    } else { _el("div", footer); }

    if (step < 5) {
      const nextBtn = _el("button", footer, { text: "Next \u2192", style: "padding:8px 20px;border:none;border-radius:8px;background:#2d6a4f;color:white;cursor:pointer;font-size:0.85rem;font-weight:500;" });
      nextBtn.onclick = () => {
        if (step === 1 && !config.name.trim()) { alert("Please enter a trip name"); return; }
        step++; render();
      };
    } else {
      const finBtn = _el("button", footer, { text: "Create Trip", style: "padding:8px 20px;border:none;border-radius:8px;background:#2d6a4f;color:white;cursor:pointer;font-size:0.85rem;font-weight:600;" });
      finBtn.onclick = () => finishWizard();
    }
  }

  // ══════════════════════════════════════════════════════════
  // ── Step 1: Trip Info + GPX Upload ──
  // ══════════════════════════════════════════════════════════
  function renderStep1(ct) {
    const IS = "width:100%;box-sizing:border-box;padding:8px 12px;border:1px solid #d1d5db;border-radius:8px;font-size:0.85rem;margin-bottom:12px;font-family:inherit;";
    const LS = "display:block;font-size:0.8rem;font-weight:500;color:#475569;margin-bottom:4px;";

    _el("p", ct, { text: "Enter your trip details and upload a GPX route file.", style: "color:#64748b;font-size:0.85rem;margin:0 0 16px;" });

    // Name
    _el("label", ct, { text: "Trip Name *", style: LS });
    const nameIn = _el("input", ct, { style: IS }); nameIn.value = config.name; nameIn.placeholder = "e.g. Kumano Kodo Day 1";
    nameIn.oninput = () => { config.name = nameIn.value; };

    // Date row
    const dRow = _el("div", ct, { style: "display:flex;gap:12px;" });
    const dw1 = _el("div", dRow, { style: "flex:1;" }); _el("label", dw1, { text: "Start Date", style: LS });
    const dateIn = _el("input", dw1, { style: IS }); dateIn.type = "date"; dateIn.value = config.date; dateIn.onchange = () => { config.date = dateIn.value; };
    const dw2 = _el("div", dRow, { style: "flex:1;" }); _el("label", dw2, { text: "End Date", style: LS });
    const endIn = _el("input", dw2, { style: IS }); endIn.type = "date"; endIn.value = config.endDate; endIn.onchange = () => { config.endDate = endIn.value; };

    // Region + Description
    _el("label", ct, { text: "Region", style: LS });
    const regIn = _el("input", ct, { style: IS }); regIn.value = config.region; regIn.placeholder = "e.g. Wakayama, Japan"; regIn.oninput = () => { config.region = regIn.value; };

    _el("label", ct, { text: "Description", style: LS });
    const descIn = _el("textarea", ct, { style: IS + "resize:vertical;min-height:60px;" }); descIn.rows = 2; descIn.value = config.description; descIn.oninput = () => { config.description = descIn.value; };

    // Template + Map Style
    const tRow = _el("div", ct, { style: "display:flex;gap:12px;" });
    const tw1 = _el("div", tRow, { style: "flex:1;" }); _el("label", tw1, { text: "Template", style: LS });
    const tmplSel = _el("select", tw1, { style: IS });
    [{ v: "scrollytelling", l: "Scrollytelling" }, { v: "scrapbook", l: "Scrapbook" }, { v: "illustrated", l: "Illustrated" }].forEach(o => {
      const opt = _el("option", tmplSel); opt.value = o.v; opt.textContent = o.l; if (o.v === config.template) opt.selected = true;
    }); tmplSel.onchange = () => { config.template = tmplSel.value; };

    const tw2 = _el("div", tRow, { style: "flex:1;" }); _el("label", tw2, { text: "Map Style", style: LS });
    const msSel = _el("select", tw2, { style: IS });
    Object.entries(MAP_STYLES).forEach(([k, v]) => {
      const opt = _el("option", msSel); opt.value = k; opt.textContent = v.name; if (k === config.mapStyle) opt.selected = true;
    }); msSel.onchange = () => { config.mapStyle = msSel.value; };

    // GPX Upload
    _el("label", ct, { text: "GPX Route File", style: LS });
    const dz = _el("div", ct, { style: "border:2px dashed " + (gpxData ? "#2d6a4f" : "#d1d5db") + ";border-radius:10px;padding:20px;text-align:center;cursor:pointer;background:" + (gpxData ? "#f0faf4" : "#fafafa") + ";transition:all 0.2s;" });
    if (gpxData) {
      dz.innerHTML = "<div style='font-weight:600;color:#2d6a4f;margin-bottom:4px;'>\u2705 " + gpxData.name + "</div><div style='font-size:0.8rem;color:#64748b;'>" + gpxData.trackPoints.length + " points \u00b7 " + gpxData.totalDistanceKm + " km \u00b7 \u2191" + gpxData.elevationGainM + "m \u2193" + gpxData.elevationLossM + "m</div><div style='font-size:0.75rem;color:#94a3b8;margin-top:4px;'>Click to replace</div>";
    } else {
      dz.innerHTML = "<div style='font-size:1.5rem;margin-bottom:4px;'>\uD83D\uDCC1</div><div style='font-size:0.85rem;color:#94a3b8;'>Drop a .gpx file here or click to browse</div>";
    }
    const fi = _el("input", ct); fi.type = "file"; fi.accept = ".gpx"; fi.style.display = "none";
    fi.onchange = async (e) => { if (e.target.files[0]) { await handleGpx(e.target.files[0]); render(); } };
    dz.onclick = () => fi.click();
    dz.ondragover = (e) => { e.preventDefault(); dz.style.borderColor = "#2d6a4f"; dz.style.background = "#f0faf4"; };
    dz.ondragleave = () => { if (!gpxData) { dz.style.borderColor = "#d1d5db"; dz.style.background = "#fafafa"; } };
    dz.ondrop = async (e) => { e.preventDefault(); if (e.dataTransfer.files[0]) { await handleGpx(e.dataTransfer.files[0]); render(); } };
  }

  async function handleGpx(file) {
    try { gpxData = parseGpx(await file.text()); } catch (e) { alert("GPX Error: " + e.message); gpxData = null; }
  }

  // ══════════════════════════════════════════════════════════
  // ── Step 2: Select Locations ──
  // ══════════════════════════════════════════════════════════
  function renderStep2(ct) {
    _el("p", ct, { text: "Add locations along your route. Click the map or use Auto-Generate.", style: "color:#64748b;font-size:0.85rem;margin:0 0 12px;" });

    // Toolbar
    const toolbar = _el("div", ct, { style: "display:flex;gap:8px;margin-bottom:12px;flex-wrap:wrap;" });
    if (gpxData) {
      const autoBtn = _el("button", toolbar, { text: "\u26A1 Auto-Generate", style: "padding:7px 14px;border:1px solid #2d6a4f;border-radius:8px;background:#f0faf4;color:#2d6a4f;cursor:pointer;font-size:0.8rem;font-weight:500;" });
      autoBtn.onclick = () => { autoGenLocations(); render(); };
    }
    const addBtn = _el("button", toolbar, { text: "+ Add Location", style: "padding:7px 14px;border:1px solid #d1d5db;border-radius:8px;background:white;cursor:pointer;font-size:0.8rem;" });
    addBtn.onclick = () => { addManualLoc(); render(); };
    if (locations.length > 0) {
      const clearBtn = _el("button", toolbar, { text: "\uD83D\uDDD1 Clear All", style: "padding:7px 14px;border:1px solid #fca5a5;border-radius:8px;background:#fef2f2;color:#dc2626;cursor:pointer;font-size:0.8rem;" });
      clearBtn.onclick = () => { if (confirm("Remove all locations?")) { locations = []; render(); } };
    }

    // Map
    if (gpxData) {
      const mapWrap = _el("div", ct);
      const map = initLeafletMap(mapWrap, { height: 340 });

      // Click map to add location
      map.on("click", (e) => {
        locCounter++;
        locations.push({ id: "loc-" + locCounter, title: "Location " + locations.length, lat: e.latlng.lat, lng: e.latlng.lng, photos: [], gpsSource: "manual", description: "" });
        refreshMapMarkers();
        render();
      });

      refreshMapMarkers();
    }

    // Location list
    if (locations.length === 0) {
      _el("div", ct, { text: gpxData ? "Click the map or 'Auto-Generate' to add locations" : "Click '+ Add Location' to add stops", style: "text-align:center;padding:20px;color:#94a3b8;font-size:0.85rem;" });
    } else {
      const list = _el("div", ct, { style: "max-height:280px;overflow-y:auto;" });
      locations.forEach((loc, i) => {
        const row = _el("div", list, { style: "display:flex;gap:8px;align-items:center;padding:8px 10px;border:1px solid #e5e7eb;border-radius:8px;margin-bottom:6px;background:#fafafa;" });
        // Number badge
        _el("div", row, { text: String(i + 1), style: "width:24px;height:24px;border-radius:50%;background:#2d6a4f;color:white;font-size:0.7rem;display:flex;align-items:center;justify-content:center;font-weight:600;flex-shrink:0;" });
        // Title input
        const ti = _el("input", row, { style: "flex:1;padding:5px 8px;border:1px solid #d1d5db;border-radius:6px;font-size:0.8rem;" });
        ti.value = loc.title; ti.oninput = () => { loc.title = ti.value; };
        // Coords
        _el("span", row, { text: loc.lat.toFixed(4) + ", " + loc.lng.toFixed(4), style: "font-size:0.7rem;color:#94a3b8;white-space:nowrap;font-family:monospace;" });
        // Photo count
        if (loc.photos.length > 0) _el("span", row, { text: loc.photos.length + "\uD83D\uDCF7", style: "font-size:0.7rem;color:#64748b;" });
        // AI Enrich button
        const aiBtn = _el("button", row, { text: "\u2728", style: "background:none;border:1px solid #d1d5db;border-radius:6px;padding:3px 8px;cursor:pointer;font-size:0.8rem;" });
        aiBtn.title = "AI Enrich";
        aiBtn.onclick = async () => {
          aiBtn.textContent = "...";
          try {
            const info = await enrichLocationWithGemini(loc.lat, loc.lng, loc.title);
            loc.description = info.description || "";
            if (info.highlights) loc.description += "\n" + info.highlights.map(h => "- " + h).join("\n");
            aiBtn.textContent = "\u2705";
          } catch (e) { aiBtn.textContent = "\u274c"; console.warn(e); }
        };
        // Delete
        const del = _el("button", row, { text: "\u00d7", style: "background:none;border:none;color:#ef4444;font-size:1.2rem;cursor:pointer;padding:0 4px;" });
        del.onclick = () => { locations.splice(i, 1); render(); };
      });
    }
  }

  function autoGenLocations() {
    if (!gpxData) return;
    const pts = gpxData.trackPoints;
    const num = Math.min(8, Math.max(2, Math.floor(gpxData.totalDistanceKm / 3)));
    const interval = Math.max(1, Math.floor(pts.length / num));
    locations = [];
    for (let i = 0; i < pts.length; i += interval) {
      locCounter++;
      locations.push({ id: "loc-" + locCounter, title: "Location " + (locations.length + 1), lat: pts[i].lat, lng: pts[i].lng, photos: [], gpsSource: "manual", description: "" });
    }
    const last = pts[pts.length - 1];
    if (locations.length && (locations[locations.length - 1].lat !== last.lat || locations[locations.length - 1].lng !== last.lng)) {
      locCounter++;
      locations.push({ id: "loc-" + locCounter, title: "End Point", lat: last.lat, lng: last.lng, photos: [], gpsSource: "manual", description: "" });
    }
  }

  function addManualLoc() {
    locCounter++;
    const lat = gpxData ? gpxData.trackPoints[Math.floor(gpxData.trackPoints.length / 2)].lat : 0;
    const lng = gpxData ? gpxData.trackPoints[Math.floor(gpxData.trackPoints.length / 2)].lng : 0;
    locations.push({ id: "loc-" + locCounter, title: "New Location", lat, lng, photos: [], gpsSource: "manual", description: "" });
  }

  // ══════════════════════════════════════════════════════════
  // ── Step 3: Upload & Assign Photos ──
  // ══════════════════════════════════════════════════════════
  function renderStep3(ct) {
    _el("p", ct, { text: "Upload photos and assign them to locations. Drag photos between pools, or drop onto a location.", style: "color:#64748b;font-size:0.85rem;margin:0 0 12px;" });

    // Global upload zone
    const uploadZone = _el("div", ct, { style: "border:2px dashed #d1d5db;border-radius:10px;padding:14px;text-align:center;cursor:pointer;background:#fafafa;margin-bottom:14px;" });
    uploadZone.innerHTML = "<div style='font-size:0.85rem;color:#94a3b8;'>\uD83D\uDCF7 Drop photos here to upload (auto-assigns by GPS)</div>";
    const globalFi = _el("input", ct); globalFi.type = "file"; globalFi.accept = "image/*"; globalFi.multiple = true; globalFi.style.display = "none";
    globalFi.onchange = async (e) => { await handlePhotoUpload(e.target.files, null); render(); };
    uploadZone.onclick = () => globalFi.click();
    uploadZone.ondragover = (e) => { e.preventDefault(); uploadZone.style.borderColor = "#2d6a4f"; uploadZone.style.background = "#f0faf4"; };
    uploadZone.ondragleave = () => { uploadZone.style.borderColor = "#d1d5db"; uploadZone.style.background = "#fafafa"; };
    uploadZone.ondrop = async (e) => { e.preventDefault(); uploadZone.style.borderColor = "#d1d5db"; uploadZone.style.background = "#fafafa"; await handlePhotoUpload(e.dataTransfer.files, null); render(); };

    // Map (smaller)
    if (gpxData) {
      const mapWrap = _el("div", ct);
      initLeafletMap(mapWrap, { height: 220 });
      refreshMapMarkers();
    }

    // Location photo pools
    if (locations.length === 0) {
      _el("div", ct, { text: "No locations yet. Go back to Step 2 to add locations.", style: "text-align:center;padding:20px;color:#94a3b8;font-size:0.85rem;" });
      return;
    }

    const poolContainer = _el("div", ct, { style: "max-height:320px;overflow-y:auto;" });
    locations.forEach((loc, li) => {
      const row = _el("div", poolContainer, { style: "display:flex;border:1px solid #e5e7eb;border-radius:8px;margin-bottom:8px;overflow:hidden;" });

      // Left: location name
      const nameCell = _el("div", row, { style: "width:140px;padding:10px 12px;background:#f8fafc;border-right:1px solid #e5e7eb;flex-shrink:0;cursor:pointer;" });
      _el("div", nameCell, { text: loc.title, style: "font-size:0.8rem;font-weight:600;color:#1e293b;word-break:break-word;" });
      _el("div", nameCell, { text: loc.photos.length + " photo" + (loc.photos.length !== 1 ? "s" : ""), style: "font-size:0.7rem;color:#94a3b8;margin-top:2px;" });

      // Right: photo pool (droppable)
      const pool = _el("div", row, { style: "flex:1;display:flex;flex-wrap:wrap;gap:6px;padding:8px;min-height:60px;align-items:center;align-content:flex-start;" });
      pool.ondragover = (e) => { e.preventDefault(); pool.style.background = "#f0faf4"; };
      pool.ondragleave = () => { pool.style.background = ""; };
      pool.ondrop = (e) => {
        e.preventDefault(); pool.style.background = "";
        const photoId = e.dataTransfer.getData("text/plain");
        const srcLocId = e.dataTransfer.getData("application/x-src-loc");
        if (photoId) movePhoto(photoId, srcLocId, loc.id);
        render();
      };

      // Drop zone for new photos to this location
      const locFi = _el("input", pool); locFi.type = "file"; locFi.accept = "image/*"; locFi.multiple = true; locFi.style.display = "none";
      locFi.onchange = async (e) => { await handlePhotoUpload(e.target.files, loc); render(); };

      if (loc.photos.length === 0) {
        const hint = _el("span", pool, { text: "Drop photos or click +", style: "font-size:0.75rem;color:#94a3b8;cursor:pointer;" });
        hint.onclick = () => locFi.click();
      }

      loc.photos.forEach((ph, pi) => {
        const thumb = _el("div", pool, { style: "width:56px;height:56px;border-radius:4px;background:#e5e7eb;position:relative;overflow:hidden;flex-shrink:0;cursor:grab;" });
        thumb.draggable = true;
        thumb.ondragstart = (e) => { e.dataTransfer.setData("text/plain", ph.id); e.dataTransfer.setData("application/x-src-loc", loc.id); thumb.style.opacity = "0.4"; };
        thumb.ondragend = () => { thumb.style.opacity = "1"; };
        // Load thumbnail
        getPhotoBlobUrl(ph.id).then(url => { if (url) { thumb.style.backgroundImage = "url(" + url + ")"; thumb.style.backgroundSize = "cover"; thumb.style.backgroundPosition = "center"; } });
        // Delete button
        const pDel = _el("div", thumb, { text: "\u00d7", style: "position:absolute;top:1px;right:1px;width:16px;height:16px;border-radius:50%;background:rgba(239,68,68,0.85);color:white;font-size:10px;display:flex;align-items:center;justify-content:center;cursor:pointer;opacity:0;transition:opacity 0.2s;" });
        thumb.onmouseenter = () => { pDel.style.opacity = "1"; };
        thumb.onmouseleave = () => { pDel.style.opacity = "0"; };
        pDel.onclick = (e) => { e.stopPropagation(); loc.photos.splice(pi, 1); deletePhotoFromIDB(ph.id).catch(() => {}); render(); };
      });

      // Add button
      const addPhBtn = _el("div", pool, { text: "+", style: "width:56px;height:56px;border-radius:4px;border:1px dashed #d1d5db;display:flex;align-items:center;justify-content:center;cursor:pointer;color:#94a3b8;font-size:1.2rem;flex-shrink:0;" });
      addPhBtn.onclick = () => locFi.click();
    });
  }

  function movePhoto(photoId, srcLocId, destLocId) {
    if (srcLocId === destLocId) return;
    let photoEntry = null;
    // Remove from source
    for (const loc of locations) {
      const idx = loc.photos.findIndex(p => p.id === photoId);
      if (idx >= 0) { photoEntry = loc.photos.splice(idx, 1)[0]; break; }
    }
    if (!photoEntry) return;
    // Add to destination
    const destLoc = locations.find(l => l.id === destLocId);
    if (destLoc) destLoc.photos.push(photoEntry);
  }

  async function handlePhotoUpload(files, targetLoc) {
    for (const file of files) {
      if (!file.type.startsWith("image/")) continue;
      photoCounter++;
      const id = "photo-" + Date.now() + "-" + photoCounter;
      const compressed = await compressPhoto(file);
      await savePhotoToIDB(id, compressed);
      photoBuffers.set(id, compressed);
      const origBuf = await file.arrayBuffer();
      const exif = extractExifGps(origBuf);
      const entry = { id, title: file.name.replace(/\.[^.]+$/, "").replace(/[_-]/g, " ") };

      if (targetLoc) {
        targetLoc.photos.push(entry);
      } else if (exif.hasGps && locations.length > 0) {
        let nearest = locations[0], minD = Infinity;
        for (const loc of locations) { const d = _haversineKm(exif.lat, exif.lng, loc.lat, loc.lng); if (d < minD) { minD = d; nearest = loc; } }
        nearest.photos.push(entry);
      } else if (locations.length > 0) {
        locations[0].photos.push(entry);
      }
    }
  }

  // ══════════════════════════════════════════════════════════
  // ── Step 4: Blog Sections ──
  // ══════════════════════════════════════════════════════════
  function renderStep4(ct) {
    _el("p", ct, { text: "Organize your journal into sections. Check locations to assign them to each section.", style: "color:#64748b;font-size:0.85rem;margin:0 0 12px;" });

    // Auto-create sections if none exist
    if (sections.length === 0 && locations.length > 0) {
      locations.forEach(loc => {
        secCounter++;
        sections.push({ id: "sec-" + secCounter, title: loc.title, locationIds: [loc.id], text: loc.description || "" });
      });
    }

    // Add section button
    const addSecBtn = _el("button", ct, { text: "+ Add Section", style: "padding:7px 14px;border:1px dashed #2d6a4f;border-radius:8px;background:#f0faf4;color:#2d6a4f;cursor:pointer;font-size:0.8rem;font-weight:500;margin-bottom:14px;" });
    addSecBtn.onclick = () => { secCounter++; sections.push({ id: "sec-" + secCounter, title: "New Section", locationIds: [], text: "" }); render(); };

    // Sort locations by track position if GPX exists
    let sortedLocs = [...locations];
    if (gpxData && gpxData.trackPoints.length > 1) {
      sortedLocs = sortByTrackPos(locations, gpxData.trackPoints);
    }

    // All assigned location IDs (for disabling)
    const allAssigned = new Map(); // locId → secId
    sections.forEach(sec => { sec.locationIds.forEach(lid => allAssigned.set(lid, sec.id)); });

    const secContainer = _el("div", ct, { style: "max-height:400px;overflow-y:auto;" });
    sections.forEach((sec, si) => {
      const block = _el("div", secContainer, { style: "border:1px solid #e5e7eb;border-radius:10px;padding:12px 14px;margin-bottom:10px;background:#fafafa;" });

      // Section header
      const hdr = _el("div", block, { style: "display:flex;gap:8px;align-items:center;margin-bottom:8px;" });
      _el("span", hdr, { text: "###", style: "font-size:0.7rem;font-weight:700;color:#94a3b8;background:#f1f5f9;padding:2px 6px;border-radius:4px;" });
      const secTitle = _el("input", hdr, { style: "flex:1;padding:5px 8px;border:1px solid #d1d5db;border-radius:6px;font-size:0.85rem;font-weight:600;" });
      secTitle.value = sec.title; secTitle.oninput = () => { sec.title = secTitle.value; };
      const secDel = _el("button", hdr, { text: "\u00d7", style: "background:none;border:none;color:#ef4444;font-size:1.2rem;cursor:pointer;padding:0 4px;" });
      secDel.onclick = () => { sections.splice(si, 1); render(); };

      // Location checkboxes
      const cbList = _el("div", block, { style: "display:flex;flex-direction:column;gap:4px;max-height:200px;overflow-y:auto;margin-bottom:8px;padding:4px 0;" });
      sortedLocs.forEach(loc => {
        const isChecked = sec.locationIds.includes(loc.id);
        const assignedElsewhere = allAssigned.has(loc.id) && allAssigned.get(loc.id) !== sec.id;

        const cbRow = _el("div", cbList, { style: "display:flex;gap:8px;align-items:center;padding:4px 6px;border-radius:4px;" + (assignedElsewhere ? "opacity:0.4;" : "cursor:pointer;") + (!assignedElsewhere ? "cursor:pointer;" : "") });
        if (!assignedElsewhere) cbRow.onmouseenter = () => { cbRow.style.background = "#f1f5f9"; };
        if (!assignedElsewhere) cbRow.onmouseleave = () => { cbRow.style.background = ""; };

        const cb = _el("input", cbRow); cb.type = "checkbox"; cb.checked = isChecked; cb.disabled = assignedElsewhere;
        cb.style.cssText = "width:16px;height:16px;accent-color:#2563eb;flex-shrink:0;cursor:" + (assignedElsewhere ? "not-allowed" : "pointer") + ";";

        // Thumbnail
        if (loc.photos.length > 0) {
          const th = _el("div", cbRow, { style: "width:36px;height:36px;border-radius:4px;background:#e5e7eb;flex-shrink:0;background-size:cover;background-position:center;" });
          getPhotoBlobUrl(loc.photos[0].id).then(url => { if (url) th.style.backgroundImage = "url(" + url + ")"; });
        }

        _el("span", cbRow, { text: loc.title, style: "flex:1;font-size:0.8rem;color:#1e293b;" });
        _el("span", cbRow, { text: loc.photos.length + "\uD83D\uDCF7", style: "font-size:0.7rem;color:#94a3b8;" });

        cb.onchange = () => {
          if (cb.checked) { sec.locationIds.push(loc.id); }
          else { sec.locationIds = sec.locationIds.filter(id => id !== loc.id); }
          render();
        };
        if (!assignedElsewhere) cbRow.onclick = (e) => { if (e.target !== cb) { cb.checked = !cb.checked; cb.dispatchEvent(new Event("change")); } };
      });

      // Blog text
      const textArea = _el("textarea", block, { style: "width:100%;box-sizing:border-box;padding:8px 10px;border:1px solid #d1d5db;border-radius:6px;font-size:0.8rem;resize:vertical;min-height:60px;font-family:inherit;" });
      textArea.rows = 3; textArea.placeholder = "Write about this section..."; textArea.value = sec.text;
      textArea.oninput = () => { sec.text = textArea.value; };
    });

    if (sections.length === 0) {
      _el("div", secContainer, { text: "No sections yet. Click '+ Add Section' to create one.", style: "text-align:center;padding:20px;color:#94a3b8;font-size:0.85rem;" });
    }
  }

  function sortByTrackPos(locs, trackPts) {
    const sorted = locs.map(loc => {
      let minD = Infinity, bestIdx = 0;
      for (let i = 0; i < trackPts.length; i += 5) {
        const d = Math.abs(loc.lat - trackPts[i].lat) + Math.abs(loc.lng - trackPts[i].lng);
        if (d < minD) { minD = d; bestIdx = i; }
      }
      // Refine
      const start = Math.max(0, bestIdx - 5), end = Math.min(trackPts.length - 1, bestIdx + 5);
      for (let i = start; i <= end; i++) {
        const d = Math.abs(loc.lat - trackPts[i].lat) + Math.abs(loc.lng - trackPts[i].lng);
        if (d < minD) { minD = d; bestIdx = i; }
      }
      return { loc, idx: bestIdx };
    });
    sorted.sort((a, b) => a.idx - b.idx);
    return sorted.map(s => s.loc);
  }

  // ══════════════════════════════════════════════════════════
  // ── Step 5: Review & Create ──
  // ══════════════════════════════════════════════════════════
  function renderStep5(ct) {
    const totalPhotos = locations.reduce((s, l) => s + l.photos.length, 0);

    // Summary card
    const summary = _el("div", ct, { style: "background:#f0faf4;border-radius:10px;padding:20px;margin-bottom:16px;" });
    _el("div", summary, { text: config.name || "Untitled Trip", style: "font-size:1.1rem;font-weight:700;color:#1e293b;margin-bottom:10px;" });
    const grid = _el("div", summary, { style: "display:grid;grid-template-columns:1fr 1fr;gap:6px;font-size:0.8rem;color:#475569;" });
    grid.innerHTML = `
      <div>Date: <strong>${config.date || "\u2014"}${config.endDate ? " \u2013 " + config.endDate : ""}</strong></div>
      <div>Region: <strong>${config.region || "\u2014"}</strong></div>
      <div>Template: <strong>${config.template}</strong></div>
      <div>Map: <strong>${MAP_STYLES[config.mapStyle]?.name || config.mapStyle}</strong></div>
      <div>Locations: <strong>${locations.length}</strong></div>
      <div>Photos: <strong>${totalPhotos}</strong></div>
      <div>Sections: <strong>${sections.length}</strong></div>
      ${gpxData ? "<div>Distance: <strong>" + gpxData.totalDistanceKm + " km</strong></div>" : ""}
    `;

    // Outline
    _el("h3", ct, { text: "Journal Structure", style: "font-size:0.9rem;font-weight:600;color:#1e293b;margin:16px 0 8px;" });
    const outline = _el("div", ct, { style: "max-height:280px;overflow-y:auto;" });

    if (sections.length > 0) {
      sections.forEach(sec => {
        const secRow = _el("div", outline, { style: "padding:6px 0;border-bottom:1px solid #f1f5f9;" });
        _el("div", secRow, { text: "### " + sec.title, style: "font-size:0.85rem;font-weight:600;color:#1e293b;" });
        const secLocs = locations.filter(l => sec.locationIds.includes(l.id));
        secLocs.forEach(loc => {
          _el("div", secRow, { text: "\u00a0\u00a0\u00a0\u00a0\u{1F4CD} " + loc.title + " (" + loc.photos.length + " photos)", style: "font-size:0.78rem;color:#64748b;margin:2px 0;" });
        });
        if (sec.text) _el("div", secRow, { text: "\u00a0\u00a0\u00a0\u00a0\u270D\uFE0F " + sec.text.slice(0, 60) + (sec.text.length > 60 ? "..." : ""), style: "font-size:0.75rem;color:#94a3b8;font-style:italic;" });
      });
    } else {
      locations.forEach(loc => {
        _el("div", outline, { text: "\u{1F4CD} " + loc.title + " \u2014 " + loc.photos.length + " photos", style: "font-size:0.8rem;color:#475569;padding:4px 0;border-bottom:1px solid #f1f5f9;" });
      });
    }

    if (locations.length === 0 && sections.length === 0) {
      _el("div", outline, { text: "Empty trip. You can still create it and edit later.", style: "text-align:center;padding:16px;color:#94a3b8;font-size:0.85rem;" });
    }
  }

  // ══════════════════════════════════════════════════════════
  // ── Finish: Save Trip ──
  // ══════════════════════════════════════════════════════════
  async function finishWizard() {
    const tripId = "trip-" + Date.now();

    // Build waypoints from sections or locations
    let waypoints;
    if (sections.length > 0) {
      waypoints = [];
      sections.forEach(sec => {
        const secLocs = locations.filter(l => sec.locationIds.includes(l.id));
        secLocs.forEach(loc => {
          waypoints.push({
            id: loc.id, title: loc.title, sectionTitle: sec.title,
            lat: loc.lat, lng: loc.lng, alt: null,
            blog: sec.text || loc.description || "",
            photos: loc.photos.map(p => ({ id: p.id, imageUrl: "idb://" + p.id, title: p.title }))
          });
        });
      });
      // Add locations not in any section
      const assignedIds = new Set(sections.flatMap(s => s.locationIds));
      locations.filter(l => !assignedIds.has(l.id)).forEach(loc => {
        waypoints.push({
          id: loc.id, title: loc.title, sectionTitle: loc.title,
          lat: loc.lat, lng: loc.lng, alt: null, blog: loc.description || "",
          photos: loc.photos.map(p => ({ id: p.id, imageUrl: "idb://" + p.id, title: p.title }))
        });
      });
    } else {
      waypoints = locations.map(loc => ({
        id: loc.id, title: loc.title, sectionTitle: loc.title,
        lat: loc.lat, lng: loc.lng, alt: null, blog: loc.description || "",
        photos: loc.photos.map(p => ({ id: p.id, imageUrl: "idb://" + p.id, title: p.title }))
      }));
    }

    const trip = {
      id: tripId, version: 5, _isLocal: true, _created: Date.now(),
      file: tripId,
      name: config.name || "Untitled Trip",
      date: config.date, region: config.region, description: config.description,
      template: config.template, mapStyle: config.mapStyle,
      stats: gpxData ? { distanceKm: gpxData.totalDistanceKm, elevationGainM: gpxData.elevationGainM, elevationLossM: gpxData.elevationLossM } : {},
      gpxTrack: gpxData ? gpxData.trackPoints : [],
      waypoints
    };

    saveLocalTrip(trip);
    destroyMap();
    overlay.remove();

    tripsData = await loadTripIndex();
    renderTripList();
    openTrip(tripId);
  }

  render();
}


const MAP_STYLES = {
  "opentopomap": {
    name: "OpenTopoMap",
    url: "https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png",
    subs: ["a", "b", "c"],
    filter: "grayscale(100%) contrast(1.5) opacity(0.4)"
  },
  "carto-voyager": {
    name: "CARTO Voyager",
    url: "https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}.png",
    subs: ["a", "b", "c", "d"],
    filter: "opacity(0.45) saturate(0.7)"
  },
  "esri-satellite": {
    name: "Esri Satellite",
    url: "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
    subs: [],
    filter: "opacity(0.5) saturate(0.6)"
  },
  "osm": {
    name: "OpenStreetMap",
    url: "https://tile.openstreetmap.org/{z}/{x}/{y}.png",
    subs: [],
    filter: "grayscale(100%) contrast(1.3) opacity(0.35)"
  },
  "carto-light": {
    name: "CARTO Positron",
    url: "https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}.png",
    subs: ["a", "b", "c", "d"],
    filter: "opacity(0.5)"
  },
  "carto-dark": {
    name: "CARTO Dark Matter",
    url: "https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png",
    subs: ["a", "b", "c", "d"],
    filter: "opacity(0.5)"
  },
  "stamen-toner": {
    name: "Stamen Toner",
    url: "https://tiles.stadiamaps.com/tiles/stamen_toner/{z}/{x}/{y}.png",
    subs: [], needsApiKey: true,
    filter: "opacity(0.4)"
  },
  "stamen-watercolor": {
    name: "Stamen Watercolor",
    url: "https://tiles.stadiamaps.com/tiles/stamen_watercolor/{z}/{x}/{y}.jpg",
    subs: [], needsApiKey: true,
    filter: "opacity(0.5) saturate(0.8)"
  },
  "stamen-terrain": {
    name: "Stamen Terrain",
    url: "https://tiles.stadiamaps.com/tiles/stamen_terrain/{z}/{x}/{y}.png",
    subs: [], needsApiKey: true,
    filter: "opacity(0.45) saturate(0.7)"
  }
};

// === i18n ===
const HJ_LOCALES = {
  en: {
    "sidebar.title": "HikerScrolls",
    "sidebar.subtitle": "Travel stories & trail maps",
    "search.placeholder": "Search trips...",
    "sort.newest": "Newest",
    "sort.az": "A-Z",
    "sort.distance": "Distance",
    "trip.stops": "stops",
    "trip.backToMap": "\u2190 Back to Map",
    "template.scrollytelling": "Scrollytelling",
    "template.scrapbook": "Scrapbook",
    "template.illustrated": "Illustrated Map",
    "scrapbook.hint": "\uD83D\uDDB1\uFE0F Drag Map \u00B7 Tap Photo",
    "scrapbook.viewAll": "\uD83D\uDD0D VIEW ALL",
    "illustrated.hint": "\u2B07\uFE0F Scroll to explore \u00B7 Ctrl+Wheel to zoom",
    "noTrips": "No trips yet",
    "noMatch": "No trips match your search",
    "noGps": "No GPS data.",
    "backToAtlas": "Back to Atlas",
    "lib.trips": "trips",
    "lib.openJournal": "Open Journal",
    "illust.generateSketches": "Generate Pen Drawings",
    "illust.generating": "Generating...",
    "illust.sketchProgress": "Generating {0}/{1}...",
    "illust.sketchDone": "Done!",
    "illust.aiLayout": "AI Layout",
    "illust.aiLayoutDone": "Layout optimized by AI",
    "ai.askingAi": "Asking AI\u2026",
    "ai.setApiKey": "Set Gemini API key to enable AI features",
    "ai.error": "AI error",
    "ai.summary": "AI Summary",
    "ai.summaryTitle": "AI Trip Summary",
    "ai.analyzing": "Analyzing...",
    "settings.title": "Settings",
    "settings.geminiKey": "Gemini API Key",
    "settings.geminiModel": "Gemini Model",
    "settings.stadiaKey": "Stadia Maps API Key",
    "settings.stadiaDesc": "For Stamen Toner / Watercolor map styles. Free at",
    "settings.save": "Save"
  },
  zh: {
    "sidebar.title": "HikerScrolls",
    "sidebar.subtitle": "\u65C5\u884C\u6545\u4E8B\u4E0E\u5F92\u6B65\u5730\u56FE",
    "search.placeholder": "\u641C\u7D22\u65C5\u7A0B...",
    "sort.newest": "\u6700\u65B0",
    "sort.az": "A-Z",
    "sort.distance": "\u8DDD\u79BB",
    "trip.stops": "\u7AD9\u70B9",
    "trip.backToMap": "\u2190 \u8FD4\u56DE\u5730\u56FE",
    "template.scrollytelling": "\u6EDA\u52A8\u53D9\u4E8B",
    "template.scrapbook": "\u526A\u8D34\u7C3F",
    "template.illustrated": "\u624B\u7ED8\u5730\u56FE",
    "scrapbook.hint": "\uD83D\uDDB1\uFE0F \u62D6\u52A8\u5730\u56FE \u00B7 \u70B9\u51FB\u7167\u7247",
    "scrapbook.viewAll": "\uD83D\uDD0D \u67E5\u770B\u5168\u90E8",
    "illustrated.hint": "\u2B07\uFE0F \u6EDA\u52A8\u63A2\u7D22 \u00B7 Ctrl+\u6EDA\u8F6E\u7F29\u653E",
    "noTrips": "\u8FD8\u6CA1\u6709\u65C5\u7A0B",
    "noMatch": "\u6CA1\u6709\u5339\u914D\u7684\u65C5\u7A0B",
    "noGps": "\u6CA1\u6709GPS\u6570\u636E\u3002",
    "backToAtlas": "\u8FD4\u56DE\u5730\u56FE\u96C6",
    "lib.trips": "\u6B21\u65C5\u7A0B",
    "lib.openJournal": "\u6253\u5F00\u65E5\u5FD7",
    "illust.generateSketches": "\u751F\u6210\u94A2\u7B14\u753B",
    "illust.generating": "\u751F\u6210\u4E2D...",
    "illust.sketchProgress": "\u751F\u6210\u4E2D {0}/{1}...",
    "illust.sketchDone": "\u5B8C\u6210\uFF01",
    "illust.aiLayout": "AI \u5E03\u5C40",
    "illust.aiLayoutDone": "AI \u5DF2\u4F18\u5316\u5E03\u5C40",
    "ai.askingAi": "\u6B63\u5728\u8BE2\u95EE AI\u2026",
    "ai.setApiKey": "\u8BBE\u7F6E Gemini API \u5BC6\u94A5\u4EE5\u542F\u7528 AI \u529F\u80FD",
    "ai.error": "AI \u9519\u8BEF",
    "ai.summary": "AI \u6458\u8981",
    "ai.summaryTitle": "AI \u65C5\u884C\u6458\u8981",
    "ai.analyzing": "\u5206\u6790\u4E2D...",
    "settings.title": "\u8BBE\u7F6E",
    "settings.geminiKey": "Gemini API \u5BC6\u94A5",
    "settings.geminiModel": "Gemini \u6A21\u578B",
    "settings.stadiaKey": "Stadia Maps API \u5BC6\u94A5",
    "settings.stadiaDesc": "\u7528\u4E8E Stamen Toner / Watercolor \u5730\u56FE\u6837\u5F0F\u3002\u514D\u8D39\u83B7\u53D6\u4E8E",
    "settings.save": "\u4FDD\u5B58"
  }
};

let _lang = localStorage.getItem("hikerscrolls_lang") || ((navigator.language || "en").startsWith("zh") ? "zh" : "en");
function t(key) {
  const locale = HJ_LOCALES[_lang] || HJ_LOCALES.en;
  return locale[key] || HJ_LOCALES.en[key] || key;
}
function switchLang(lang) {
  _lang = lang;
  localStorage.setItem("hikerscrolls_lang", lang);
  // Re-render sidebar text
  const titleEl = document.getElementById("sidebar-title");
  if (titleEl) titleEl.textContent = t("sidebar.title");
  const subEl = document.getElementById("sidebar-subtitle");
  if (subEl) subEl.textContent = t("sidebar.subtitle");
  const searchEl = document.getElementById("search-input");
  if (searchEl) searchEl.placeholder = t("search.placeholder");
  const sortDate = document.getElementById("sort-date");
  if (sortDate) sortDate.textContent = t("sort.newest");
  const sortName = document.getElementById("sort-name");
  if (sortName) sortName.textContent = t("sort.az");
  const sortDist = document.getElementById("sort-distance");
  if (sortDist) sortDist.textContent = t("sort.distance");
  // Update lang toggle button label
  const langBtn = document.getElementById("lang-toggle");
  if (langBtn) langBtn.textContent = _lang === "zh" ? "EN" : "\u4E2D";
  // Re-render trip list
  renderTripList();
  // Re-render global map stats if visible
  if (globalMap && globalMap._buildStats) globalMap._buildStats();
}



// === AI Settings (multi-provider) ===
const HJ_SETTINGS_KEY = "hikerscrolls_settings";
let _hjProviderMeta = null; // fetched from /api/ai/providers

function getSettings() {
  try {
    const stored = localStorage.getItem(HJ_SETTINGS_KEY);
    if (stored) return JSON.parse(stored);
  } catch (e) {}
  return {
    aiRouting: {
      text: { provider: "gemini", model: "gemini-2.0-flash" },
      vision: { provider: "gemini", model: "gemini-2.0-flash" },
      image: { provider: "gemini", model: "gemini-3.1-flash-image-preview" }
    },
    apiKeys: {},
    stadiaApiKey: ""
  };
}

function saveSettings(settings) {
  localStorage.setItem(HJ_SETTINGS_KEY, JSON.stringify(settings));
}

let _serverStadiaKey = "";
function getStadiaKey() {
  return getSettings().stadiaApiKey || _serverStadiaKey || "";
}

// Fetch server config (Stadia key etc.) on startup
(async function fetchServerConfig() {
  try {
    const r = await fetch("/api/config");
    if (r.ok) {
      const cfg = await r.json();
      if (cfg.stadiaApiKey) _serverStadiaKey = cfg.stadiaApiKey;
    }
  } catch (e) {}
})();

// Unified AI proxy call
async function callAI(capability, payload, overrideProvider, overrideModel) {
  const settings = getSettings();
  const routing = settings.aiRouting || {};
  const provider = overrideProvider || routing[capability]?.provider || "gemini";
  const model = overrideModel || routing[capability]?.model;
  const userApiKey = settings.apiKeys?.[provider] || "";
  const resp = await fetch("/api/ai", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ capability, provider, model, userApiKey: userApiKey || undefined, payload })
  });
  if (!resp.ok) {
    const err = await resp.json().catch(() => ({ error: "API error " + resp.status }));
    throw new Error(err.error || "API error " + resp.status);
  }
  const data = await resp.json();
  return data.result;
}

async function fetchProviderMeta() {
  if (_hjProviderMeta) return _hjProviderMeta;
  try {
    const r = await fetch("/api/ai/providers");
    if (r.ok) _hjProviderMeta = await r.json();
  } catch (e) {}
  return _hjProviderMeta;
}

// === Settings Modal (multi-provider) ===
async function showSettingsModal() {
  const existing = document.querySelector(".hj-settings-overlay");
  if (existing) existing.remove();

  const meta = await fetchProviderMeta();
  const providers = meta?.providers || {};
  const serverAvailable = meta?.serverAvailable || {};

  const overlay = document.createElement("div");
  overlay.className = "hj-settings-overlay";
  overlay.style.cssText = "position:fixed;inset:0;background:rgba(0,0,0,0.5);z-index:10000;display:flex;align-items:center;justify-content:center;";
  overlay.addEventListener("click", (e) => { if (e.target === overlay) overlay.remove(); });

  const modal = document.createElement("div");
  modal.className = "hj-settings-modal";
  modal.style.cssText = "background:white;border-radius:16px;padding:28px 32px;max-width:520px;width:90%;box-shadow:0 16px 48px rgba(0,0,0,0.2);font-family:inherit;max-height:85vh;overflow-y:auto;";

  const title = document.createElement("h2");
  title.textContent = t("settings.title");
  title.style.cssText = "margin:0 0 8px;font-size:1.1rem;font-weight:600;";
  modal.appendChild(title);

  const subtitle = document.createElement("div");
  subtitle.textContent = "Configure AI providers and models for each capability.";
  subtitle.style.cssText = "font-size:0.75rem;color:#888;margin-bottom:20px;";
  modal.appendChild(subtitle);

  const settings = getSettings();
  const routing = settings.aiRouting || {};
  const apiKeys = settings.apiKeys || {};
  const selects = {};

  // Capability routing sections
  const capabilities = [
    { id: "text", label: "Text Analysis", desc: "Trip summaries, location enrichment" },
    { id: "vision", label: "Vision Analysis", desc: "Photo analysis" },
    { id: "image", label: "Image Generation", desc: "Pen sketches, souvenirs" }
  ];

  for (const cap of capabilities) {
    const section = document.createElement("div");
    section.style.cssText = "margin-bottom:16px;padding:12px;background:#f9fafb;border-radius:10px;border:1px solid #e5e7eb;";

    const capLabel = document.createElement("div");
    capLabel.style.cssText = "font-size:0.8rem;font-weight:600;color:#333;margin-bottom:2px;";
    capLabel.textContent = cap.label;
    section.appendChild(capLabel);

    const capDesc = document.createElement("div");
    capDesc.style.cssText = "font-size:0.7rem;color:#999;margin-bottom:8px;";
    capDesc.textContent = cap.desc;
    section.appendChild(capDesc);

    const row = document.createElement("div");
    row.style.cssText = "display:flex;gap:8px;";

    // Provider dropdown
    const provSel = document.createElement("select");
    provSel.style.cssText = "flex:1;padding:6px 8px;border:1px solid #ddd;border-radius:6px;font-size:0.8rem;";
    const currentProv = routing[cap.id]?.provider || "gemini";
    for (const [id, p] of Object.entries(providers)) {
      if (!p.capabilities.includes(cap.id)) continue;
      const opt = document.createElement("option");
      opt.value = id;
      opt.textContent = p.name + (serverAvailable[id] ? " ✓" : "");
      if (id === currentProv) opt.selected = true;
      provSel.appendChild(opt);
    }
    row.appendChild(provSel);

    // Model dropdown
    const modelSel = document.createElement("select");
    modelSel.style.cssText = "flex:1;padding:6px 8px;border:1px solid #ddd;border-radius:6px;font-size:0.8rem;";
    const fillModels = (provId) => {
      modelSel.innerHTML = "";
      const p = providers[provId];
      const models = p?.models?.[cap.id] || [];
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

  // API Keys section
  const keysTitle = document.createElement("div");
  keysTitle.style.cssText = "font-size:0.8rem;font-weight:600;color:#333;margin-bottom:4px;";
  keysTitle.textContent = "API Keys (Optional)";
  modal.appendChild(keysTitle);

  const keysHint = document.createElement("div");
  keysHint.style.cssText = "font-size:0.7rem;color:#888;margin-bottom:12px;";
  keysHint.textContent = "Leave blank to use server default (rate limited). Provide your own key for unlimited access.";
  modal.appendChild(keysHint);

  const keyInputs = {};
  const keyProviders = [
    { id: "gemini", name: "Gemini", placeholder: "AIza..." },
    { id: "claude", name: "Claude", placeholder: "sk-ant-..." },
    { id: "openai", name: "OpenAI", placeholder: "sk-..." },
    { id: "qwen", name: "Qwen", placeholder: "sk-..." },
    { id: "kimi", name: "Kimi", placeholder: "sk-..." },
    { id: "deepseek", name: "Deepseek", placeholder: "sk-..." },
    { id: "minimax", name: "MiniMax", placeholder: "..." },
    { id: "seedream", name: "Seedream", placeholder: "..." }
  ];
  for (const kp of keyProviders) {
    const row = document.createElement("div");
    row.style.cssText = "display:flex;align-items:center;gap:8px;margin-bottom:6px;";
    const label = document.createElement("div");
    label.style.cssText = "width:70px;font-size:0.75rem;color:#555;flex-shrink:0;";
    label.textContent = kp.name;
    row.appendChild(label);
    const input = document.createElement("input");
    input.type = "password";
    input.value = apiKeys[kp.id] || "";
    input.placeholder = kp.placeholder;
    input.style.cssText = "flex:1;padding:6px 8px;border:1px solid #ddd;border-radius:6px;font-size:0.8rem;";
    row.appendChild(input);
    keyInputs[kp.id] = input;
    modal.appendChild(row);
  }

  // Divider
  modal.appendChild(Object.assign(document.createElement("hr"), { style: "border:none;border-top:1px solid #eee;margin:16px 0;" }));

  // Stadia Maps
  const stadiaLabel = document.createElement("label");
  stadiaLabel.textContent = "Stadia Maps API Key";
  stadiaLabel.style.cssText = "display:block;font-size:0.75rem;font-weight:500;margin-bottom:4px;color:#555;";
  modal.appendChild(stadiaLabel);
  const stadiaInput = document.createElement("input");
  stadiaInput.type = "password";
  stadiaInput.value = settings.stadiaApiKey || "";
  stadiaInput.placeholder = "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx";
  stadiaInput.style.cssText = "width:100%;box-sizing:border-box;padding:6px 8px;border:1px solid #ddd;border-radius:6px;font-size:0.8rem;margin-bottom:16px;";
  modal.appendChild(stadiaInput);

  // Save button
  const saveBtn = document.createElement("button");
  saveBtn.textContent = t("settings.save");
  saveBtn.style.cssText = "width:100%;padding:10px;background:#6366f1;color:white;border:none;border-radius:8px;font-size:0.85rem;cursor:pointer;font-weight:500;";
  saveBtn.addEventListener("click", () => {
    const newRouting = {};
    for (const cap of capabilities) {
      newRouting[cap.id] = { provider: selects[cap.id].prov.value, model: selects[cap.id].model.value };
    }
    const newKeys = {};
    for (const kp of keyProviders) {
      const v = keyInputs[kp.id].value.trim();
      if (v) newKeys[kp.id] = v;
    }
    saveSettings({ aiRouting: newRouting, apiKeys: newKeys, stadiaApiKey: stadiaInput.value.trim() });
    overlay.remove();
  });
  modal.appendChild(saveBtn);

  overlay.appendChild(modal);
  document.body.appendChild(overlay);
}

// === AI Helpers (via /api/ai proxy) ===
async function enrichLocationWithGemini(lat, lng, locationName) {
  const prompt = `You are a travel guide assistant. Provide brief, interesting information about this location:
Name: ${locationName}
Coordinates: ${lat}, ${lng}

Return ONLY a valid JSON object (no markdown):
{
  "description": "<2-3 sentences of interesting facts, history, or travel tips>",
  "category": "<e.g. Mountain, Temple, City, Waterfall, Viewpoint, etc.>",
  "highlights": ["<highlight 1>", "<highlight 2>", "<highlight 3>"]
}`;
  const result = await callAI("text", { userPrompt: prompt, temperature: 0.7 });
  const text = result.text || "";
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error("No JSON in response");
  return JSON.parse(jsonMatch[0]);
}

async function summarizeTripWithGemini(trip) {
  const prompt = `You are a travel storyteller. Summarize this hiking/travel journey in 2-3 sentences, make it vivid and inspiring.
Trip: ${trip.name}
Region: ${trip.region || "Unknown"}
Date: ${trip.date || "Unknown"}
Distance: ${trip.stats?.distanceKm ? trip.stats.distanceKm.toFixed(1) + " km" : "Unknown"}
Waypoints: ${trip.waypoints?.length || 0}

Write a brief, engaging summary in the same language as the trip name. If the name is in Chinese, write in Chinese. If in English, write in English.`;
  const result = await callAI("text", { userPrompt: prompt, temperature: 0.8 });
  return (result.text || "").trim();
}

async function layoutWithGemini(pts, mapW, mapH, photoW, photoH, sketchW, sketchH) {
  const pointsDesc = pts.map((p, i) => ({
    idx: i, name: p.title || "Location " + (i + 1),
    x: Math.round(p.x), y: Math.round(p.y),
    hasPhoto: !!(p.photos && p.photos.length > 0)
  }));
  const prompt = `You are a graphic designer laying out a travel journal illustrated map.

Map canvas size: ${Math.round(mapW)} x ${Math.round(mapH)} pixels.
Photo card size: ${photoW} x ${photoH} pixels.
Sketch card size: ${sketchW} x ${sketchH} pixels.

Route waypoints (these are the GPS dots on the map that cards connect to):
${JSON.stringify(pointsDesc)}

Place a photo card and a sketch card for EACH waypoint. Rules:
1. Cards should be placed to the LEFT or RIGHT of their waypoint, alternating sides along the route for visual balance.
2. Photo and sketch for the same location should be on the SAME side, with sketch placed near (below or beside) the photo.
3. Keep cards within the map bounds (leave 20px margin from edges).
4. Cards must NOT overlap each other. Minimum gap between any two cards: 30px.
5. Cards should be close to their waypoint but not on top of the route line (offset 150-300px to the side).
6. Each card gets a slight random rotation (-4 to +4 degrees) for a hand-drawn feel.
7. Think about overall visual composition — avoid clustering, use the full map space.

Return ONLY valid JSON (no markdown), an array with one object per waypoint:
[{"idx":0,"photoX":100,"photoY":200,"photoRot":-2,"sketchX":100,"sketchY":340,"sketchRot":1}, ...]

The x,y coordinates are the CENTER of each card.`;
  const result = await callAI("text", { userPrompt: prompt, temperature: 0.3 });
  const text = result.text || "";
  const m = text.match(/\[[\s\S]*\]/);
  if (!m) throw new Error("No JSON array in layout response");
  return JSON.parse(m[0]);
}

async function generatePhotoSketch(photoBase64, photoMimeType) {
  const prompt = `Convert this photo into a pen and ink drawing (钢笔画 style) suitable for a travel journal illustration.

CRITICAL RULES:
- Background MUST be pure white (#FFFFFF) — NO paper texture, NO cream tint, NO notebook/sketchbook frame, NO shadows on background
- Clean black pen outlines only, like an architectural sketch
- Use varied line weight: thicker outlines for main shapes, thinner lines for details
- Fine hatching and cross-hatching for depth and shading
- NO solid black fills — use line density for dark areas
- The drawing should be recognizable as the original subject
- Style reference: urban sketching / travel journal pen illustration
- NO text, NO labels, NO signatures, NO borders, NO frames, NO sketchbook edges
- Output the drawing directly on a flat pure white background`;

  const result = await callAI("image", {
    parts: [
      { inlineData: { mimeType: photoMimeType, data: photoBase64 } },
      { text: prompt }
    ]
  });
  if (!result || !result.base64) throw new Error("No image in response");
  return { base64: result.base64, mimeType: result.mime || "image/png" };
}

// === DOM Helpers ===
function createDiv(parent, opts = {}) {
  const div = document.createElement("div");
  if (opts.cls) div.className = opts.cls;
  if (opts.text) div.textContent = opts.text;
  if (opts.attr) for (const [k, v] of Object.entries(opts.attr)) div.setAttribute(k, v);
  if (parent) parent.appendChild(div);
  return div;
}

function createEl(parent, tag, opts = {}) {
  const el = document.createElement(tag);
  if (opts.cls) el.className = opts.cls;
  if (opts.text) el.textContent = opts.text;
  if (opts.value !== undefined) el.value = opts.value;
  if (opts.attr) for (const [k, v] of Object.entries(opts.attr)) el.setAttribute(k, v);
  if (parent) parent.appendChild(el);
  return el;
}

// === Projection Math ===
function lon2t(lon, z) {
  return (lon + 180) / 360 * (1 << z);
}

function lat2t(lat, z) {
  return (1 - Math.log(Math.tan(lat * Math.PI / 180) + 1 / Math.cos(lat * Math.PI / 180)) / Math.PI) / 2 * (1 << z);
}

function autoZoom(latSpan, lngSpan, minZ, maxZ) {
  const lo = minZ || 11, hi = maxZ || 15;
  const narrow = Math.min(latSpan, lngSpan);
  let z;
  if (narrow > 100) z = 2;
  else if (narrow > 50) z = 3;
  else if (narrow > 25) z = 4;
  else if (narrow > 10) z = 5;
  else if (narrow > 5) z = 6;
  else if (narrow > 2) z = 7;
  else if (narrow > 1) z = 8;
  else if (narrow > 0.4) z = 11;
  else if (narrow > 0.2) z = 12;
  else if (narrow > 0.1) z = 13;
  else if (narrow > 0.04) z = 14;
  else z = 15;
  z = Math.max(lo, Math.min(hi, z));
  const wide = Math.max(latSpan, lngSpan);
  if (wide > 1 && z > 11) z = Math.max(lo, 11);
  else if (wide > 0.5 && z > 12) z = Math.max(lo, 12);
  return z;
}

function buildGeo(bounds, zoomOverride) {
  const latSpan = bounds.north - bounds.south;
  const lngSpan = bounds.east - bounds.west;
  const zoom = zoomOverride || autoZoom(latSpan, lngSpan);
  const pad = 0.15;
  const rMinTX = lon2t(bounds.west - lngSpan * pad, zoom);
  const rMaxTX = lon2t(bounds.east + lngSpan * pad, zoom);
  const rMinTY = lat2t(bounds.north + latSpan * pad, zoom);
  const rMaxTY = lat2t(bounds.south - latSpan * pad, zoom);
  return { zoom, w: (rMaxTX - rMinTX) * TILE, h: (rMaxTY - rMinTY) * TILE, minTX: rMinTX, minTY: rMinTY };
}

function proj(lat, lng, g) {
  return { x: (lon2t(lng, g.zoom) - g.minTX) * TILE, y: (lat2t(lat, g.zoom) - g.minTY) * TILE };
}

function projectTrack(track, g) {
  const route = track.map(p => proj(p.lat, p.lng, g));
  const dists = [0];
  let total = 0;
  for (let i = 1; i < route.length; i++) {
    total += Math.hypot(route[i].x - route[i - 1].x, route[i].y - route[i - 1].y);
    dists.push(total);
  }
  return { route, dists, total };
}

function nearestIdx(wp, route) {
  let best = 0, bestD = Infinity;
  for (let i = 0; i < route.length; i++) {
    const d = (wp.x - route[i].x) ** 2 + (wp.y - route[i].y) ** 2;
    if (d < bestD) { bestD = d; best = i; }
  }
  return best;
}

function interpAt(dist, route, dists) {
  if (dist <= 0) return route[0];
  if (dist >= dists[dists.length - 1]) return route[route.length - 1];
  for (let k = 1; k < route.length; k++) {
    if (dists[k] >= dist) {
      const seg = dists[k] - dists[k - 1];
      const t = seg === 0 ? 0 : (dist - dists[k - 1]) / seg;
      return {
        x: route[k - 1].x + (route[k].x - route[k - 1].x) * t,
        y: route[k - 1].y + (route[k].y - route[k - 1].y) * t
      };
    }
  }
  return route[route.length - 1];
}

// === SVG Helpers ===
function S(tag, attrs, parent) {
  const el = document.createElementNS("http://www.w3.org/2000/svg", tag);
  if (attrs) for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  if (parent) parent.appendChild(el);
  return el;
}

// === Shared: prepare waypoints + geo from trip data ===
function prepareTrip(trip) {
  const gpxTrack = trip.gpxTrack || [];
  const hasGpx = gpxTrack.length >= 2;
  let wps = (trip.waypoints || []).filter(w => w.lat && w.lng);

  if (!wps.length && hasGpx) {
    wps = generateTrackStops(gpxTrack, trip.stats?.distanceKm || 0);
  }
  if (!wps.length && !hasGpx) return null;
  if (!wps.length) {
    wps = [
      { id: "start", lat: gpxTrack[0].lat, lng: gpxTrack[0].lng, alt: gpxTrack[0].ele, title: "Start", photos: [] },
      { id: "end", lat: gpxTrack[gpxTrack.length - 1].lat, lng: gpxTrack[gpxTrack.length - 1].lng, alt: gpxTrack[gpxTrack.length - 1].ele, title: "Finish", photos: [] }
    ];
  }

  const allLats = wps.map(w => w.lat);
  const allLngs = wps.map(w => w.lng);
  if (hasGpx) { for (const tp of gpxTrack) { allLats.push(tp.lat); allLngs.push(tp.lng); } }

  const pad = 0.01;
  const bounds = {
    north: Math.max(...allLats) + pad, south: Math.min(...allLats) - pad,
    east: Math.max(...allLngs) + pad, west: Math.min(...allLngs) - pad
  };
  const geo = buildGeo(bounds);

  let route = [], routeDists = [], totalDist = 0;
  if (hasGpx) {
    const pt = projectTrack(gpxTrack, geo);
    route = pt.route; routeDists = pt.dists; totalDist = pt.total;
  }

  const pts = wps.map(w => {
    const xy = proj(w.lat, w.lng, geo);
    let pathIdx = 0, trackDist = 0;
    if (hasGpx) {
      pathIdx = nearestIdx(xy, route);
      trackDist = routeDists[pathIdx];
    }
    return { ...w, ...xy, pathIdx, trackDist };
  });
  if (hasGpx) pts.sort((a, b) => a.pathIdx - b.pathIdx);

  return { pts, geo, route, routeDists, totalDist, hasGpx, gpxTrack };
}

function generateTrackStops(track, totalKm) {
  if (track.length < 2) return [];
  const R = 6371;
  const dists = [0];
  let cumDist = 0;
  for (let i = 1; i < track.length; i++) {
    const dLat = (track[i].lat - track[i - 1].lat) * Math.PI / 180;
    const dLon = (track[i].lng - track[i - 1].lng) * Math.PI / 180;
    const a = Math.sin(dLat / 2) ** 2 + Math.cos(track[i - 1].lat * Math.PI / 180) * Math.cos(track[i].lat * Math.PI / 180) * Math.sin(dLon / 2) ** 2;
    cumDist += R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    dists.push(cumDist);
  }
  const actualKm = totalKm > 0 ? totalKm : cumDist;
  const numStops = Math.max(3, Math.min(10, Math.round(actualKm / 1.5)));
  const stops = [];
  for (let s = 0; s < numStops; s++) {
    const frac = s / (numStops - 1);
    const targetDist = frac * cumDist;
    let lat = track[0].lat, lng = track[0].lng, ele = track[0].ele;
    for (let k = 1; k < track.length; k++) {
      if (dists[k] >= targetDist) {
        const seg = dists[k] - dists[k - 1];
        const t = seg === 0 ? 0 : (targetDist - dists[k - 1]) / seg;
        lat = track[k - 1].lat + (track[k].lat - track[k - 1].lat) * t;
        lng = track[k - 1].lng + (track[k].lng - track[k - 1].lng) * t;
        if (track[k - 1].ele != null && track[k].ele != null) {
          ele = track[k - 1].ele + (track[k].ele - track[k - 1].ele) * t;
        }
        break;
      }
    }
    const km = frac * actualKm;
    let title;
    if (s === 0) title = "Start";
    else if (s === numStops - 1) title = "Finish";
    else title = `${km.toFixed(1)} km`;
    stops.push({
      id: `track-stop-${s}`, lat, lng,
      alt: ele != null ? Math.round(ele) : undefined,
      title, description: s === 0 ? "Beginning of route" : s === numStops - 1 ? "End of route" : `${km.toFixed(1)} km along the route`,
      photos: []
    });
  }
  return stops;
}

// === Shared: build map style switcher ===
function buildMapSwitcher(parent, currentStyle, onChange) {
  const wrap = createDiv(parent, { cls: "hj-map-switcher" });
  const select = createEl(wrap, "select", { cls: "hj-map-switcher-select" });
  for (const [key, style] of Object.entries(MAP_STYLES)) {
    const opt = createEl(select, "option", { text: style.name });
    opt.value = key;
    if (key === currentStyle) opt.selected = true;
  }
  select.addEventListener("change", () => onChange(select.value));
  return wrap;
}

// === Shared: build template switcher ===
function buildTemplateSwitcher(parent, currentTemplate, onChange) {
  const wrap = createDiv(parent, { cls: "hj-template-switcher" });
  const select = createEl(wrap, "select", { cls: "hj-template-switcher-select" });
  const templates = [
    { value: "scrollytelling", label: t("template.scrollytelling") },
    { value: "scrapbook", label: t("template.scrapbook") },
    { value: "illustrated", label: t("template.illustrated") }
  ];
  for (const tmpl of templates) {
    const opt = createEl(select, "option", { text: tmpl.label });
    opt.value = tmpl.value;
    if (tmpl.value === (currentTemplate || "scrollytelling")) opt.selected = true;
  }
  select.addEventListener("change", () => onChange(select.value));
  return wrap;
}

// ============================================================
//  SCROLLYTELLING VIEWER
// ============================================================
class ScrollytellingViewer {
  constructor(container) {
    this.container = container;
    this.pts = [];
    this.route = [];
    this.routeDists = [];
    this.totalDist = 0;
    this.hasTrack = false;
    this.cards = [];
    this.tilePool = [];
    this.pathLine = null;
    this.segs = [];
    this.raf = 0;
    this.cx = 0; this.cy = 0;
    this.kx = 0; this.ky = 0;
    this.ai = 0;
    this.cones = [];
    this.coneSvg = null;
    this.mainSvg = null;
    this.bubble = null;
    this.userScale = 1;
    this.userOffX = 0;
    this.userOffY = 0;
    this.userPanning = false;
    this._dragState = null;
    this._panTimer = null;
    this._cleanupMapListeners = null;
    this._resizeObs = null;
  }

  loadTrip(data, onBack, onSwitchTemplate) {
    this.trip = data;
    this.onBack = onBack;
    this.onSwitchTemplate = onSwitchTemplate;
    this.rebuild();
  }

  destroy() {
    if (this.raf) cancelAnimationFrame(this.raf);
    this.raf = 0;
    this.tilePool = [];
    this.cards = [];
    this.segs = [];
    this.pathLine = null;
    if (this.bubble) { this.bubble.remove(); this.bubble = null; }
    if (this._cleanupMapListeners) this._cleanupMapListeners();
    if (this._panTimer) clearTimeout(this._panTimer);
    if (this._resizeObs) this._resizeObs.disconnect();
    this.container.innerHTML = "";
  }

  rebuild() {
    const c = this.container;
    c.innerHTML = "";
    if (this.raf) cancelAnimationFrame(this.raf);

    const trip = this.trip;
    if (!trip) { createDiv(c, { text: t("noGps"), cls: "hj-empty" }); return; }

    const prepared = prepareTrip(trip);
    if (!prepared) { createDiv(c, { text: t("noGps"), cls: "hj-empty" }); return; }

    Object.assign(this, prepared);
    this.hasTrack = this.hasGpx;
    this.mapStyle = trip.mapStyle || "opentopomap";
    this.tripVersion = trip.version || 5;

    this.cx = 0; this.cy = 0;
    this.kx = this.pts[0].x;
    this.ky = this.pts[0].y;
    this.ai = 0;
    this.cards = [];
    this.cardCtrs = [];
    this.dotRefs = [];
    this.segs = [];
    this.tilePool = [];
    this.pathLine = null;
    this._lastTileCx = -9999;
    this._lastTileCy = -9999;
    this._svgRect = null;

    // Build DOM
    const wrap = createDiv(c, { cls: "hj-wrapper" });
    this.scrollEl = createDiv(wrap, { cls: "hj-scroll" });

    const backBtn = createDiv(this.scrollEl, { text: t("trip.backToMap"), cls: "hj-back-btn" });
    backBtn.addEventListener("click", () => this.onBack());

    this.mkHeader(this.scrollEl, trip);

    let lastSection = "";
    for (let i = 0; i < this.pts.length; i++) {
      if (this.tripVersion >= 5 && this.pts[i].sectionTitle && this.pts[i].sectionTitle !== lastSection) {
        lastSection = this.pts[i].sectionTitle;
        const secHeader = createDiv(this.scrollEl, { cls: "hj-section-divider" });
        createEl(secHeader, "h2", { text: lastSection, cls: "hj-section-divider-title" });
      }
      this.cards.push(this.mkCard(this.scrollEl, this.pts[i], i));
    }

    // SVG Map
    this.svgBox = createDiv(wrap, { cls: "hj-map" });
    const svg = S("svg", {
      viewBox: `0 0 ${this.geo.w} ${this.geo.h}`,
      preserveAspectRatio: "xMidYMid slice",
      class: "hj-fullsvg",
      style: "overflow:visible"
    });
    this.svgBox.appendChild(svg);
    this.mainSvg = svg;

    const defs = S("defs", {}, svg);
    const gf = S("filter", { id: "glow", x: "-20%", y: "-20%", width: "140%", height: "140%" }, defs);
    S("feGaussianBlur", { stdDeviation: "3", result: "b" }, gf);
    S("feComposite", { in: "SourceGraphic", in2: "b", operator: "over" }, gf);
    const lg = S("filter", { id: "lGlow" }, defs);
    S("feGaussianBlur", { stdDeviation: "1.5", result: "cb" }, lg);
    const fm = S("feMerge", {}, lg);
    S("feMergeNode", { in: "cb" }, fm);
    S("feMergeNode", { in: "SourceGraphic" }, fm);

    this.mGrp = S("g", {}, svg);

    const tileFilter = (MAP_STYLES[this.mapStyle] || MAP_STYLES["opentopomap"]).filter;
    this.tileGroup = S("g", { style: `mix-blend-mode:multiply; filter:${tileFilter};` }, this.mGrp);
    for (let i = 0; i < POOL; i++) {
      const img = S("image", { width: `${TILE + 0.5}`, height: `${TILE + 0.5}`, preserveAspectRatio: "none", style: "display:none" }, this.tileGroup);
      this.tilePool.push(img);
    }

    this.mkRoute(this.mGrp);
    this.mkDots(this.mGrp);

    // Cone shadow layer
    const coneSvg = S("svg", {
      viewBox: `0 0 ${this.geo.w} ${this.geo.h}`,
      preserveAspectRatio: "xMidYMid slice",
      class: "hj-fullsvg hj-cone-layer",
      style: "overflow:visible"
    });
    wrap.appendChild(coneSvg);
    const coneDefs = S("defs", {}, coneSvg);
    const coneGrad = S("linearGradient", { id: "coneG", x1: "0%", y1: "50%", x2: "100%", y2: "50%" }, coneDefs);
    S("stop", { offset: "0%", "stop-color": "rgba(0,0,0,0.18)" }, coneGrad);
    S("stop", { offset: "100%", "stop-color": "rgba(0,0,0,0)" }, coneGrad);
    this.coneSvg = coneSvg;
    this.cones = [];

    // Map style switcher
    buildMapSwitcher(wrap, this.mapStyle, (key) => this.switchMapStyle(key));

    this.svgBox.addEventListener("click", (e) => {
      if (e.target.tagName === "svg") this.rmBubble();
    });

    this._setupMapInteraction();
    this._cacheCardCtrs();
    this._svgRect = this.svgBox.getBoundingClientRect();
    this._resizeObs = new ResizeObserver(() => {
      this._cacheCardCtrs();
      this._svgRect = this.svgBox.getBoundingClientRect();
    });
    this._resizeObs.observe(this.scrollEl);
    this._resizeObs.observe(this.svgBox);

    this.syncCards(-1, 0);
    this.syncDots(-1, 0);
    this.startLoop();
  }

  _setupMapInteraction() {
    this.userScale = 1; this.userOffX = 0; this.userOffY = 0;
    this.userPanning = false; this._dragState = null;
    this.svgBox.style.cursor = "grab";

    this.svgBox.addEventListener("mousedown", (e) => {
      if (e.button !== 0) return;
      e.preventDefault();
      this._dragState = { x: e.clientX, y: e.clientY };
      this.userPanning = true;
      this.svgBox.style.cursor = "grabbing";
      if (this._panTimer) clearTimeout(this._panTimer);
    });

    const onMouseMove = (e) => {
      if (!this._dragState) return;
      const sr = this.svgBox.getBoundingClientRect();
      const vbW = this.geo.w / this.userScale;
      const sc = Math.max(sr.width / vbW, sr.height / (this.geo.h / this.userScale));
      this.userOffX += (e.clientX - this._dragState.x) / sc;
      this.userOffY += (e.clientY - this._dragState.y) / sc;
      this._dragState.x = e.clientX;
      this._dragState.y = e.clientY;
    };

    const onMouseUp = () => {
      if (!this._dragState) return;
      this._dragState = null;
      this.svgBox.style.cursor = "grab";
      this._panTimer = setTimeout(() => { this.userPanning = false; }, 3000);
    };

    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp);

    this.svgBox.addEventListener("wheel", (e) => {
      e.preventDefault();
      const factor = e.deltaY > 0 ? 0.9 : 1.1;
      this.userScale = Math.max(0.5, Math.min(5, this.userScale * factor));
      this.updateMapViewBox();
      this.userPanning = true;
      if (this._panTimer) clearTimeout(this._panTimer);
      this._panTimer = setTimeout(() => { this.userPanning = false; }, 3000);
    }, { passive: false });

    this.svgBox.addEventListener("dblclick", (e) => {
      e.preventDefault();
      this.userScale = 1; this.userOffX = 0; this.userOffY = 0;
      this.userPanning = false;
      if (this._panTimer) clearTimeout(this._panTimer);
      this.updateMapViewBox();
    });

    // Touch support
    let lastTouchDist = 0;
    this.svgBox.addEventListener("touchstart", (e) => {
      if (e.touches.length === 2) {
        const dx = e.touches[0].clientX - e.touches[1].clientX;
        const dy = e.touches[0].clientY - e.touches[1].clientY;
        lastTouchDist = Math.hypot(dx, dy);
      } else if (e.touches.length === 1) {
        this._dragState = { x: e.touches[0].clientX, y: e.touches[0].clientY };
        this.userPanning = true;
        if (this._panTimer) clearTimeout(this._panTimer);
      }
    }, { passive: true });

    this.svgBox.addEventListener("touchmove", (e) => {
      if (e.touches.length === 2) {
        e.preventDefault();
        const dx = e.touches[0].clientX - e.touches[1].clientX;
        const dy = e.touches[0].clientY - e.touches[1].clientY;
        const dist = Math.hypot(dx, dy);
        if (lastTouchDist > 0) {
          this.userScale = Math.max(0.5, Math.min(5, this.userScale * (dist / lastTouchDist)));
          this.updateMapViewBox();
        }
        lastTouchDist = dist;
      } else if (e.touches.length === 1 && this._dragState) {
        const sr = this.svgBox.getBoundingClientRect();
        const vbW = this.geo.w / this.userScale;
        const sc = Math.max(sr.width / vbW, sr.height / (this.geo.h / this.userScale));
        this.userOffX += (e.touches[0].clientX - this._dragState.x) / sc;
        this.userOffY += (e.touches[0].clientY - this._dragState.y) / sc;
        this._dragState.x = e.touches[0].clientX;
        this._dragState.y = e.touches[0].clientY;
      }
    }, { passive: false });

    this.svgBox.addEventListener("touchend", () => {
      lastTouchDist = 0;
      this._dragState = null;
      this._panTimer = setTimeout(() => { this.userPanning = false; }, 3000);
    }, { passive: true });

    this._cleanupMapListeners = () => {
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
    };
  }

  updateMapViewBox() {
    const s = this.userScale;
    const vbW = this.geo.w / s, vbH = this.geo.h / s;
    const vbX = this.geo.w * CAM_OX * (1 - 1 / s);
    const vbY = this.geo.h * CAM_OY * (1 - 1 / s);
    const vb = `${vbX} ${vbY} ${vbW} ${vbH}`;
    this.mainSvg.setAttribute("viewBox", vb);
    this.coneSvg.setAttribute("viewBox", vb);
    this._lastTileCx = -9999;
  }

  switchMapStyle(styleKey) {
    const ms = MAP_STYLES[styleKey];
    if (!ms) return;
    this.mapStyle = styleKey;
    if (this.tileGroup) this.tileGroup.setAttribute("style", `mix-blend-mode:multiply; filter:${ms.filter};`);
    for (const node of this.tilePool) { node.removeAttribute("href"); node.style.display = "none"; }
    this._lastTileCx = -9999;
  }

  mkRoute(g) {
    if (this.hasTrack) {
      const pts = this.route.map(p => `${p.x},${p.y}`).join(" ");
      S("polyline", { points: pts, fill: "none", stroke: "#cbd5e1", "stroke-width": "2.5", "stroke-dasharray": "6,6", "stroke-linecap": "round", "stroke-linejoin": "round" }, g);
      this.pathLine = S("polyline", { points: pts, fill: "none", stroke: "#ef4444", "stroke-width": "3.5", "stroke-linecap": "round", "stroke-linejoin": "round", filter: "url(#lGlow)" }, g);
      this.pathLine.style.strokeDasharray = `${this.totalDist}`;
      this.pathLine.style.strokeDashoffset = `${this.totalDist}`;
    } else {
      for (let i = 0; i < this.pts.length - 1; i++) {
        const a = this.pts[i], b = this.pts[i + 1];
        const sg = S("g", {}, g);
        S("line", { x1: `${a.x}`, y1: `${a.y}`, x2: `${b.x}`, y2: `${b.y}`, stroke: "#cbd5e1", "stroke-width": "2", "stroke-dasharray": "4,6", "stroke-linecap": "round" }, sg);
        const rl = S("line", { x1: `${a.x}`, y1: `${a.y}`, x2: `${b.x}`, y2: `${b.y}`, stroke: "#ef4444", "stroke-width": "3", "stroke-linecap": "round", filter: "url(#lGlow)" }, sg);
        rl.style.strokeDasharray = "0";
        rl.style.strokeDashoffset = "0";
        this.segs[i] = rl;
      }
    }
  }

  mkDots(g) {
    if (this.hasTrack && this.route.length >= 2) {
      const startPt = this.route[0];
      const endPt = this.route[this.route.length - 1];
      S("text", { x: `${startPt.x - 25}`, y: `${startPt.y - 18}`, "font-size": "10", fill: "#dc2626", "font-weight": "bold", "letter-spacing": "1", class: "hj-noptr" }, g).textContent = "START";
      S("circle", { cx: `${startPt.x}`, cy: `${startPt.y}`, r: "4", fill: "#dc2626" }, g);
      S("text", { x: `${endPt.x - 28}`, y: `${endPt.y - 18}`, "font-size": "10", fill: "#dc2626", "font-weight": "bold", "letter-spacing": "1", class: "hj-noptr" }, g).textContent = "FINISH";
      S("circle", { cx: `${endPt.x}`, cy: `${endPt.y}`, r: "4", fill: "#dc2626" }, g);
    }
    for (let i = 0; i < this.pts.length; i++) {
      const p = this.pts[i];
      const dg = S("g", { transform: `translate(${p.x},${p.y})`, "data-idx": `${i}` }, g);
      const h = S("g", { class: "hj-hit" }, dg);
      S("circle", { r: "30", fill: "transparent" }, h);
      S("circle", { r: "16", fill: "none", stroke: "#dc2626", "stroke-width": "1.5", class: "hj-ping", opacity: "0" }, h);
      const dot = S("circle", { r: "4", fill: "#475569", class: "hj-dot" }, h);
      const tLabel = p.title.split(" ")[0] || p.title;
      const lbl = S("text", { x: "16", y: "5", "font-size": "12", "font-weight": "500", fill: "#64748b", class: "hj-lbl hj-noptr" }, h);
      lbl.textContent = tLabel;
      this.dotRefs[i] = { dot, ping: h.querySelector(".hj-ping"), lbl };
      h.addEventListener("click", (e) => { e.stopPropagation(); this.tapDot(i); });
    }
  }

  mkHeader(el, trip) {
    const h = createDiv(el, { cls: "hj-header" });
    createEl(h, "h1", { text: trip.name, cls: "hj-title" });
    const sub = [];
    if (trip.region) sub.push(trip.region);
    if (trip.date) sub.push(trip.date);
    if (sub.length) createEl(h, "p", { text: sub.join(" \u00B7 "), cls: "hj-subtitle" });
    createDiv(h, { cls: "hj-divider" });
    if (trip.stats && (trip.stats.distanceKm || trip.stats.elevationGainM)) {
      const s = createDiv(h, { cls: "hj-stats" });
      if (trip.stats.distanceKm) createEl(s, "span", { text: `\uD83D\uDCCF ${trip.stats.distanceKm} km` });
      if (trip.stats.elevationGainM) createEl(s, "span", { text: `\u2B06\uFE0F ${trip.stats.elevationGainM}m` });
      if (trip.stats.elevationLossM) createEl(s, "span", { text: `\u2B07\uFE0F ${trip.stats.elevationLossM}m` });
      createEl(s, "span", { text: `\uD83D\uDCF8 ${(trip.waypoints || []).length} ${t("trip.stops")}` });
    }
    if (trip.description) createEl(h, "p", { text: trip.description, cls: "hj-header-desc" });
    buildTemplateSwitcher(h, trip.template, (tmpl) => this.onSwitchTemplate(tmpl));
  }

  mkCard(el, p, i) {
    const card = createDiv(el, { cls: "hj-card", attr: { "data-i": `${i}` } });
    const photos = p.photos && p.photos.length > 0 ? p.photos : [];
    const hasImage = photos.length > 0;

    if (hasImage) {
      const iw = createDiv(card, { cls: "hj-img-wrap hj-cone-anchor" });
      const firstImg = createEl(iw, "img", { cls: "hj-img hj-img-inactive" });
      firstImg.src = photos[0].imageUrl || "";
      firstImg.alt = p.title;
      firstImg.loading = "lazy";
      for (let pi = 1; pi < photos.length; pi++) {
        const extraWrap = createDiv(card, { cls: "hj-img-wrap hj-img-extra" });
        const extraImg = createEl(extraWrap, "img", { cls: "hj-img hj-img-inactive" });
        extraImg.src = photos[pi].imageUrl || "";
        extraImg.alt = photos[pi].title || p.title;
        extraImg.loading = "lazy";
      }
    } else {
      const marker = createDiv(card, { cls: "hj-track-marker hj-cone-anchor" });
      const icon = createDiv(marker, { cls: "hj-track-icon" });
      if (i === 0) icon.textContent = "\uD83D\uDEA9";
      else if (i === this.pts.length - 1) icon.textContent = "\uD83C\uDFC1";
      else icon.textContent = "\uD83D\uDCCD";
      createEl(marker, "h3", { text: p.title, cls: "hj-track-title" });
      const coords = createDiv(marker, { cls: "hj-track-coords" });
      if (p.lat && p.lng) createEl(coords, "span", { text: `${p.lat.toFixed(4)}\u00B0, ${p.lng.toFixed(4)}\u00B0` });
      if (p.alt != null) createEl(coords, "span", { text: `${p.alt}m elev.` });
    }

    if (this.tripVersion >= 5) {
      if (p.blog && p.blog.trim()) {
        const blogDiv = createDiv(card, { cls: "hj-blog" });
        blogDiv.innerHTML = marked.parse(p.blog);
      }
    } else {
      const info = createDiv(card, { cls: "hj-card-info" });
      createEl(info, "h2", { text: p.title, cls: "hj-card-title" });
      if (p.description) createEl(info, "p", { text: p.description, cls: "hj-card-desc" });
      if (p.blog && p.blog.trim()) {
        const b = createDiv(info, { cls: "hj-blog" });
        b.innerHTML = marked.parse(p.blog);
      }
    }
    return card;
  }

  _cacheCardCtrs() {
    this.cardCtrs = this.cards.map(c => c.offsetTop + c.offsetHeight / 2);
  }

  startLoop() {
    const loop = () => {
      if (!this.scrollEl || !this.svgBox) return;
      const vc = this.scrollEl.scrollTop + this.scrollEl.clientHeight / 2;
      const ctrs = this.cardCtrs;
      let sp = 0;
      if (ctrs.length) {
        if (vc <= ctrs[0]) sp = 0;
        else if (vc >= ctrs[ctrs.length - 1]) {
          const lastCtr = ctrs[ctrs.length - 1];
          const scrollEnd = this.scrollEl.scrollHeight - this.scrollEl.clientHeight / 2;
          const extraRange = scrollEnd - lastCtr;
          sp = extraRange > 0 ? (ctrs.length - 1) + Math.min(1, (vc - lastCtr) / extraRange) : ctrs.length - 1;
        } else {
          for (let i = 0; i < ctrs.length - 1; i++) {
            if (vc >= ctrs[i] && vc <= ctrs[i + 1]) {
              sp = i + (vc - ctrs[i]) / (ctrs[i + 1] - ctrs[i]);
              break;
            }
          }
        }
      }

      const ni = Math.max(0, Math.min(this.pts.length - 1, Math.round(sp)));
      if (ni !== this.ai) {
        const oldAi = this.ai;
        this.ai = ni;
        this.syncCards(oldAi, ni);
        this.syncDots(oldAi, ni);
      }

      const ap = this.pts[this.ai];
      if (!ap) { this.raf = requestAnimationFrame(loop); return; }

      let tipX, tipY, targetDist = 0;
      const fi = Math.min(Math.floor(sp), this.pts.length - 1);
      const fp = fi === this.pts.length - 1 ? Math.min(1, sp - (this.pts.length - 1)) : sp - Math.floor(sp);

      if (this.hasTrack) {
        const d1 = this.pts[fi].trackDist;
        const d2 = fi < this.pts.length - 1 ? this.pts[fi + 1].trackDist : this.totalDist;
        const tipDist = d1 + (d2 - d1) * fp;
        targetDist = fi === 0 ? fp * d1 : tipDist;
        const tip = interpAt(targetDist, this.route, this.routeDists);
        tipX = tip.x; tipY = tip.y;
      } else {
        tipX = this.pts[fi].x; tipY = this.pts[fi].y;
        if (fi < this.pts.length - 1) {
          tipX += (this.pts[fi + 1].x - this.pts[fi].x) * fp;
          tipY += (this.pts[fi + 1].y - this.pts[fi].y) * fp;
        }
      }

      const tcx = this.geo.w * CAM_OX - tipX + this.userOffX;
      const tcy = this.geo.h * CAM_OY - tipY + this.userOffY;
      if (!this.userPanning) {
        this.userOffX *= 0.92; this.userOffY *= 0.92;
        if (Math.abs(this.userOffX) < 0.5) this.userOffX = 0;
        if (Math.abs(this.userOffY) < 0.5) this.userOffY = 0;
      }
      const camDx = tcx - this.cx, camDy = tcy - this.cy;
      const camGap = Math.sqrt(camDx * camDx + camDy * camDy);
      const lerp = camGap > TILE * 3 ? 0.5 : camGap > TILE ? 0.3 : 0.18;
      this.cx += camDx * lerp;
      this.cy += camDy * lerp;
      if (this.mGrp) this.mGrp.setAttribute("transform", `translate(${this.cx},${this.cy})`);

      if (Math.abs(this.cx - this._lastTileCx) > TILE / 2 || Math.abs(this.cy - this._lastTileCy) > TILE / 2) {
        this.syncTiles();
        this._lastTileCx = this.cx;
        this._lastTileCy = this.cy;
      }

      this.syncCone(tipX, tipY);
      this.syncLines(sp, targetDist);
      this.raf = requestAnimationFrame(loop);
    };
    this.raf = requestAnimationFrame(loop);
  }

  syncTiles() {
    syncTilesGeneric(this.tilePool, this.geo, this.mapStyle, this.cx, this.cy, this._svgRect, this.userScale);
  }

  syncCone(tipX, tipY) {
    const card = this.cards[this.ai];
    if (!card || !this.coneSvg) return;
    let wraps = Array.from(card.querySelectorAll(".hj-img-wrap"));
    if (!wraps.length) {
      const marker = card.querySelector(".hj-cone-anchor");
      if (marker) wraps = [marker]; else return;
    }
    const sr = this._svgRect || this.svgBox.getBoundingClientRect();
    if (!sr.width || !sr.height) return;
    const zs = this.userScale || 1;
    const vbW = this.geo.w / zs, vbH = this.geo.h / zs;
    const vbX = this.geo.w * CAM_OX * (1 - 1 / zs);
    const vbY = this.geo.h * CAM_OY * (1 - 1 / zs);
    const sc = Math.max(sr.width / vbW, sr.height / vbH);
    if (!sc || !isFinite(sc)) return;
    const oY = (vbH * sc - sr.height) / 2;
    const oX = (vbW * sc - sr.width) / 2;
    const s2y = (sy) => (sy - sr.top + oY) / sc + vbY;
    const s2x = (sx) => (sx - sr.left + oX) / sc + vbX;
    while (this.cones.length < wraps.length) {
      const poly = S("polygon", { fill: "url(#coneG)", style: "mix-blend-mode:multiply;" }, this.coneSvg);
      this.cones.push(poly);
    }
    for (let i = 0; i < this.cones.length; i++) {
      this.cones[i].setAttribute("visibility", i < wraps.length ? "visible" : "hidden");
    }
    const tx = tipX + this.cx, ty = tipY + this.cy;
    if (!this._scrollRect || this._scrollRectAge++ > 30) {
      this._scrollRect = this.scrollEl.getBoundingClientRect();
      this._scrollRectAge = 0;
    }
    const scrollRect = this._scrollRect;
    const scrollH = scrollRect.height;
    for (let i = 0; i < wraps.length; i++) {
      const ir = wraps[i].getBoundingClientRect();
      if (!ir.width || !ir.height) continue;
      const photoMid = (ir.top + ir.bottom) / 2;
      const rawT = Math.max(0, Math.min(1, 1 - (photoMid - scrollRect.top) / scrollH));
      const tt = 1 - Math.pow(1 - rawT, 4);
      const p1x = s2x(ir.left + (ir.right - ir.left) * tt);
      const p1y = s2y(ir.top);
      const p2x = s2x(ir.right);
      const p2y = s2y(ir.bottom);
      if (isFinite(p1x) && isFinite(tx)) {
        this.cones[i].setAttribute("points", `${p1x},${p1y} ${p2x},${p2y} ${tx},${ty}`);
      }
    }
  }

  syncLines(sp, targetDist) {
    if (this.hasTrack && this.pathLine) {
      this.pathLine.style.strokeDashoffset = `${Math.max(0, this.totalDist - targetDist)}`;
    } else {
      for (let j = 0; j < this.pts.length - 1; j++) {
        const dr = Math.max(0, Math.min(1, sp - j));
        const len = Math.hypot(this.pts[j + 1].x - this.pts[j].x, this.pts[j + 1].y - this.pts[j].y);
        const l = this.segs[j];
        if (l) { l.style.strokeDasharray = `${len}`; l.style.strokeDashoffset = `${len * (1 - dr)}`; }
      }
    }
  }

  syncCards(oldIdx, newIdx) {
    const deactivate = (c) => {
      c.classList.remove("hj-card-active"); c.classList.add("hj-card-dim");
      c.querySelectorAll(".hj-img").forEach(img => { img.classList.remove("hj-img-active"); img.classList.add("hj-img-inactive"); });
      const m = c.querySelector(".hj-track-marker"); if (m) { m.classList.remove("hj-marker-active"); m.classList.add("hj-marker-dim"); }
    };
    const activate = (c) => {
      c.classList.add("hj-card-active"); c.classList.remove("hj-card-dim");
      c.querySelectorAll(".hj-img").forEach(img => { img.classList.add("hj-img-active"); img.classList.remove("hj-img-inactive"); });
      const m = c.querySelector(".hj-track-marker"); if (m) { m.classList.add("hj-marker-active"); m.classList.remove("hj-marker-dim"); }
    };
    if (oldIdx >= 0 && oldIdx < this.cards.length) deactivate(this.cards[oldIdx]);
    if (newIdx >= 0 && newIdx < this.cards.length) activate(this.cards[newIdx]);
  }

  _setDot(ref, active) {
    if (!ref) return;
    if (ref.dot) {
      ref.dot.setAttribute("r", active ? "7" : "4");
      ref.dot.setAttribute("fill", active ? "#dc2626" : "#475569");
      active ? ref.dot.setAttribute("filter", "url(#glow)") : ref.dot.removeAttribute("filter");
    }
    if (ref.ping) {
      ref.ping.setAttribute("opacity", active ? "0.6" : "0");
      ref.ping.classList.toggle("hj-ping-anim", active);
    }
    if (ref.lbl) {
      ref.lbl.setAttribute("font-size", active ? "15" : "12");
      ref.lbl.setAttribute("font-weight", active ? "600" : "500");
      ref.lbl.setAttribute("fill", active ? "#0f172a" : "#64748b");
    }
  }

  syncDots(oldIdx, newIdx) {
    this._setDot(this.dotRefs[oldIdx], false);
    this._setDot(this.dotRefs[newIdx], true);
  }

  tapDot(i) {
    if (this.cards[i]) this.cards[i].scrollIntoView({ behavior: "smooth", block: "center" });
    this.showBubble(i);
  }

  showBubble(i) {
    this.rmBubble();
    const p = this.pts[i];
    if (!p) return;
    const fo = S("foreignObject", { x: `${p.x - 90}`, y: `${p.y - 120}`, width: "180", height: "95", class: "hj-bubble-fo" });
    const d = document.createElement("div");
    d.className = "hj-bubble-inner";
    const tt = document.createElement("div");
    tt.className = "hj-bubble-title";
    tt.textContent = "Location Data";
    d.appendChild(tt);
    if (p.lat && p.lng) {
      const r = document.createElement("div");
      r.className = "hj-bubble-row";
      r.innerHTML = `<span>Lat/Lng</span><span class="hj-mono">${p.lat.toFixed(4)}\u00B0, ${p.lng.toFixed(4)}\u00B0</span>`;
      d.appendChild(r);
    }
    if (p.alt != null) {
      const r = document.createElement("div");
      r.className = "hj-bubble-row";
      r.innerHTML = `<span>Elevation</span><span class="hj-mono">${p.alt}m</span>`;
      d.appendChild(r);
    }
    const cr = document.createElement("div");
    cr.className = "hj-bubble-caret";
    d.appendChild(cr);
    fo.appendChild(d);
    this.mGrp.appendChild(fo);
    this.bubble = fo;
  }

  rmBubble() {
    if (this.bubble) { this.bubble.remove(); this.bubble = null; }
  }
}

// === Shared tile sync logic ===
function syncTilesGeneric(tilePool, geo, mapStyle, cx, cy, svgRect, userScale, growPool) {
  const sr = svgRect;
  if (!sr || !sr.width || !sr.height) return;
  const s = userScale || 1;
  const vbW = geo.w / s, vbH = geo.h / s;
  const vbX = geo.w * CAM_OX * (1 - 1 / s);
  const vbY = geo.h * CAM_OY * (1 - 1 / s);
  const scale = Math.max(sr.width / vbW, sr.height / vbH);
  const vw = sr.width / scale, vh = sr.height / scale;
  const mapCX = (vbX + vbW / 2) - cx;
  const mapCY = (vbY + vbH / 2) - cy;
  const buf = 2;
  const xMin = Math.floor(geo.minTX + (mapCX - vw / 2) / TILE) - buf;
  const xMax = Math.floor(geo.minTX + (mapCX + vw / 2) / TILE) + buf;
  const yMin = Math.floor(geo.minTY + (mapCY - vh / 2) / TILE) - buf;
  const yMax = Math.floor(geo.minTY + (mapCY + vh / 2) / TILE) + buf;
  const ms = MAP_STYLES[mapStyle] || MAP_STYLES["opentopomap"];
  const srv = ms.subs;
  let idx = 0;
  for (let x = xMin; x <= xMax; x++) {
    for (let y = yMin; y <= yMax; y++) {
      if (idx >= tilePool.length) break;
      const node = tilePool[idx];
      let url = ms.url.replace("{z}", geo.zoom).replace("{x}", x).replace("{y}", y);
      if (srv.length > 0) url = url.replace("{s}", srv[Math.abs(x + y) % srv.length]);
      if (ms.needsApiKey) { const sk = getStadiaKey(); if (sk) url += (url.includes("?") ? "&" : "?") + "api_key=" + sk; }
      if (node.getAttribute("href") !== url) {
        node.setAttribute("href", url);
        node.setAttribute("x", `${(x - geo.minTX) * TILE}`);
        node.setAttribute("y", `${(y - geo.minTY) * TILE}`);
      }
      if (node.style.display === "none") node.style.display = "";
      idx++;
    }
  }
  while (idx < tilePool.length) {
    if (tilePool[idx].style.display !== "none") tilePool[idx].style.display = "none";
    idx++;
  }
}

// ============================================================
//  SCRAPBOOK VIEWER
// ============================================================
class ScrapbookViewer {
  constructor(container) {
    this.container = container;
    this.pts = [];
    this.route = [];
    this.routeDists = [];
    this.totalDist = 0;
    this.hasTrack = false;
    this.tilePool = [];
    this.mGrp = null;
    this.mainSvg = null;
    this.raf = 0;
    this._cleanupMapListeners = null;
    this._loopGen = 0;
    this._vpX = 0; this._vpY = 0;
    this._vpScale = 1; this._vpBaseScale = 1;
    this._vpInited = false;
    this._dragState = null;
    this._scrapCards = [];
    this._scrapState = null;
    this._textBlocks = [];
    this._canvasDirty = false;
    this._scrapConnLines = [];
    this._scrapRopePaths = [];
  }

  loadTrip(data, onBack, onSwitchTemplate) {
    this.trip = data;
    this.onBack = onBack;
    this.onSwitchTemplate = onSwitchTemplate;
    this.rebuild();
  }

  destroy() {
    this._loopGen++;
    if (this.raf) cancelAnimationFrame(this.raf);
    this.raf = 0;
    if (this._cleanupMapListeners) this._cleanupMapListeners();
    this.container.innerHTML = "";
  }

  _loadCanvasData() {
    try {
      const key = "hj-canvas-scrap-" + (this.trip.name || "");
      const stored = localStorage.getItem(key);
      return stored ? JSON.parse(stored) : {};
    } catch(e) { return {}; }
  }

  _saveCanvasData(data) {
    try {
      const key = "hj-canvas-scrap-" + (this.trip.name || "");
      localStorage.setItem(key, JSON.stringify(data));
    } catch(e) {}
  }

  rebuild() {
    this._loopGen++;
    const gen = this._loopGen;
    const c = this.container;
    c.innerHTML = "";
    const trip = this.trip;

    const prepared = prepareTrip(trip);
    if (!prepared) { createDiv(c, { text: t("noGps"), cls: "hj-empty" }); return; }
    Object.assign(this, prepared);
    this.hasTrack = this.hasGpx;
    this.mapStyle = trip.mapStyle || "opentopomap";

    // Compute card offsets
    const offsetDist = this.geo.w * 0.08;
    const cardMinDist = offsetDist * 0.9;
    for (let i = 0; i < this.pts.length; i++) {
      const side = i % 2 === 0 ? -1 : 1;
      let cx = this.pts[i].x + side * offsetDist;
      let cy = this.pts[i].y + (i % 3 - 1) * offsetDist * 0.3;
      for (let attempt = 0; attempt < 4; attempt++) {
        let tooClose = false;
        for (let j = 0; j < i; j++) {
          if (Math.hypot(cx - this.pts[j].cardX, cy - this.pts[j].cardY) < cardMinDist) {
            cy += cardMinDist * 0.5; tooClose = true; break;
          }
        }
        if (!tooClose) break;
      }
      this.pts[i].cardX = cx;
      this.pts[i].cardY = cy;
      this.pts[i].rotation = side * (3 + Math.random() * 4);
    }

    // Build UI
    const root = createDiv(c, { cls: "hj-scrapbook-root" });
    createDiv(root, { cls: "hj-scrapbook-noise" });

    const viewport = createDiv(root, { cls: "hj-scrapbook-viewport" });
    viewport.style.cssText = `position:absolute;left:0;top:0;width:${this.geo.w}px;height:${this.geo.h}px;transform-origin:0 0;will-change:transform;overflow:visible;`;

    // SVG layer
    const svg = S("svg", {
      viewBox: `0 0 ${this.geo.w} ${this.geo.h}`,
      preserveAspectRatio: "none", class: "hj-fullsvg hj-scrapbook-svg"
    });
    svg.style.cssText = `position:absolute;left:0;top:0;width:${this.geo.w}px;height:${this.geo.h}px;overflow:visible;`;
    viewport.appendChild(svg);

    const defs = S("defs", {}, svg);
    const ropeShadow = S("filter", { id: "ropeShadow", x: "-10%", y: "-10%", width: "120%", height: "130%" }, defs);
    S("feDropShadow", { dx: "1", dy: "2", stdDeviation: "1.5", "flood-opacity": "0.25" }, ropeShadow);

    this.mGrp = S("g", {}, svg);
    this.tileGroup = S("g", { style: "opacity:0.85;" }, this.mGrp);
    this.mainSvg = svg;

    this.tilePool = [];
    this._growTilePool = (needed) => {
      while (this.tilePool.length < needed) {
        const img = S("image", { width: `${TILE + 0.5}`, height: `${TILE + 0.5}`, preserveAspectRatio: "none", style: "display:none" }, this.tileGroup);
        this.tilePool.push(img);
      }
    };
    this._growTilePool(50);

    // GPX track
    if (this.hasTrack) {
      const step = Math.max(1, Math.floor(this.route.length / 500));
      const trackPts = [];
      for (let i = 0; i < this.route.length; i += step) trackPts.push(`${this.route[i].x},${this.route[i].y}`);
      trackPts.push(`${this.route[this.route.length - 1].x},${this.route[this.route.length - 1].y}`);
      S("polyline", {
        points: trackPts.join(" "), fill: "none", stroke: "#78716c", "stroke-width": "3.5",
        "stroke-dasharray": "6 8", "stroke-linecap": "round", "stroke-linejoin": "round",
        style: "mix-blend-mode:multiply"
      }, this.mGrp);
    }

    // Connection lines + GPS dots
    const connGrp = S("g", {}, this.mGrp);
    for (const pt of this.pts) {
      S("line", { x1: pt.cardX, y1: pt.cardY, x2: pt.x, y2: pt.y, stroke: "#ef4444", "stroke-width": "2", "stroke-dasharray": "3 4", opacity: "0.6" }, connGrp);
      S("circle", { cx: pt.x, cy: pt.y, r: "4", fill: "#ef4444" }, connGrp);
      S("circle", { cx: pt.x, cy: pt.y, r: "8", fill: "none", stroke: "#ef4444", "stroke-width": "1", opacity: "0.5" }, connGrp);
    }

    // Rope paths
    const ropeGrp = S("g", { filter: "url(#ropeShadow)" }, this.mGrp);
    for (let i = 0; i < this.pts.length - 1; i++) {
      const p1 = this.pts[i], p2 = this.pts[i + 1];
      const midX = (p1.cardX + p2.cardX) / 2, midY = (p1.cardY + p2.cardY) / 2;
      const dist = Math.hypot(p2.cardX - p1.cardX, p2.cardY - p1.cardY);
      const d = `M ${p1.cardX},${p1.cardY} Q ${midX},${midY + dist * 0.15} ${p2.cardX},${p2.cardY}`;
      S("path", { d, fill: "none", stroke: "#a07850", "stroke-width": "5", "stroke-linecap": "round" }, ropeGrp);
      S("path", { d, fill: "none", stroke: "#c8ab7a", "stroke-width": "2.5", "stroke-dasharray": "7 5", "stroke-linecap": "round", opacity: "0.6" }, ropeGrp);
    }

    // HTML card layer
    const cardLayer = createDiv(viewport, { cls: "hj-scrapbook-card-layer" });
    cardLayer.style.cssText = `position:absolute;left:0;top:0;width:${this.geo.w}px;height:${this.geo.h}px;pointer-events:none;`;
    this._scrapCards = [];
    this._scrapState = null;
    this._resetScrapCard = () => {
      const st = this._scrapState;
      if (!st) return;
      const prev = this._scrapCards[st.idx];
      if (prev) {
        const pInner = prev.el.querySelector(".hj-polaroid-inner");
        pInner.style.transform = "";
        prev.el.classList.remove("hj-card-active", "hj-card-flipped");
        prev.el.style.zIndex = 20;
        if (prev.el._resetStage) prev.el._resetStage();
      }
      this._scrapState = null;
    };

    // Build polaroid cards
    for (let i = 0; i < this.pts.length; i++) {
      const pt = this.pts[i];
      const card = createDiv(cardLayer, { cls: "hj-polaroid-wrap" });
      card.style.cssText = `position:absolute;left:${pt.cardX}px;top:${pt.cardY}px;transform:translate(-50%,0);pointer-events:auto;`;
      card.dataset.idx = i;

      const pin = createDiv(card, { cls: "hj-pushpin" });
      const pinAngle = (Math.random() - 0.5) * 50;
      pin.style.transform = `rotate(${pinAngle}deg)`;
      pin.innerHTML = '<div class="hj-pin-shadow"></div><div class="hj-pin-needle"></div><div class="hj-pin-cone"></div><div class="hj-pin-head"></div><div class="hj-pin-highlight"></div>';

      const polaroid = createDiv(card, { cls: "hj-polaroid" });
      polaroid.style.transform = `rotate(${pt.rotation}deg)`;

      const inner = createDiv(polaroid, { cls: "hj-polaroid-inner" });
      const front = createDiv(inner, { cls: "hj-polaroid-front" });
      const imgWrap = createDiv(front, { cls: "hj-polaroid-img" });

      const photos = pt.photos && pt.photos.length > 0 ? pt.photos : [];
      if (photos.length > 0) {
        const img = createEl(imgWrap, "img");
        img.draggable = false;
        if (photos[0].imageUrl) img.src = photos[0].imageUrl;
      } else {
        createDiv(imgWrap, { text: "\u{1F4CD}", cls: "hj-polaroid-placeholder" });
      }

      const frontTitle = createDiv(front, { cls: "hj-polaroid-title" });
      createEl(frontTitle, "p", { text: pt.title, cls: "hj-polaroid-name" });
      createEl(frontTitle, "p", { text: trip.date || "", cls: "hj-polaroid-date" });

      const back = createDiv(inner, { cls: "hj-polaroid-back" });
      const backContent = createDiv(back, { cls: "hj-polaroid-back-edit" });
      backContent.setAttribute("spellcheck", "false");
      backContent.style.cssText = "width:100%;height:100%;outline:none;font-family:'Segoe Script','Comic Sans MS','Caveat',cursive;font-size:10px;color:#4a3728;line-height:1.5;padding:4px 6px;box-sizing:border-box;overflow-y:auto;";
      backContent.innerHTML = pt.backNote || pt.description || pt.blog || "";
      backContent.addEventListener("mousedown", (e) => e.stopPropagation());
      backContent.addEventListener("pointerdown", (e) => e.stopPropagation());
      backContent.addEventListener("click", (ev) => { ev.stopPropagation(); backContent.setAttribute("contenteditable", "true"); backContent.focus(); });
      backContent.addEventListener("blur", () => { backContent.removeAttribute("contenteditable"); });
      backContent.addEventListener("input", () => { this._canvasDirty = true; this._saveCanvasDebounced(); });

      let _cardStage = "normal";
      polaroid.addEventListener("click", (e) => {
        if (this._dragState && this._dragState.moved > 5) return;
        const wrap = card.closest(".hj-polaroid-wrap");
        if (wrap?._justDragged) { wrap._justDragged = false; wrap.style.zIndex = "20"; return; }
        e.stopPropagation();
        this._cardClickTime = Date.now();
        if (_cardStage === "normal") {
          this._resetScrapCard();
          inner.style.transform = "scale(1.8)";
          card.classList.add("hj-card-active");
          card.style.zIndex = 1000;
          this._scrapState = { idx: i, stage: "zoomed" };
          _cardStage = "zoomed";
        } else if (_cardStage === "zoomed") {
          inner.style.transform = "rotateY(180deg) scale(1.8)";
          card.classList.add("hj-card-flipped");
          this._scrapState = { idx: i, stage: "flipped" };
          _cardStage = "flipped";
          setTimeout(() => backContent.focus(), 400);
        } else if (_cardStage === "flipped") {
          inner.style.transform = "";
          card.classList.remove("hj-card-flipped", "hj-card-active");
          card.style.zIndex = 20;
          this._scrapState = null;
          _cardStage = "normal";
        }
      });
      card._backContent = backContent;
      card._resetStage = () => { _cardStage = "normal"; };
      card.addEventListener("mouseenter", () => { if (!this._dragState) card.style.zIndex = 500; });
      card.addEventListener("mouseleave", () => { if (!card.classList.contains("hj-card-flipped")) card.style.zIndex = 20; });

      this._scrapCards.push({ el: card, pt });
    }

    root.addEventListener("click", () => {
      if (this._dragState && this._dragState.moved > 5) return;
      if (this._cardClickTime && Date.now() - this._cardClickTime < 100) return;
      this._resetScrapCard();
    });

    // Collect SVG refs for live update during drag
    this._scrapConnLines = [];
    this._scrapRopePaths = [];
    const allConnLines = connGrp.querySelectorAll("line");
    for (let i = 0; i < this.pts.length; i++) this._scrapConnLines.push(allConnLines[i] || null);
    const allRopePaths = ropeGrp.querySelectorAll("path");
    for (let i = 0; i < this.pts.length - 1; i++) this._scrapRopePaths.push([allRopePaths[i * 2], allRopePaths[i * 2 + 1]]);

    this._updateRope = (ri) => {
      if (!this._scrapRopePaths[ri]) return;
      const p1 = this._scrapCards[ri].pt, p2 = this._scrapCards[ri + 1].pt;
      const mx = (p1.cardX + p2.cardX) / 2, my = (p1.cardY + p2.cardY) / 2;
      const dist = Math.hypot(p2.cardX - p1.cardX, p2.cardY - p1.cardY);
      const d = "M " + p1.cardX + "," + p1.cardY + " Q " + mx + "," + (my + dist * 0.15) + " " + p2.cardX + "," + p2.cardY;
      for (const path of this._scrapRopePaths[ri]) path.setAttribute("d", d);
    };

    // Make cards draggable
    const makeCardDraggable = (wrap, idx) => {
      let dragSX, dragSY, startL, startT, isDragging = false, dragMoved = 0;
      wrap.addEventListener("pointerdown", (e) => {
        if (e.button !== 0) return;
        e.stopPropagation();
        isDragging = true; dragMoved = 0; wrap._justDragged = false;
        wrap.style.cursor = "grabbing"; wrap.style.zIndex = "1000";
        dragSX = e.clientX; dragSY = e.clientY;
        startL = parseFloat(wrap.style.left); startT = parseFloat(wrap.style.top);
        const onMove = (e2) => {
          if (!isDragging) return;
          const dx = e2.clientX - dragSX, dy = e2.clientY - dragSY;
          dragMoved += Math.abs(dx) + Math.abs(dy);
          const r2 = viewport.getBoundingClientRect();
          const s2 = r2.width / this.geo.w;
          const nx = startL + dx / s2;
          const ny = startT + dy / s2;
          wrap.style.left = nx + "px"; wrap.style.top = ny + "px";
          const pt = this._scrapCards[idx].pt;
          pt.cardX = nx; pt.cardY = ny;
          if (this._scrapConnLines[idx]) { this._scrapConnLines[idx].setAttribute("x1", nx); this._scrapConnLines[idx].setAttribute("y1", ny); }
          if (idx > 0) this._updateRope(idx - 1);
          if (idx < this._scrapCards.length - 1) this._updateRope(idx);
        };
        const onUp = () => {
          if (dragMoved > 5) wrap._justDragged = true;
          isDragging = false; wrap.style.cursor = "grab";
          if (!wrap._justDragged) wrap.style.zIndex = "20";
          document.removeEventListener("pointermove", onMove);
          document.removeEventListener("pointerup", onUp);
          if (dragMoved > 5) { this._canvasDirty = true; this._saveCanvasDebounced(); }
        };
        document.addEventListener("pointermove", onMove);
        document.addEventListener("pointerup", onUp);
      });
    };
    for (let i = 0; i < this._scrapCards.length; i++) makeCardDraggable(this._scrapCards[i].el, i);

    // Glass text blocks
    this._textBlocks = [];
    this._canvasDirty = false;
    const createTextBlock = (x, y, w, h, text, id) => {
      const blockId = id || "tb-" + Date.now() + "-" + Math.random().toString(36).slice(2, 6);
      const block = createDiv(cardLayer, { cls: "hj-glass-block" });
      block.style.cssText = "position:absolute;left:" + x + "px;top:" + y + "px;width:" + w + "px;min-height:" + h + "px;pointer-events:auto;";
      block.dataset.blockId = blockId;
      block.classList.add("hj-illust-visible");

      const handle = createDiv(block, { cls: "hj-glass-handle" });
      handle.textContent = "\u2261";

      const content = createDiv(block, { cls: "hj-glass-content" });
      content.setAttribute("contenteditable", "true");
      content.setAttribute("spellcheck", "false");
      content.innerHTML = text || "";
      content.addEventListener("input", () => { this._canvasDirty = true; this._saveCanvasDebounced(); });
      content.addEventListener("mousedown", (e) => e.stopPropagation());
      content.addEventListener("pointerdown", (e) => e.stopPropagation());

      const delBtn = createDiv(block, { cls: "hj-glass-delete" });
      delBtn.textContent = "\u00d7";
      delBtn.addEventListener("click", (e) => {
        e.stopPropagation(); block.remove();
        this._textBlocks = this._textBlocks.filter(b => b.id !== blockId);
        this._canvasDirty = true; this._saveCanvasDebounced();
      });

      const resizeH = createDiv(block, { cls: "hj-glass-resize" });
      resizeH.addEventListener("pointerdown", (e) => {
        e.stopPropagation();
        let resizing = true;
        const sw = block.offsetWidth, sh = block.offsetHeight, sx = e.clientX, sy = e.clientY;
        const rect = viewport.getBoundingClientRect();
        const scale = rect.width / this.geo.w;
        const onM = (e2) => { if (!resizing) return; block.style.width = Math.max(100, sw + (e2.clientX - sx) / scale) + "px"; block.style.minHeight = Math.max(60, sh + (e2.clientY - sy) / scale) + "px"; };
        const onU = () => { resizing = false; document.removeEventListener("pointermove", onM); document.removeEventListener("pointerup", onU); this._canvasDirty = true; this._saveCanvasDebounced(); };
        document.addEventListener("pointermove", onM); document.addEventListener("pointerup", onU);
      });

      handle.addEventListener("pointerdown", (e) => {
        e.stopPropagation();
        let dragging = true; handle.style.cursor = "grabbing";
        const rect = viewport.getBoundingClientRect();
        const scale = rect.width / this.geo.w;
        const sx = e.clientX, sy = e.clientY;
        const sl = parseFloat(block.style.left), st = parseFloat(block.style.top);
        const onM = (e2) => { if (!dragging) return; const r2 = viewport.getBoundingClientRect(); const s2 = r2.width / this.geo.w; block.style.left = (sl + (e2.clientX - sx) / s2) + "px"; block.style.top = (st + (e2.clientY - sy) / s2) + "px"; };
        const onU = () => { dragging = false; handle.style.cursor = "grab"; document.removeEventListener("pointermove", onM); document.removeEventListener("pointerup", onU); this._canvasDirty = true; this._saveCanvasDebounced(); };
        document.addEventListener("pointermove", onM); document.addEventListener("pointerup", onU);
      });

      const tbData = { id: blockId, el: block, content };
      this._textBlocks.push(tbData);
      return tbData;
    };

    // Load saved canvas data from localStorage
    const canvasData = this._loadCanvasData();
    if (canvasData.cards) {
      for (const saved of canvasData.cards) {
        const card = this._scrapCards.find(c => c.pt.id === saved.id || c.pt.title === saved.title);
        if (card) {
          card.el.style.left = saved.x + "px"; card.el.style.top = saved.y + "px";
          card.pt.cardX = saved.x; card.pt.cardY = saved.y;
          if (saved.backNote && card.el._backContent) card.el._backContent.innerHTML = saved.backNote;
        }
      }
      for (let i = 0; i < this._scrapCards.length; i++) {
        const pt = this._scrapCards[i].pt;
        if (this._scrapConnLines[i]) { this._scrapConnLines[i].setAttribute("x1", pt.cardX); this._scrapConnLines[i].setAttribute("y1", pt.cardY); }
        if (i > 0) this._updateRope(i - 1);
      }
    }
    if (canvasData.textBlocks) {
      for (const tb of canvasData.textBlocks) createTextBlock(tb.x, tb.y, tb.w || 200, tb.h || 80, tb.text, tb.id);
    }

    // Debounced save
    let _saveTimer = null;
    this._saveCanvasDebounced = () => {
      if (_saveTimer) clearTimeout(_saveTimer);
      _saveTimer = setTimeout(() => {
        if (!this._canvasDirty) return;
        this._canvasDirty = false;
        this._saveCanvasData({
          cards: this._scrapCards.map(c => ({ id: c.pt.id || "", title: c.pt.title || "", x: Math.round(parseFloat(c.el.style.left)), y: Math.round(parseFloat(c.el.style.top)), backNote: c.el._backContent ? c.el._backContent.innerHTML : "" })),
          textBlocks: this._textBlocks.map(tb => ({ id: tb.id, x: Math.round(parseFloat(tb.el.style.left)), y: Math.round(parseFloat(tb.el.style.top)), w: Math.round(tb.el.offsetWidth), h: Math.round(tb.el.offsetHeight), text: tb.content.innerHTML }))
        });
      }, 1500);
    };

    // HUD
    const hud = createDiv(root, { cls: "hj-scrapbook-hud" });
    const hudTitle = createDiv(hud, { cls: "hj-scrapbook-hud-title" });
    createEl(hudTitle, "h1", { text: trip.name });
    createEl(hudTitle, "p", { text: (t("template.scrapbook") || "SCRAPBOOK").toUpperCase() });

    const backBtn = createDiv(hud, { cls: "hj-scrapbook-back-btn" });
    backBtn.textContent = "\u2190 " + t("trip.backToMap");
    backBtn.addEventListener("click", () => this.onBack());
    buildTemplateSwitcher(hud, trip.template, (tmpl) => this.onSwitchTemplate(tmpl));

    const overviewBtn = createDiv(hud, { cls: "hj-scrapbook-overview-btn" });
    overviewBtn.textContent = "\u{1F50D} VIEW ALL";
    overviewBtn.addEventListener("click", () => this._initViewport(root));

    // Map style switcher
    buildMapSwitcher(root, this.mapStyle, (key) => {
      this.mapStyle = key;
      for (const node of this.tilePool) { node.removeAttribute("href"); node.style.display = "none"; }
      this._scrapTileDirty = true;
    });

    const hint = createDiv(root, { cls: "hj-scrapbook-hint" });
    hint.textContent = "\u{1F5B1}\uFE0F Drag Map \u00B7 Tap Photo \u00B7 Double-click to Flip";
    setTimeout(() => { hint.style.opacity = "0"; hint.style.transition = "opacity 1s ease"; }, 4000);

    // Viewport state
    this._vpX = 0; this._vpY = 0; this._vpScale = 1; this._vpBaseScale = 1; this._vpInited = false;
    this._dragState = null;

    this._initViewport = (rootEl) => {
      const rw = rootEl.offsetWidth, rh = rootEl.offsetHeight;
      if (!rw || !rh) return;
      this._vpBaseScale = Math.max(rw / this.geo.w, rh / this.geo.h);
      this._vpScale = this._vpBaseScale;
      this._vpX = (rw - this.geo.w * this._vpScale) / 2;
      this._vpY = (rh - this.geo.h * this._vpScale) / 2;
      this._vpInited = true;
    };

    // Interaction
    root.style.cursor = "grab";
    root.addEventListener("mousedown", (e) => {
      if (e.target.closest(".hj-scrapbook-hud") || e.target.closest(".hj-map-switcher")) return;
      if (e.target.closest(".hj-polaroid-wrap") || e.target.closest(".hj-glass-block")) return;
      if (e.button !== 0) return;
      e.preventDefault();
      this._dragState = { x: e.clientX, y: e.clientY, moved: 0 };
      root.style.cursor = "grabbing";
    });

    const onMouseMove = (e) => {
      if (!this._dragState) return;
      const dx = e.clientX - this._dragState.x, dy = e.clientY - this._dragState.y;
      this._dragState.moved += Math.abs(dx) + Math.abs(dy);
      this._vpX += dx; this._vpY += dy;
      this._dragState.x = e.clientX; this._dragState.y = e.clientY;
    };
    const onMouseUp = () => { if (!this._dragState) return; this._dragState = null; root.style.cursor = "grab"; };
    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp);

    root.addEventListener("wheel", (e) => {
      e.preventDefault();
      const factor = e.deltaY > 0 ? 0.9 : 1.1;
      const newScale = Math.max(this._vpBaseScale * 0.3, Math.min(this._vpBaseScale * 6, this._vpScale * factor));
      const rect = root.getBoundingClientRect();
      const cx = e.clientX - rect.left, cy = e.clientY - rect.top;
      this._vpX = cx - (cx - this._vpX) * (newScale / this._vpScale);
      this._vpY = cy - (cy - this._vpY) * (newScale / this._vpScale);
      this._vpScale = newScale;
    }, { passive: false });

    root.addEventListener("dblclick", (e) => {
      if (e.target.closest(".hj-polaroid-wrap") || e.target.closest(".hj-glass-block")) return;
      e.preventDefault();
      this._initViewport(root);
    });

    // Touch
    let lastTouchDist = 0;
    root.addEventListener("touchstart", (e) => {
      if (e.target.closest(".hj-polaroid-wrap")) return;
      if (e.touches.length === 2) {
        const dx = e.touches[0].clientX - e.touches[1].clientX, dy = e.touches[0].clientY - e.touches[1].clientY;
        lastTouchDist = Math.hypot(dx, dy);
      } else if (e.touches.length === 1) {
        this._dragState = { x: e.touches[0].clientX, y: e.touches[0].clientY, moved: 0 };
      }
    }, { passive: true });
    root.addEventListener("touchmove", (e) => {
      if (e.touches.length === 2) {
        e.preventDefault();
        const dx = e.touches[0].clientX - e.touches[1].clientX, dy = e.touches[0].clientY - e.touches[1].clientY;
        const dist = Math.hypot(dx, dy);
        if (lastTouchDist > 0) {
          const rect = root.getBoundingClientRect();
          const cx = (e.touches[0].clientX + e.touches[1].clientX) / 2 - rect.left;
          const cy = (e.touches[0].clientY + e.touches[1].clientY) / 2 - rect.top;
          const newScale = Math.max(this._vpBaseScale * 0.3, Math.min(this._vpBaseScale * 6, this._vpScale * (dist / lastTouchDist)));
          this._vpX = cx - (cx - this._vpX) * (newScale / this._vpScale);
          this._vpY = cy - (cy - this._vpY) * (newScale / this._vpScale);
          this._vpScale = newScale;
        }
        lastTouchDist = dist;
      } else if (e.touches.length === 1 && this._dragState) {
        const dx = e.touches[0].clientX - this._dragState.x, dy = e.touches[0].clientY - this._dragState.y;
        this._dragState.moved = (this._dragState.moved || 0) + Math.abs(dx) + Math.abs(dy);
        this._vpX += dx; this._vpY += dy;
        this._dragState.x = e.touches[0].clientX; this._dragState.y = e.touches[0].clientY;
      }
    }, { passive: false });
    root.addEventListener("touchend", () => { lastTouchDist = 0; this._dragState = null; }, { passive: true });

    this._cleanupMapListeners = () => { window.removeEventListener("mousemove", onMouseMove); window.removeEventListener("mouseup", onMouseUp); };

    // Tile sync
    const syncScrapTiles = (svgX, svgY, svgW, svgH) => {
      const ms = MAP_STYLES[this.mapStyle] || MAP_STYLES["opentopomap"];
      const srv = ms.subs; const buf = 1;
      const xMin = Math.floor(this.geo.minTX + svgX / TILE) - buf;
      const xMax = Math.floor(this.geo.minTX + (svgX + svgW) / TILE) + buf;
      const yMin = Math.floor(this.geo.minTY + svgY / TILE) - buf;
      const yMax = Math.floor(this.geo.minTY + (svgY + svgH) / TILE) + buf;
      const needed = (xMax - xMin + 1) * (yMax - yMin + 1);
      this._growTilePool(needed);
      let idx = 0;
      for (let x = xMin; x <= xMax; x++) {
        for (let y = yMin; y <= yMax; y++) {
          const node = this.tilePool[idx];
          let url = ms.url.replace("{z}", this.geo.zoom).replace("{x}", x).replace("{y}", y);
          if (srv.length > 0) url = url.replace("{s}", srv[Math.abs(x + y) % srv.length]);
          if (ms.needsApiKey) { const sk = getStadiaKey(); if (sk) url += (url.includes("?") ? "&" : "?") + "api_key=" + sk; }
          if (node.getAttribute("href") !== url) { node.setAttribute("href", url); node.setAttribute("x", `${(x - this.geo.minTX) * TILE}`); node.setAttribute("y", `${(y - this.geo.minTY) * TILE}`); }
          node.style.display = ""; idx++;
        }
      }
      for (; idx < this.tilePool.length; idx++) this.tilePool[idx].style.display = "none";
    };

    // Animation loop
    let _lastVbX = -9999, _lastVbY = -9999;
    const loop = () => {
      if (this._loopGen !== gen) return;
      this.raf = requestAnimationFrame(loop);
      const rw = root.offsetWidth || 0, rh = root.offsetHeight || 0;
      if (!rw || !rh) return;
      if (!this._vpInited) { this._initViewport(root); if (!this._vpInited) return; this._scrapTileDirty = true; }
      viewport.style.transform = `translate(${this._vpX}px,${this._vpY}px) scale(${this._vpScale})`;
      const svgX = -this._vpX / this._vpScale, svgY = -this._vpY / this._vpScale;
      const svgW = rw / this._vpScale, svgH = rh / this._vpScale;
      if (this._scrapTileDirty || Math.abs(svgX - _lastVbX) > TILE * 0.5 || Math.abs(svgY - _lastVbY) > TILE * 0.5) {
        _lastVbX = svgX; _lastVbY = svgY; this._scrapTileDirty = false;
        syncScrapTiles(svgX, svgY, svgW, svgH);
      }
    };
    this.raf = requestAnimationFrame(loop);
  }
}
// ============================================================
//  ILLUSTRATED MAP VIEWER
// ============================================================
class IllustratedViewer {
  constructor(container) {
    this.container = container;
    this.raf = 0;
    this._loopGen = 0;
    this._cleanupIllustListeners = null;
  }

  loadTrip(data, onBack, onSwitchTemplate) {
    this.trip = data;
    this.onBack = onBack;
    this.onSwitchTemplate = onSwitchTemplate;
    this.rebuild();
  }

  destroy() {
    this._loopGen++;
    if (this.raf) cancelAnimationFrame(this.raf);
    this.raf = 0;
    if (this._cleanupIllustListeners) this._cleanupIllustListeners();
    this.container.innerHTML = "";
  }

  _loadCanvasData() {
    try {
      const key = "hj-canvas-illust-" + (this.trip.name || "");
      const stored = localStorage.getItem(key);
      return stored ? JSON.parse(stored) : {};
    } catch(e) { return {}; }
  }

  _saveCanvasData(data) {
    try {
      const key = "hj-canvas-illust-" + (this.trip.name || "");
      localStorage.setItem(key, JSON.stringify(data));
    } catch(e) {}
  }

  rebuild() {
    this._loopGen++;
    const gen = this._loopGen;
    const c = this.container;
    c.innerHTML = "";
    const trip = this.trip;

    const prepared = prepareTrip(trip);
    if (!prepared) { createDiv(c, { text: t("noGps"), cls: "hj-empty" }); return; }
    Object.assign(this, prepared);
    this.hasTrack = this.hasGpx;
    this.mapStyle = trip.mapStyle || "opentopomap";

    // Compute photo offsets
    const offsetDist = this.geo.w * 0.25;
    const cardMinDist = offsetDist * 0.8;
    for (let i = 0; i < this.pts.length; i++) {
      const side = i % 2 === 0 ? -1 : 1;
      let cx = this.pts[i].x + side * offsetDist;
      let cy = this.pts[i].y + (i % 3 - 1) * offsetDist * 0.35;
      for (let attempt = 0; attempt < 6; attempt++) {
        let tooClose = false;
        for (let j = 0; j < i; j++) {
          if (Math.hypot(cx - this.pts[j].cardX, cy - this.pts[j].cardY) < cardMinDist) { cy += cardMinDist * 0.6; tooClose = true; break; }
        }
        if (!tooClose) break;
      }
      this.pts[i].cardX = cx; this.pts[i].cardY = cy;
      this.pts[i].rotation = side * (1.5 + Math.random() * 2.5);
      this.pts[i].sketchX = cx; this.pts[i].sketchY = cy + 160;
      this.pts[i].sketchRotation = side * (1 + Math.random() * 3);
    }

    // DOM Structure
    const root = createDiv(c, { cls: "hj-illust-root" });

    const scrollEl = createDiv(root, { cls: "hj-illust-scroll" });
    const spacer = createDiv(scrollEl, { cls: "hj-illust-spacer" });
    setTimeout(() => { const rh = root.clientHeight || 600; spacer.style.height = (this.pts.length + 2) * rh + "px"; }, 50);

    const canvas = createDiv(root, { cls: "hj-illust-canvas" });
    const viewport = createDiv(canvas, { cls: "hj-illust-viewport" });
    viewport.style.cssText = `position:absolute;left:0;top:0;width:${this.geo.w}px;height:${this.geo.h}px;transform-origin:0 0;will-change:transform;`;

    // SVG layer
    const svg = S("svg", { viewBox: `0 0 ${this.geo.w} ${this.geo.h}`, preserveAspectRatio: "none", class: "hj-fullsvg hj-illust-svg" });
    svg.style.cssText = `position:absolute;left:0;top:0;width:${this.geo.w}px;height:${this.geo.h}px;overflow:visible;`;
    viewport.appendChild(svg);

    const defs = S("defs", {}, svg);
    const glow = S("filter", { id: "illustRouteGlow", x: "-20%", y: "-20%", width: "140%", height: "140%" }, defs);
    S("feGaussianBlur", { in: "SourceGraphic", stdDeviation: "2", result: "blur" }, glow);
    const merge = S("feMerge", {}, glow);
    S("feMergeNode", { in: "blur" }, merge); S("feMergeNode", { in: "SourceGraphic" }, merge);

    this.mGrp = S("g", {}, svg);
    this.tileGroup = S("g", { style: "opacity:0.5;filter:saturate(0.5) brightness(1.1);" }, this.mGrp);

    this.tilePool = [];
    this._growTilePool = (needed) => {
      while (this.tilePool.length < needed) {
        const img = S("image", { width: `${TILE + 0.5}`, height: `${TILE + 0.5}`, preserveAspectRatio: "none", style: "display:none" }, this.tileGroup);
        this.tilePool.push(img);
      }
    };
    this._growTilePool(50);

    // GPX track
    let routeTotalLen = 0;
    if (this.hasTrack) {
      const step = Math.max(1, Math.floor(this.route.length / 600));
      const trackPts = [];
      for (let i = 0; i < this.route.length; i += step) trackPts.push(`${this.route[i].x},${this.route[i].y}`);
      trackPts.push(`${this.route[this.route.length - 1].x},${this.route[this.route.length - 1].y}`);
      const ptStr = trackPts.join(" ");
      S("polyline", { points: ptStr, fill: "none", stroke: "#94a3b8", "stroke-width": "2", "stroke-dasharray": "4 6", "stroke-linecap": "round", opacity: "0.35" }, this.mGrp);
      this._illustRoute = S("polyline", { points: ptStr, fill: "none", stroke: "#ef4444", "stroke-width": "3.5", "stroke-linecap": "round", "stroke-linejoin": "round", filter: "url(#illustRouteGlow)", opacity: "0" }, this.mGrp);
      setTimeout(() => {
        try { routeTotalLen = this._illustRoute.getTotalLength(); } catch(e) { routeTotalLen = this.totalDist; }
        this._illustRouteTotalLen = routeTotalLen;
        this._illustRoute.style.strokeDasharray = routeTotalLen;
        this._illustRoute.style.strokeDashoffset = routeTotalLen;
        this._illustRoute.setAttribute("opacity", "0.85");
      }, 100);
    }
    this._illustRouteTotalLen = routeTotalLen;

    // Arrow connections (photo → GPS point)
    const arrowDefs = S("defs", {}, this.mGrp);
    const marker = S("marker", { id: "hjArrowHead", viewBox: "0 0 10 10", refX: "9", refY: "5", markerWidth: "8", markerHeight: "8", orient: "auto-start-reverse" }, arrowDefs);
    S("path", { d: "M 1 2 L 9 5 L 1 8", fill: "none", stroke: "#292524", "stroke-width": "2", "stroke-linecap": "round", "stroke-linejoin": "round" }, marker);

    const connGrp = S("g", {}, this.mGrp);
    this._illustConns = [];
    for (let i = 0; i < this.pts.length; i++) {
      const pt = this.pts[i];
      const g = S("g", { opacity: "0", style: "transition:opacity 0.6s ease" }, connGrp);
      const x1 = pt.cardX, y1 = pt.cardY, x2 = pt.x, y2 = pt.y;
      const dx = x2 - x1, dy = y2 - y1, len = Math.sqrt(dx * dx + dy * dy);
      const side = i % 2 === 0 ? 1 : -1;
      const curvature = len * 0.15 * side;
      const mx = (x1 + x2) / 2 + (-dy / len) * curvature, my = (y1 + y2) / 2 + (dx / len) * curvature;
      S("path", { d: `M ${x1} ${y1} Q ${mx} ${my} ${x2} ${y2}`, fill: "none", stroke: "#292524", "stroke-width": "2.5", "stroke-linecap": "round", opacity: "0.75", "marker-end": "url(#hjArrowHead)" }, g);
      S("circle", { cx: pt.x, cy: pt.y, r: "4.5", fill: "none", stroke: "#292524", "stroke-width": "2", opacity: "0.8" }, g);
      this._illustConns.push(g);
    }

    // Helper to update arrow path
    const updateArrowPath = (connG, x1, y1, x2, y2, sideIdx) => {
      const pathEl = connG.querySelector("path");
      if (!pathEl) return;
      const dx = x2 - x1, dy = y2 - y1, len = Math.sqrt(dx * dx + dy * dy);
      if (len < 1) return;
      const side = sideIdx % 2 === 0 ? 1 : -1;
      const curvature = len * 0.15 * side;
      const mx = (x1 + x2) / 2 + (-dy / len) * curvature, my = (y1 + y2) / 2 + (dx / len) * curvature;
      pathEl.setAttribute("d", `M ${x1} ${y1} Q ${mx} ${my} ${x2} ${y2}`);
    };

    // Text block layer
    const textBlockLayer = createDiv(viewport);
    textBlockLayer.style.cssText = `position:absolute;left:0;top:0;width:${this.geo.w}px;height:${this.geo.h}px;pointer-events:none;z-index:1;`;

    // Overlay layer (photos + labels)
    const overlayLayer = createDiv(viewport, { cls: "hj-illust-overlay" });
    overlayLayer.style.cssText = `position:absolute;left:0;top:0;width:${this.geo.w}px;height:${this.geo.h}px;pointer-events:none;z-index:2;`;

    // Make draggable helper
    const makeDraggable = (wrap, idx, type) => {
      wrap.style.cursor = "grab";
      let dragStartX, dragStartY, startLeft, startTop, isDragging = false, dragMoved = 0;
      wrap.addEventListener("pointerdown", (e) => {
        if (e.button !== 0) return;
        e.stopPropagation();
        isDragging = true; dragMoved = 0; wrap._wasDragged = false;
        wrap.style.cursor = "grabbing"; wrap.style.zIndex = "100";
        dragStartX = e.clientX; dragStartY = e.clientY;
        startLeft = parseFloat(wrap.style.left); startTop = parseFloat(wrap.style.top);
        const onPointerMove = (e2) => {
          if (!isDragging) return;
          dragMoved += Math.abs(e2.clientX - dragStartX) + Math.abs(e2.clientY - dragStartY);
          const r2 = viewport.getBoundingClientRect();
          const s2 = r2.width / this.geo.w;
          const dx = (e2.clientX - dragStartX) / s2, dy = (e2.clientY - dragStartY) / s2;
          const newX = startLeft + dx, newY = startTop + dy;
          wrap.style.left = newX + "px"; wrap.style.top = newY + "px";
          if (type === "photo" && this._illustConns[idx]) updateArrowPath(this._illustConns[idx], newX, newY, this.pts[idx].x, this.pts[idx].y, idx);
        };
        const onPointerUp = () => {
          isDragging = false;
          if (dragMoved > 5) wrap._wasDragged = true;
          wrap.style.cursor = "grab";
          if (!wrap._wasDragged) wrap.style.zIndex = "";
          document.removeEventListener("pointermove", onPointerMove);
          document.removeEventListener("pointerup", onPointerUp);
          if (dragMoved > 5) { this._illustCanvasDirty = true; if (this._saveIllustCanvasDebounced) this._saveIllustCanvasDebounced(); }
        };
        document.addEventListener("pointermove", onPointerMove);
        document.addEventListener("pointerup", onPointerUp);
      });
    };

    // Photo + Sketch overlays (flip cards: front=photo, back=sketch)
    this._illustOverlays = [];
    this._illustSketchOverlays = []; // back faces, for sketch generation compat
    this._illustSketchConns = [];
    this._activeIllustCard = null;
    for (let i = 0; i < this.pts.length; i++) {
      const pt = this.pts[i];
      const wrap = createDiv(overlayLayer, { cls: "hj-illust-photo-wrap" });
      wrap.style.left = pt.cardX + "px"; wrap.style.top = pt.cardY + "px";
      wrap.dataset.rotation = pt.rotation;

      // Flippable card (perspective container)
      const flipCard = createDiv(wrap, { cls: "hj-illust-flip-card" });
      const flipInner = createDiv(flipCard, { cls: "hj-illust-flip-inner" });

      // Front face: photo
      const frontFace = createDiv(flipInner, { cls: "hj-illust-flip-front" });
      const photos = pt.photos && pt.photos.length > 0 ? pt.photos : [];
      if (photos.length > 0) {
        const imgEl = createEl(frontFace, "img", { cls: "hj-illust-photo" });
        imgEl.draggable = false;
        if (photos[0].imageUrl) imgEl.src = photos[0].imageUrl;
      } else {
        createDiv(frontFace, { text: "\u{1F4CD}", cls: "hj-illust-photo-placeholder" });
      }

      // Back face: sketch
      const backFace = createDiv(flipInner, { cls: "hj-illust-flip-back" });
      const skImg = createEl(backFace, "img", { cls: "hj-illust-sketch" });
      skImg.draggable = false; skImg.style.display = "none";
      const delBtn = createDiv(backFace, { cls: "hj-illust-sketch-del" });
      delBtn.innerHTML = "\u2715"; delBtn.title = "Delete sketch"; delBtn.style.display = "none";
      const noSketchDiv = createDiv(backFace, { cls: "hj-illust-no-sketch", text: "Waiting for your sketch" });

      // Label
      createDiv(wrap, { text: pt.title || "Location", cls: "hj-illust-label" });

      // Click: single = zoom, double = flip
      let cardStage = "normal", _isFlipped = false, _clickTimer = null;
      const resetCard = () => {
        flipCard.classList.remove("hj-illust-flipped");
        flipInner.style.transform = "";
        wrap.style.zIndex = "";
        cardStage = "normal"; _isFlipped = false;
      };
      flipCard.addEventListener("click", (e) => {
        if (wrap._wasDragged) { wrap._wasDragged = false; return; }
        e.stopPropagation();
        if (_clickTimer) {
          // Double click detected
          clearTimeout(_clickTimer); _clickTimer = null;
          // Toggle flip
          if (_isFlipped) {
            _isFlipped = false;
            flipCard.classList.remove("hj-illust-flipped");
            flipInner.style.transform = "scale(1.6)";
          } else {
            _isFlipped = true;
            flipCard.classList.add("hj-illust-flipped");
            flipInner.style.transform = "rotateY(180deg) scale(1.6)";
          }
          wrap.style.zIndex = "200"; cardStage = "zoomed";
          this._activeIllustCard = flipCard;
          this._activeIllustCard._resetFn = resetCard;
        } else {
          // Wait to see if it's a double click
          _clickTimer = setTimeout(() => {
            _clickTimer = null;
            // Single click: zoom in
            if (cardStage === "normal") {
              if (this._activeIllustCard && this._activeIllustCard !== flipCard) this._activeIllustCard._resetFn();
              flipInner.style.transform = _isFlipped ? "rotateY(180deg) scale(1.6)" : "scale(1.6)";
              wrap.style.zIndex = "200"; cardStage = "zoomed";
              this._activeIllustCard = flipCard;
              this._activeIllustCard._resetFn = resetCard;
            }
          }, 250);
        }
      });
      delBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        skImg.src = ""; skImg.style.display = "none";
        delBtn.style.display = "none"; noSketchDiv.style.display = "";
        resetCard();
        if (this._activeIllustCard === flipCard) this._activeIllustCard = null;
        this._illustCanvasDirty = true;
        if (this._saveIllustCanvasDebounced) this._saveIllustCanvasDebounced();
      });

      // Make wrap draggable
      makeDraggable(wrap, i, "photo");

      this._illustOverlays.push(wrap);
      this._illustSketchOverlays.push(backFace);
    }

    // Glass text blocks
    this._illustTextBlocks = [];
    this._illustCanvasDirty = false;

    const createIllustTextBlock = (x, y, w, h, text, id) => {
      const blockId = id || "tb-" + Date.now() + "-" + Math.random().toString(36).slice(2, 6);
      const block = createDiv(textBlockLayer, { cls: "hj-glass-block" });
      block.style.cssText = "position:absolute;left:" + x + "px;top:" + y + "px;width:" + w + "px;min-height:" + h + "px;pointer-events:auto;";
      block.dataset.blockId = blockId;
      let nearestI = 0, nearestD = Infinity;
      for (let pi = 0; pi < this.pts.length; pi++) {
        const d = Math.hypot(x - this.pts[pi].x, y - this.pts[pi].y);
        if (d < nearestD) { nearestD = d; nearestI = pi; }
      }
      block.dataset.revealIdx = String(nearestI);

      const handle = createDiv(block, { cls: "hj-glass-handle" }); handle.textContent = "\u2261";
      const content = createDiv(block, { cls: "hj-glass-content" });
      content.setAttribute("contenteditable", "true"); content.setAttribute("spellcheck", "false");
      content.innerHTML = text || "";
      content.addEventListener("input", () => { this._illustCanvasDirty = true; this._saveIllustCanvasDebounced(); });
      content.addEventListener("mousedown", (e) => e.stopPropagation());
      content.addEventListener("pointerdown", (e) => e.stopPropagation());

      const delBtn = createDiv(block, { cls: "hj-glass-delete" }); delBtn.textContent = "\u00d7";
      delBtn.addEventListener("click", (e) => { e.stopPropagation(); block.remove(); this._illustTextBlocks = this._illustTextBlocks.filter(b => b.id !== blockId); this._illustCanvasDirty = true; this._saveIllustCanvasDebounced(); });

      const resizeH = createDiv(block, { cls: "hj-glass-resize" });
      resizeH.addEventListener("pointerdown", (e) => {
        e.stopPropagation();
        let resizing = true;
        const sw = block.offsetWidth, sh = block.offsetHeight, sx = e.clientX, sy = e.clientY;
        const rect = viewport.getBoundingClientRect(); const scale = rect.width / this.geo.w;
        const onM = (e2) => { if (!resizing) return; block.style.width = Math.max(100, sw + (e2.clientX - sx) / scale) + "px"; block.style.minHeight = Math.max(60, sh + (e2.clientY - sy) / scale) + "px"; };
        const onU = () => { resizing = false; document.removeEventListener("pointermove", onM); document.removeEventListener("pointerup", onU); this._illustCanvasDirty = true; this._saveIllustCanvasDebounced(); };
        document.addEventListener("pointermove", onM); document.addEventListener("pointerup", onU);
      });

      handle.addEventListener("pointerdown", (e) => {
        e.stopPropagation();
        let dragging = true; handle.style.cursor = "grabbing";
        const rect = viewport.getBoundingClientRect(); const scale = rect.width / this.geo.w;
        const sx = e.clientX, sy = e.clientY;
        const sl = parseFloat(block.style.left), st = parseFloat(block.style.top);
        const onM = (e2) => { if (!dragging) return; const r2 = viewport.getBoundingClientRect(); const s2 = r2.width / this.geo.w; block.style.left = (sl + (e2.clientX - sx) / s2) + "px"; block.style.top = (st + (e2.clientY - sy) / s2) + "px"; };
        const onU = () => {
          dragging = false; handle.style.cursor = "grab";
          document.removeEventListener("pointermove", onM); document.removeEventListener("pointerup", onU);
          const newBx = parseFloat(block.style.left), newBy = parseFloat(block.style.top);
          let bestI = 0, bestD = Infinity;
          for (let pi = 0; pi < this.pts.length; pi++) { const dd = Math.hypot(newBx - this.pts[pi].x, newBy - this.pts[pi].y); if (dd < bestD) { bestD = dd; bestI = pi; } }
          block.dataset.revealIdx = String(bestI);
          this._illustCanvasDirty = true; this._saveIllustCanvasDebounced();
        };
        document.addEventListener("pointermove", onM); document.addEventListener("pointerup", onU);
      });

      const tbData = { id: blockId, el: block, content, revealIdx: nearestI };
      this._illustTextBlocks.push(tbData);
      return tbData;
    };

    // Restore canvas data from localStorage
    const illustCanvasData = this._loadCanvasData();
    if (illustCanvasData.textBlocks) {
      for (const tb of illustCanvasData.textBlocks) createIllustTextBlock(tb.x, tb.y, tb.w || 200, tb.h || 80, tb.text, tb.id);
    }
    if (illustCanvasData.photos) {
      for (const saved of illustCanvasData.photos) {
        const idx = this.pts.findIndex(p => p.id === saved.id || p.title === saved.title);
        if (idx >= 0 && this._illustOverlays[idx]) {
          this._illustOverlays[idx].style.left = saved.x + "px"; this._illustOverlays[idx].style.top = saved.y + "px";
          if (this._illustConns[idx]) updateArrowPath(this._illustConns[idx], saved.x, saved.y, this.pts[idx].x, this.pts[idx].y, idx);
        }
      }
    }
    if (illustCanvasData.sketches) {
      for (const saved of illustCanvasData.sketches) {
        const idx = this.pts.findIndex(p => p.id === saved.id || p.title === saved.title);
        if (idx >= 0 && this._illustSketchOverlays[idx]) {
          this._illustSketchOverlays[idx].style.left = saved.x + "px"; this._illustSketchOverlays[idx].style.top = saved.y + "px";
          if (this._illustSketchConns[idx]) updateArrowPath(this._illustSketchConns[idx], saved.x, saved.y, this.pts[idx].x, this.pts[idx].y, idx);
        }
      }
    }

    // Debounced save
    let _illustSaveTimer = null;
    this._saveIllustCanvasDebounced = () => {
      if (_illustSaveTimer) clearTimeout(_illustSaveTimer);
      _illustSaveTimer = setTimeout(() => {
        if (!this._illustCanvasDirty) return;
        this._illustCanvasDirty = false;
        this._saveCanvasData({
          photos: this._illustOverlays.map((el, i) => ({ id: this.pts[i].id || "", title: this.pts[i].title || "", x: Math.round(parseFloat(el.style.left)), y: Math.round(parseFloat(el.style.top)) })),
          textBlocks: this._illustTextBlocks.map(tb => ({ id: tb.id, x: Math.round(parseFloat(tb.el.style.left)), y: Math.round(parseFloat(tb.el.style.top)), w: Math.round(tb.el.offsetWidth), h: Math.round(tb.el.offsetHeight), text: tb.content.innerHTML }))
        });
      }, 1500);
    };

    // HUD
    const hud = createDiv(root, { cls: "hj-illust-hud" });
    const hudTitle = createDiv(hud, { cls: "hj-illust-hud-title" });
    createEl(hudTitle, "h1", { text: trip.name });
    createEl(hudTitle, "p", { text: (t("template.illustrated") || "ILLUSTRATED MAP").toUpperCase() });

    const backBtn = createDiv(hud, { cls: "hj-illust-back-btn" });
    backBtn.textContent = "\u2190 " + t("trip.backToMap");
    backBtn.addEventListener("click", () => this.onBack());
    buildTemplateSwitcher(hud, trip.template, (tmpl) => this.onSwitchTemplate(tmpl));

    // Generate Sketches button
    const sketchBtn = createDiv(hud, { cls: "hj-illust-sketch-btn" });
    sketchBtn.textContent = t("illust.generateSketches") || "Generate Pen Drawings";
    sketchBtn.addEventListener("click", async () => {
      const apiKey = getApiKey();
      if (!apiKey) { showSettingsModal(); return; }
      sketchBtn.textContent = t("illust.generatingSketches") || "Generating...";
      sketchBtn.style.opacity = "0.6"; sketchBtn.style.pointerEvents = "none";

      let generated = 0;
      for (let i = 0; i < this.pts.length; i++) {
        const pt = this.pts[i];
        const photos = pt.photos && pt.photos.length > 0 ? pt.photos : [];
        if (photos.length === 0 || !photos[0].imageUrl) continue;
        try {
          sketchBtn.textContent = (t("illust.sketchProgress") || "Generating {0}/{1}...").replace("{0}", i + 1).replace("{1}", this.pts.length);
          // Fetch photo as base64
          const resp = await fetch(photos[0].imageUrl);
          const blob = await resp.blob();
          const reader = new FileReader();
          const base64 = await new Promise((resolve) => { reader.onload = () => resolve(reader.result.split(",")[1]); reader.readAsDataURL(blob); });
          const mimeType = blob.type || "image/jpeg";
          const result = await generatePhotoSketch(base64, mimeType, apiKey);

          // Show sketch on back face of flip card
          const backFace = this._illustSketchOverlays[i];
          if (backFace && result && result.base64) {
            const skImg = backFace.querySelector(".hj-illust-sketch");
            const delBtn = backFace.querySelector(".hj-illust-sketch-del");
            const noSketchEl = backFace.querySelector(".hj-illust-no-sketch");
            if (skImg) { skImg.src = "data:" + (result.mimeType || "image/png") + ";base64," + result.base64; skImg.style.display = ""; }
            if (delBtn) delBtn.style.display = "";
            if (noSketchEl) noSketchEl.style.display = "none";
          }
          generated++;
        } catch(err) { console.error("[Sketch] Error for", pt.title, err); }
      }

      sketchBtn.style.opacity = "1"; sketchBtn.style.pointerEvents = "";
      if (generated > 0) {
        this._illustForceReveal = true;
        sketchBtn.textContent = (t("illust.sketchDone") || "Sketches Done") + " (" + generated + ")";
      } else {
        sketchBtn.textContent = t("illust.generateSketches") || "Generate Pen Drawings";
      }
    });

    // Add text block button
    const addTextBtn = createDiv(root, { cls: "hj-illust-addtext-btn" });
    addTextBtn.innerHTML = "&#x1F4DD;";
    addTextBtn.title = "Add Text Block";

    // Progress bar
    const progressBar = createDiv(root, { cls: "hj-illust-progress-bar" });
    const progressFill = createDiv(progressBar, { cls: "hj-illust-progress-fill" });

    // Map style switcher
    buildMapSwitcher(root, this.mapStyle, (key) => {
      this.mapStyle = key;
      for (const node of this.tilePool) { node.removeAttribute("href"); node.style.display = "none"; }
      this._illustTileDirty = true;
    });

    // Hint
    const hint = createDiv(root, { cls: "hj-illust-hint" });
    const _isTouch = "ontouchstart" in window || navigator.maxTouchPoints > 0;
    hint.textContent = _isTouch ? "\u2B07\uFE0F Scroll to explore \u00B7 Pinch to zoom" : "\u2B07\uFE0F Scroll to explore \u00B7 Ctrl+Wheel to zoom";
    setTimeout(() => { hint.style.opacity = "0"; hint.style.transition = "opacity 1.5s ease"; }, 5000);

    // Viewport state
    let vpX = 0, vpY = 0, vpScale = 1, vpBaseScale = 1, vpInited = false;
    const initVp = () => {
      const rw = root.offsetWidth, rh = root.offsetHeight;
      if (!rw || !rh) return;
      vpBaseScale = Math.max(rw / this.geo.w, rh / this.geo.h) * 2.0;
      vpScale = vpBaseScale; vpInited = true;
      this._illustTileDirty = true;
    };

    addTextBtn.addEventListener("click", () => {
      const rw = root.offsetWidth, rh = root.offsetHeight;
      const cx = (rw / 2 - vpX) / vpScale, cy = (rh / 2 - vpY) / vpScale;
      const newTb = createIllustTextBlock(cx - 100, cy - 40, 200, 80, "");
      newTb.el.classList.add("hj-illust-visible");
      newTb.content.focus();
      this._illustCanvasDirty = true; this._saveIllustCanvasDebounced();
    });

    // Wheel: Ctrl+wheel = zoom, normal wheel = scroll
    root.addEventListener("wheel", (e) => {
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault(); e.stopPropagation();
        const factor = e.deltaY > 0 ? 0.9 : 1.1;
        const newScale = Math.max(vpBaseScale * 0.15, Math.min(vpBaseScale * 5, vpScale * factor));
        const rw = root.offsetWidth, rh = root.offsetHeight;
        const cx = rw / 2, cy = rh / 2;
        vpX = cx - (cx - vpX) * (newScale / vpScale);
        vpY = cy - (cy - vpY) * (newScale / vpScale);
        vpScale = newScale;
        this._illustTileDirty = true;
      } else {
        scrollEl.scrollTop += e.deltaY;
      }
    }, { passive: false });

    // Drag to pan map
    let _dragState = null, _lastScrollTop = scrollEl.scrollTop;
    this._illustUserPanning = false;
    root.addEventListener("mousedown", (e) => {
      if (e.button !== 0) return;
      if (e.target.closest(".hj-illust-photo-wrap") || e.target.closest(".hj-illust-sketch-wrap")) return;
      if (e.target.closest(".hj-illust-hud") || e.target.closest(".hj-map-switcher")) return;
      if (e.target.closest(".hj-glass-block") || e.target.closest(".hj-illust-addtext-btn")) return;
      _dragState = { x: e.clientX, y: e.clientY, moved: 0, scrollTop: scrollEl.scrollTop };
      root.style.cursor = "grabbing";
    });
    const scrollObserver = () => {
      if (_dragState) return;
      const newTop = scrollEl.scrollTop;
      if (Math.abs(newTop - _lastScrollTop) > 5 && this._illustUserPanning) this._illustUserPanning = false;
      _lastScrollTop = newTop;
    };
    scrollEl.addEventListener("scroll", scrollObserver, { passive: true });

    const onMouseMove = (e) => {
      if (!_dragState) return;
      const dx = e.clientX - _dragState.x, dy = e.clientY - _dragState.y;
      _dragState.moved += Math.abs(dx) + Math.abs(dy);
      if (_dragState.moved > 8) {
        scrollEl.scrollTop = _dragState.scrollTop;
        vpX += dx; vpY += dy;
        this._illustTileDirty = true; this._illustUserPanning = true;
      }
      _dragState.x = e.clientX; _dragState.y = e.clientY;
    };
    const onMouseUp = () => { if (!_dragState) return; _dragState = null; root.style.cursor = ""; };
    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp);

    // Touch support
    let _illustLastTouchDist = 0, _illustTouchMode = null, _illustTouchStartY = 0;
    root.addEventListener("touchstart", (e) => {
      if (e.target.closest(".hj-illust-photo-wrap") || e.target.closest(".hj-illust-sketch-wrap")) return;
      if (e.target.closest(".hj-illust-hud") || e.target.closest(".hj-map-switcher")) return;
      if (e.target.closest(".hj-glass-block") || e.target.closest(".hj-illust-addtext-btn")) return;
      if (e.touches.length === 2) {
        _illustTouchMode = "pinch";
        const dx = e.touches[0].clientX - e.touches[1].clientX, dy = e.touches[0].clientY - e.touches[1].clientY;
        _illustLastTouchDist = Math.hypot(dx, dy);
        _dragState = { x: (e.touches[0].clientX + e.touches[1].clientX) / 2, y: (e.touches[0].clientY + e.touches[1].clientY) / 2, moved: 0, scrollTop: scrollEl.scrollTop };
      } else if (e.touches.length === 1) {
        _illustTouchMode = null;
        _illustTouchStartY = e.touches[0].clientY;
        _dragState = { x: e.touches[0].clientX, y: e.touches[0].clientY, moved: 0, scrollTop: scrollEl.scrollTop };
      }
    }, { passive: true });
    root.addEventListener("touchmove", (e) => {
      if (e.touches.length === 2) {
        e.preventDefault();
        const dx = e.touches[0].clientX - e.touches[1].clientX, dy = e.touches[0].clientY - e.touches[1].clientY;
        const dist = Math.hypot(dx, dy);
        if (_illustLastTouchDist > 0) {
          const rect = root.getBoundingClientRect();
          const cx = (e.touches[0].clientX + e.touches[1].clientX) / 2 - rect.left;
          const cy = (e.touches[0].clientY + e.touches[1].clientY) / 2 - rect.top;
          const newScale = Math.max(vpBaseScale * 0.15, Math.min(vpBaseScale * 5, vpScale * (dist / _illustLastTouchDist)));
          vpX = cx - (cx - vpX) * (newScale / vpScale);
          vpY = cy - (cy - vpY) * (newScale / vpScale);
          vpScale = newScale; this._illustTileDirty = true;
        }
        _illustLastTouchDist = dist;
        if (_dragState) {
          const mx = (e.touches[0].clientX + e.touches[1].clientX) / 2;
          const my = (e.touches[0].clientY + e.touches[1].clientY) / 2;
          vpX += mx - _dragState.x; vpY += my - _dragState.y;
          _dragState.x = mx; _dragState.y = my;
          this._illustTileDirty = true; this._illustUserPanning = true;
        }
      } else if (e.touches.length === 1 && _dragState) {
        const dx = e.touches[0].clientX - _dragState.x, dy = e.touches[0].clientY - _dragState.y;
        _dragState.moved = (_dragState.moved || 0) + Math.abs(dx) + Math.abs(dy);
        if (!_illustTouchMode && _dragState.moved > 10) {
          const absDx = Math.abs(e.touches[0].clientX - _dragState.x);
          const absDy = Math.abs(e.touches[0].clientY - _illustTouchStartY);
          _illustTouchMode = (absDy > absDx * 1.5) ? "scroll" : "pan";
        }
        if (_illustTouchMode === "scroll") { scrollEl.scrollTop -= dy; _dragState.y = e.touches[0].clientY; _dragState.x = e.touches[0].clientX; }
        else if (_illustTouchMode === "pan") { e.preventDefault(); scrollEl.scrollTop = _dragState.scrollTop; vpX += dx; vpY += dy; _dragState.x = e.touches[0].clientX; _dragState.y = e.touches[0].clientY; this._illustTileDirty = true; this._illustUserPanning = true; }
      }
    }, { passive: false });
    root.addEventListener("touchend", () => { _illustLastTouchDist = 0; _illustTouchMode = null; _dragState = null; root.style.cursor = ""; }, { passive: true });

    this._cleanupIllustListeners = () => { window.removeEventListener("mousemove", onMouseMove); window.removeEventListener("mouseup", onMouseUp); };

    // Click blank area to dismiss active zoomed/flipped card
    root.addEventListener("click", (e) => {
      if (e.target.closest(".hj-illust-photo-wrap, .hj-illust-flip-card, .hj-illust-hud, .hj-map-switcher, .hj-glass-block, .hj-illust-addtext-btn")) return;
      if (this._activeIllustCard && this._activeIllustCard._resetFn) {
        this._activeIllustCard._resetFn();
        this._activeIllustCard = null;
      }
    });

    // Click blank area to dismiss active zoomed/flipped card
    root.addEventListener("click", (e) => {
      if (e.target.closest(".hj-illust-photo-wrap, .hj-illust-flip-card, .hj-illust-hud, .hj-map-switcher, .hj-glass-block, .hj-illust-addtext-btn")) return;
      if (this._activeIllustCard && this._activeIllustCard._resetFn) {
        this._activeIllustCard._resetFn();
        this._activeIllustCard = null;
      }
    });

    // Tile sync
    const syncTiles = (svgX, svgY, svgW, svgH) => {
      const ms = MAP_STYLES[this.mapStyle] || MAP_STYLES["opentopomap"];
      const srv = ms.subs; const buf = 1;
      const xMin = Math.floor(this.geo.minTX + svgX / TILE) - buf;
      const xMax = Math.floor(this.geo.minTX + (svgX + svgW) / TILE) + buf;
      const yMin = Math.floor(this.geo.minTY + svgY / TILE) - buf;
      const yMax = Math.floor(this.geo.minTY + (svgY + svgH) / TILE) + buf;
      const needed = (xMax - xMin + 1) * (yMax - yMin + 1);
      this._growTilePool(needed);
      let idx = 0;
      for (let x = xMin; x <= xMax; x++) {
        for (let y = yMin; y <= yMax; y++) {
          const node = this.tilePool[idx];
          let url = ms.url.replace("{z}", this.geo.zoom).replace("{x}", x).replace("{y}", y);
          if (srv.length > 0) url = url.replace("{s}", srv[Math.abs(x + y) % srv.length]);
          if (ms.needsApiKey) { const sk = getStadiaKey(); if (sk) url += (url.includes("?") ? "&" : "?") + "api_key=" + sk; }
          if (node.getAttribute("href") !== url) { node.setAttribute("href", url); node.setAttribute("x", `${(x - this.geo.minTX) * TILE}`); node.setAttribute("y", `${(y - this.geo.minTY) * TILE}`); }
          node.style.display = ""; idx++;
        }
      }
      for (; idx < this.tilePool.length; idx++) this.tilePool[idx].style.display = "none";
    };

    // Animation loop
    const _isMobileDevice = "ontouchstart" in window || navigator.maxTouchPoints > 0;
    let _lastFrameTime = 0;
    const _frameInterval = _isMobileDevice ? 33 : 0;
    let _lastTileVpX = -9999, _lastTileVpY = -9999;
    let prevRevealIdx = -1;

    const loop = () => {
      if (this._loopGen !== gen) return;
      this.raf = requestAnimationFrame(loop);

      if (_frameInterval > 0) { const now = performance.now(); if (now - _lastFrameTime < _frameInterval) return; _lastFrameTime = now; }

      const rw = root.offsetWidth || 0, rh = root.offsetHeight || 0;
      if (!rw || !rh) return;
      if (!vpInited) { initVp(); if (!vpInited) return; }

      const scrollTop = scrollEl.scrollTop;
      const scrollH = scrollEl.scrollHeight - rh;
      const progress = scrollH > 0 ? Math.max(0, Math.min(1, scrollTop / scrollH)) : 0;
      const sp = progress * this.pts.length;

      progressFill.style.width = (progress * 100) + "%";

      let tipX, tipY, tipDist = 0;
      const fi = Math.min(Math.floor(sp), this.pts.length - 1);
      const fp = fi === this.pts.length - 1 ? Math.min(1, sp - fi) : sp - fi;

      if (this.hasTrack && this.pts.length > 0) {
        const d1 = this.pts[fi].trackDist;
        const d2 = fi < this.pts.length - 1 ? this.pts[fi + 1].trackDist : this.totalDist;
        tipDist = d1 + (d2 - d1) * fp;
        if (fi === 0 && this.pts[0].trackDist > 0) tipDist = fp * this.pts[0].trackDist;
        const tip = interpAt(tipDist, this.route, this.routeDists);
        tipX = tip.x; tipY = tip.y;
      } else if (this.pts.length > 0) {
        tipX = this.pts[fi].x; tipY = this.pts[fi].y;
        if (fi < this.pts.length - 1) { tipX += (this.pts[fi + 1].x - this.pts[fi].x) * fp; tipY += (this.pts[fi + 1].y - this.pts[fi].y) * fp; }
      } else { tipX = this.geo.w / 2; tipY = this.geo.h / 2; }

      if (!this._illustUserPanning) {
        const targetVpX = rw / 2 - tipX * vpScale, targetVpY = rh / 2 - tipY * vpScale;
        const dx2 = targetVpX - vpX, dy2 = targetVpY - vpY;
        const gap = Math.sqrt(dx2 * dx2 + dy2 * dy2);
        const lerp = gap > TILE * 3 ? 0.35 : gap > TILE ? 0.2 : 0.1;
        vpX += dx2 * lerp; vpY += dy2 * lerp;
      }

      viewport.style.transform = `translate(${vpX}px,${vpY}px) scale(${vpScale})`;

      const svgX = -vpX / vpScale, svgY = -vpY / vpScale;
      const svgW = rw / vpScale, svgH = rh / vpScale;
      if (this._illustTileDirty || Math.abs(svgX - _lastTileVpX) > TILE * 0.4 || Math.abs(svgY - _lastTileVpY) > TILE * 0.4) {
        _lastTileVpX = svgX; _lastTileVpY = svgY; this._illustTileDirty = false;
        syncTiles(svgX, svgY, svgW, svgH);
      }

      if (this._illustRoute && this._illustRouteTotalLen > 0) {
        const routeProgress = this.hasTrack ? Math.min(1, tipDist / this.totalDist) : progress;
        this._illustRoute.style.strokeDashoffset = this._illustRouteTotalLen * (1 - routeProgress);
      }

      const revealIdx = Math.floor(sp - 0.3);
      const forceReveal = this._illustForceReveal;
      if (forceReveal) this._illustForceReveal = false;
      if (revealIdx !== prevRevealIdx || forceReveal) {
        prevRevealIdx = revealIdx;
        for (let i = 0; i < this._illustOverlays.length; i++) {
          const visible = i <= revealIdx;
          this._illustOverlays[i].classList.toggle("hj-illust-visible", visible);
          if (this._illustConns[i]) this._illustConns[i].setAttribute("opacity", visible ? "1" : "0");
          // Sketches are now on the back of photo flip cards — no separate reveal needed
        }
        if (this._illustTextBlocks) {
          for (const tb of this._illustTextBlocks) {
            const tbRI = parseInt(tb.el.dataset.revealIdx || "0");
            tb.el.classList.toggle("hj-illust-visible", tbRI <= revealIdx);
          }
        }
      }
    };
    this.raf = requestAnimationFrame(loop);
  }
}
// ============================================================
//  GLOBAL MAP VIEWER (Leaflet)
// ============================================================
class GlobalMapViewer {
  constructor(container) {
    this.container = container;
    this.map = null;
    this.markers = [];
    this.gpxLayers = [];
    this.gpxLoaded = new Set();
    this.trips = [];
  }

  loadTrips(trips) {
    this.trips = trips;
    this.build();
  }

  destroy() {
    if (this._resizeObs) { this._resizeObs.disconnect(); this._resizeObs = null; }
    if (this.map) { this.map.remove(); this.map = null; }
    this.markers = [];
    this.gpxLayers = [];
    this.gpxLoaded.clear();
  }

  build() {
    if (this.map) { this.map.remove(); this.map = null; }
    this.container.innerHTML = "";
    const trips = this.trips;

    // Create map div
    const mapDiv = document.createElement("div");
    mapDiv.style.cssText = "width:100%; height:100%;";
    this.container.appendChild(mapDiv);

    this.map = L.map(mapDiv, {
      center: [20, 0],
      zoom: 2,
      minZoom: 2,
      worldCopyJump: true,
      zoomControl: false,
      attributionControl: false
    });

    // CARTO Voyager base layer
    L.tileLayer("https://{s}.basemaps.cartocdn.com/rastertiles/voyager_nolabels/{z}/{x}/{y}{r}.png", {
      subdomains: "abcd", maxZoom: 19,
      attribution: "&copy; OpenStreetMap &copy; CARTO"
    }).addTo(this.map);

    // OpenTopoMap overlay (fades in at zoom >= 10)
    const topoLayer = L.tileLayer("https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png", {
      subdomains: "abc", maxZoom: 17, opacity: 0
    }).addTo(this.map);

    this.map.on("zoomend", () => {
      const z = this.map.getZoom();
      topoLayer.setOpacity(z >= 10 ? Math.min(0.4, (z - 10) * 0.1) : 0);
    });

    // Controls
    L.control.zoom({ position: "bottomright" }).addTo(this.map);
    L.control.attribution({ position: "bottomleft", prefix: false })
      .addAttribution('&copy; <a href="https://carto.com">CARTO</a> &middot; <a href="https://opentopomap.org">OpenTopoMap</a>')
      .addTo(this.map);

    // Stats bar
    this._buildStats();

    // Add markers
    this._addMarkers();

    // Load GPX tracks when zoomed in
    this.map.on("zoomend moveend", () => this._loadVisibleGpx());

    // Fit bounds to show all trips
    if (trips.length > 0) {
      const bounds = trips.map(t => [t.lat, t.lng]);
      this.map.fitBounds(bounds, { padding: [50, 50], maxZoom: 8 });
    }

    // Fix tiles when container resizes (sidebar open/close, initial layout)
    setTimeout(() => { this.map?.invalidateSize(); }, 200);
    this._resizeObs = new ResizeObserver(() => {
      this.map?.invalidateSize({ animate: false });
    });
    this._resizeObs.observe(mapDiv);
  }

  _buildStats() {
    const trips = this.trips;
    if (!trips.length) return;

    const totalKm = trips.reduce((s, t) => s + (t.stats?.distanceKm || 0), 0);
    const totalGain = trips.reduce((s, t) => s + (t.stats?.elevationGainM || 0), 0);

    const bar = document.createElement("div");
    bar.className = "global-stats-bar";
    bar.innerHTML = [
      `<span class="global-stat"><strong>${trips.length}</strong> ${t("lib.trips")}</span>`,
      `<span class="global-stat"><strong>${totalKm.toFixed(1)}</strong> km</span>`,
      `<span class="global-stat"><strong>${totalGain.toLocaleString()}</strong> m ↑</span>`
    ].join("");
    this.container.appendChild(bar);
  }

  _addMarkers() {
    const dotIcon = L.divIcon({
      className: "hj-map-dot",
      iconSize: [14, 14],
      iconAnchor: [7, 7]
    });

    for (const trip of this.trips) {
      if (!trip.lat || !trip.lng) continue;

      const marker = L.marker([trip.lat, trip.lng], { icon: dotIcon }).addTo(this.map);

      // Permanent label
      marker.bindTooltip(trip.name, {
        permanent: true, direction: "right", offset: [10, 0],
        className: "hj-map-tooltip"
      });

      // Popup with cover photo + metadata
      const popup = document.createElement("div");
      popup.className = "hj-map-popup-content";

      // Cover image
      if (trip.coverImage) {
        const coverWrap = document.createElement("div");
        coverWrap.className = "hj-popup-cover";
        const img = document.createElement("img");
        img.src = trip.coverImage;
        img.alt = trip.name;
        img.style.cssText = "width:100%; height:140px; object-fit:cover; border-radius:8px 8px 0 0;";
        coverWrap.appendChild(img);
        popup.appendChild(coverWrap);
      }

      const nameDiv = document.createElement("div");
      nameDiv.className = "hj-map-popup-name";
      nameDiv.textContent = trip.name;
      popup.appendChild(nameDiv);

      const metaDiv = document.createElement("div");
      metaDiv.className = "hj-map-popup-meta";
      if (trip.region) { const s = document.createElement("span"); s.textContent = "\ud83d\udccd " + trip.region; metaDiv.appendChild(s); }
      if (trip.date) { const s = document.createElement("span"); s.textContent = "\ud83d\udcc5 " + trip.date; metaDiv.appendChild(s); }
      if (trip.stats?.distanceKm) { const s = document.createElement("span"); s.textContent = trip.stats.distanceKm.toFixed(1) + " km"; metaDiv.appendChild(s); }
      popup.appendChild(metaDiv);

      // Button row
      const btnRow = document.createElement("div");
      btnRow.className = "hj-popup-actions";
      btnRow.style.cssText = "display:flex;gap:6px;padding:8px 12px;";
      const openBtn = document.createElement("button");
      openBtn.className = "hj-btn-primary hj-btn-sm";
      openBtn.textContent = t("lib.openJournal") || "Open Journal";
      openBtn.addEventListener("click", () => openTrip(trip.file));
      btnRow.appendChild(openBtn);

      // AI Summary button
      const aiBtn = document.createElement("button");
      aiBtn.className = "hj-btn-secondary hj-btn-sm";
      aiBtn.textContent = t("ai.summary");
      aiBtn.style.cssText = "padding:4px 10px;font-size:0.75rem;border:1px solid #ddd;border-radius:6px;background:#f8f9fa;cursor:pointer;";
      btnRow.appendChild(aiBtn);

      // AI result area
      const aiResult = document.createElement("div");
      aiResult.style.cssText = "display:none;padding:8px 12px;font-size:0.78rem;line-height:1.5;border-top:1px solid #eee;color:#555;";
      popup.appendChild(btnRow);
      popup.appendChild(aiResult);

      aiBtn.addEventListener("click", async () => {
        if (!getApiKey()) { showSettingsModal(); return; }
        aiBtn.disabled = true;
        aiBtn.textContent = t("ai.analyzing");
        aiResult.style.display = "block";
        aiResult.textContent = "...";
        try {
          const data = await loadTripData(trip.file);
          const summary = await summarizeTripWithGemini(data);
          aiResult.innerHTML = "";
          const title = document.createElement("div");
          title.style.cssText = "font-weight:600;margin-bottom:4px;font-size:0.7rem;color:#6366f1;";
          title.textContent = t("ai.summaryTitle");
          aiResult.appendChild(title);
          const text = document.createElement("div");
          text.textContent = summary;
          aiResult.appendChild(text);
        } catch (e) {
          aiResult.style.color = "#e74c3c";
          aiResult.textContent = e.message || t("ai.error");
        }
        aiBtn.disabled = false;
        aiBtn.textContent = t("ai.summary");
      });

      marker.bindPopup(popup, { maxWidth: 280, closeButton: true });

      marker.on("click", () => {
        this.map.flyTo([trip.lat, trip.lng], 12, { duration: 1.5 });
      });

      this.markers.push(marker);
    }
  }

  async _loadVisibleGpx() {
    if (!this.map || this.map.getZoom() < 6) return;
    const bounds = this.map.getBounds();

    for (const trip of this.trips) {
      if (this.gpxLoaded.has(trip.file)) continue;
      if (!trip.lat || !trip.lng) continue;
      if (!bounds.contains([trip.lat, trip.lng])) continue;

      this.gpxLoaded.add(trip.file);
      try {
        const data = await loadTripData(trip.file);
        if (data.gpxTrack && data.gpxTrack.length >= 2) {
          const latlngs = data.gpxTrack.map(p => [p.lat, p.lng]);
          const line = L.polyline(latlngs, {
            color: "#dc2626", weight: 3, opacity: 0.7,
            dashArray: null, lineCap: "round", lineJoin: "round"
          }).addTo(this.map);
          this.gpxLayers.push(line);
        }
      } catch (e) {
        console.warn("Failed to load GPX for", trip.file, e);
      }
    }
  }
}

// ============================================================
//  APP STATE & NAVIGATION
// ============================================================
let viewer = null;
let globalMap = null;
let tripsData = null;
let currentSort = "date";
let currentSearch = "";
let activeFile = null;

async function loadTripIndex() {
  let serverTrips = [];
  try { const resp = await fetch("data/trips.json"); serverTrips = await resp.json(); } catch (e) {}
  const localTrips = getLocalTrips();
  return [...localTrips, ...serverTrips];
}

async function loadTripData(filename) {
  const resp = await fetch(`data/${filename}`);
  return resp.json();
}

function formatDate(dateStr) {
  if (!dateStr) return "";
  const d = new Date(dateStr + "T00:00:00");
  if (isNaN(d.getTime())) return dateStr;
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function renderTripList() {
  const container = document.getElementById("trip-list");
  if (!container || !tripsData) return;

  let filtered = tripsData;
  if (currentSearch.trim()) {
    const q = currentSearch.toLowerCase();
    filtered = tripsData.filter(t =>
      (t.name || "").toLowerCase().includes(q) ||
      (t.region || "").toLowerCase().includes(q) ||
      (t.date || "").includes(q)
    );
  }

  filtered = [...filtered];
  if (currentSort === "date") filtered.sort((a, b) => (b.date || "").localeCompare(a.date || ""));
  else if (currentSort === "name") filtered.sort((a, b) => (a.name || "").localeCompare(b.name || ""));
  else if (currentSort === "distance") filtered.sort((a, b) => (b.stats?.distanceKm || 0) - (a.stats?.distanceKm || 0));

  container.innerHTML = "";

  if (!filtered.length) {
    const empty = document.createElement("div");
    empty.style.cssText = "text-align:center;padding:2rem 1rem;color:#94a3b8;font-size:0.85rem;";
    empty.textContent = currentSearch ? t("noMatch") : t("noTrips");
    container.appendChild(empty);
    return;
  }

  for (const trip of filtered) {
    const card = document.createElement("div");
    card.className = "trip-card" + (trip.file === activeFile ? " active" : "");
    card.addEventListener("click", () => openTrip(trip.file));

    if (trip.coverImage) {
      const img = document.createElement("img");
      img.className = "trip-card-cover";
      img.src = trip.coverImage;
      img.alt = trip.name;
      img.loading = "lazy";
      card.appendChild(img);
    } else {
      const ph = document.createElement("div");
      ph.className = "trip-card-cover-placeholder";
      ph.textContent = "\uD83C\uDFD4\uFE0F";
      card.appendChild(ph);
    }

    const info = document.createElement("div");
    info.className = "trip-card-info";

    const name = document.createElement("p");
    name.className = "trip-card-name";
    name.textContent = trip.name || "Untitled";
    info.appendChild(name);

    const region = document.createElement("p");
    region.className = "trip-card-region";
    if (trip.region) region.textContent = trip.region;
    if (trip.date) {
      const dateSpan = document.createElement("span");
      dateSpan.className = "trip-card-date";
      dateSpan.textContent = (trip.region ? " \u00B7 " : "") + formatDate(trip.date);
      region.appendChild(dateSpan);
    }
    info.appendChild(region);

    if (trip.stats && (trip.stats.distanceKm || trip.stats.elevationGainM)) {
      const meta = document.createElement("div");
      meta.className = "trip-card-meta";
      const parts = [];
      if (trip.stats.distanceKm) parts.push(`${trip.stats.distanceKm} km`);
      if (trip.stats.elevationGainM) parts.push(`\u2191${trip.stats.elevationGainM}m`);
      meta.textContent = parts.join(" \u00B7 ");
      info.appendChild(meta);
    }

    // Delete button for local trips
    if (trip._isLocal) {
      const delBtn = document.createElement("button");
      delBtn.textContent = "\u00d7";
      delBtn.style.cssText = "position:absolute;top:6px;right:6px;width:22px;height:22px;border-radius:50%;background:rgba(239,68,68,0.8);color:white;border:none;font-size:12px;cursor:pointer;display:flex;align-items:center;justify-content:center;opacity:0;transition:opacity 0.2s;z-index:2;";
      delBtn.onclick = async (e) => {
        e.stopPropagation();
        if (confirm("Delete '" + trip.name + "'? This cannot be undone.")) {
          deleteLocalTrip(trip.id);
          tripsData = await loadTripIndex();
          renderTripList();
          if (activeFile === trip.file) backToList();
        }
      };
      card.style.position = "relative";
      card.addEventListener("mouseenter", () => { delBtn.style.opacity = "1"; });
      card.addEventListener("mouseleave", () => { delBtn.style.opacity = "0"; });
      card.appendChild(delBtn);
    }

    card.appendChild(info);
    container.appendChild(card);
  }

  const countEl = document.getElementById("trip-count");
  if (countEl) countEl.textContent = `${filtered.length} trip${filtered.length !== 1 ? "s" : ""}`;
}

function setupSidebar() {
  // Wire up Create New button
  const createBtn = document.getElementById("create-trip-btn");
  if (createBtn) createBtn.addEventListener("click", () => showCreationWizard());

  // Wire up HTML buttons
  const langBtn = document.getElementById("lang-toggle");
  if (langBtn) {
    langBtn.textContent = _lang === "zh" ? "EN" : "\u4E2D";
    langBtn.addEventListener("click", () => { switchLang(_lang === "en" ? "zh" : "en"); });
  }

  const settingsBtn = document.getElementById("sidebar-settings");
  if (settingsBtn) {
    settingsBtn.addEventListener("click", showSettingsModal);
  }

  const searchInput = document.getElementById("search-input");
  if (searchInput) {
    searchInput.addEventListener("input", (e) => { currentSearch = e.target.value; renderTripList(); });
  }

  document.querySelectorAll(".sort-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".sort-btn").forEach(b => b.classList.remove("active"));
      btn.classList.add("active");
      currentSort = btn.dataset.sort;
      renderTripList();
    });
  });

  const toggle = document.getElementById("sidebar-toggle");
  const sidebar = document.getElementById("sidebar");
  const collapseBtn = document.getElementById("sidebar-collapse");

  if (sidebar) {
    const overlay = document.createElement("div");
    overlay.className = "sidebar-overlay";
    document.body.appendChild(overlay);

    if (collapseBtn) {
      collapseBtn.addEventListener("click", () => {
        const isMobile = window.innerWidth <= 768;
        if (isMobile) { sidebar.classList.remove("open"); overlay.classList.remove("active"); }
        else { sidebar.classList.add("collapsed"); if (toggle) toggle.classList.add("visible"); }
      });
    }

    if (toggle) {
      toggle.addEventListener("click", () => {
        const isMobile = window.innerWidth <= 768;
        if (isMobile) { sidebar.classList.toggle("open"); overlay.classList.toggle("active"); }
        else { sidebar.classList.remove("collapsed"); toggle.classList.remove("visible"); }
      });
    }

    overlay.addEventListener("click", () => {
      sidebar.classList.remove("open");
      overlay.classList.remove("active");
    });
  }
}

function showGlobalMap() {
  activeFile = null;
  document.getElementById("global-map").style.display = "";
  document.getElementById("trip-view").style.display = "none";
  if (globalMap) globalMap.destroy();
  const mapContainer = document.getElementById("global-map");
  globalMap = new GlobalMapViewer(mapContainer);
  globalMap.loadTrips(tripsData);
  renderTripList();
}

async function openTrip(filename) {
  activeFile = filename;
  if (globalMap) { globalMap.destroy(); globalMap = null; }
  document.getElementById("global-map").style.display = "none";
  const container = document.getElementById("trip-view");
  container.style.display = "";
  // Check if it's a local trip
  const localTrip = getLocalTrips().find(t => t.id === filename || t.file === filename);
  let data;
  if (localTrip) {
    data = localTrip;
    // Resolve idb:// photo URLs to blob URLs
    for (const wp of (data.waypoints || [])) {
      for (const ph of (wp.photos || [])) {
        if (ph.imageUrl && ph.imageUrl.startsWith("idb://")) {
          const photoId = ph.imageUrl.replace("idb://", "");
          const blobUrl = await getPhotoBlobUrl(photoId);
          if (blobUrl) ph.imageUrl = blobUrl;
        }
      }
    }
  } else {
    data = await loadTripData(filename);
  }
  if (viewer) viewer.destroy();

  const template = data.template || "scrollytelling";
  container.className = `hj-root${(data.version || 5) >= 5 ? " hj-v5" : ""}`;

  const onBack = () => backToList();
  const onSwitch = (tmpl) => {
    data.template = tmpl;
    if (viewer) viewer.destroy();
    renderTemplate(container, data, tmpl, onBack, onSwitch);
  };

  renderTemplate(container, data, template, onBack, onSwitch);
  renderTripList();

  // Close mobile sidebar
  const sidebar = document.getElementById("sidebar");
  const overlay = document.querySelector(".sidebar-overlay");
  if (sidebar) sidebar.classList.remove("open");
  if (overlay) overlay.classList.remove("active");
}

function renderTemplate(container, data, template, onBack, onSwitch) {
  if (template === "scrapbook") {
    container.className = "hj-root";
    viewer = new ScrapbookViewer(container);
    viewer.loadTrip(data, onBack, onSwitch);
  } else if (template === "illustrated") {
    container.className = "hj-root";
    viewer = new IllustratedViewer(container);
    viewer.loadTrip(data, onBack, onSwitch);
  } else {
    container.className = `hj-root${(data.version || 5) >= 5 ? " hj-v5" : ""}`;
    viewer = new ScrollytellingViewer(container);
    viewer.loadTrip(data, onBack, onSwitch);
  }
}

function backToList() {
  if (viewer) { viewer.destroy(); viewer = null; }
  document.getElementById("trip-view").style.display = "none";
  showGlobalMap();
}

// === Init ===
document.addEventListener("DOMContentLoaded", async () => {
  try {
    tripsData = await loadTripIndex();
    setupSidebar();
    renderTripList();
    showGlobalMap();
  } catch (err) {
    console.error("Failed to load trip index:", err);
  }
});
