/**
 * SouvenirCore — Standalone souvenir generation module for HikerScrolls Website
 * Extracted from Obsidian plugin hiking-journal/main.js (souvenir store pipeline)
 *
 * Dependencies:
 *   - callAI(capability, payload, overrideProvider?, overrideModel?) from app.js
 *   - No Obsidian dependencies, no vault access
 *
 * Usage:
 *   <script src="app.js"></script>
 *   <script src="souvenir-core.js"></script>
 *   const results = await SouvenirCore.generate(tripData, photos, ["postcard","magnet"], 3, onStatus);
 */

const SouvenirCore = (() => {
  "use strict";

  // ═══════════════════════════════════════════════════════════════════
  // Constants
  // ═══════════════════════════════════════════════════════════════════

  const PRODUCT_SPECS = {
    postcard:  { key: "souvenir.postcard", dims: [148, 100], bleed: 3, dpi: 300 },
    magnet:    { key: "souvenir.magnet",   dims: [70, 50],   bleed: 2, dpi: 300 },
    sticker:   { key: "souvenir.sticker",  dims: [60, 60],   bleed: 2, dpi: 300 },
    pin:       { key: "souvenir.pin",      dims: [38, 38],   bleed: 1, dpi: 400 },
    stamp:     { key: "souvenir.stamp",    dims: [30, 40],   bleed: 0, dpi: 600 }
  };

  const RULES = {
    postcard: "148x100mm landscape, 300dpi. NO white border \u2014 design fills edge to edge. Paper texture feel, NOT metallic or enamel. Think real printed postcard: warm matte finish, natural ink colors, hand-illustrated or photographic style. Include headline, location name, date. The result should look like a postcard you buy at a museum gift shop, not a metal plate. Pure white background behind the card only.",
    magnet: "70x50mm portrait, 300dpi. Full-bleed. 3D ENAMEL RELIEF: Multiple raised layers separated by polished metallic lines. Back layer recessed (sky/atmosphere), mid layer raised (landmarks), front layer highest (text band, fine details). Bottom: solid raised band, location name in white bold. The magnet must look like a physical object you can pick up and feel. Pure white background, no fabric/table surface.",
    sticker: "60x60mm, 300dpi. 4mm white die-cut stroke outline. Bold and readable at small scale. Location or short text at base. Clean design on pure white background, no mockup.",
    pin: "38mm circle, 400dpi (output as square, design inside circle). CLOISONNE ENAMEL: Fine metal wire defines all color boundaries (visible as raised lines). Enamel fills sit slightly recessed within metal walls. Polished border ring. Location arc text at bottom. Max 6 flat enamel colors. Must look like a jewel, not a printed sticker. Pure white background, no fabric/felt surface.",
    stamp: "30x40mm portrait, 600dpi. Perforated border. 2px black frame, 3mm white inner margin. Top: COMMEMORATIVE. Bottom: location name. Engraving/crosshatch line style. Pure white background, no mockup."
  };

  const FUSIONS = {
    magnet: {
      full_collage: "Compose a RICH MULTI-SCENE COLLAGE \u2014 like premium enamel souvenir magnets that pack an entire city into a small object. Metallic dividing lines between zones follow natural scene contours. Every zone belongs in the composition.",
      hero_atmosphere: "Choose the SINGLE most powerful scene as hero (~60%). Fill remaining space with ATMOSPHERIC CONTEXT from other scenes \u2014 textures, color fields, silhouettes. The hero exists in a world, not a void.",
      cultural_fusion: "Let CULTURAL RESEARCH drive the visual language. Cultural motifs and architectural patterns are primary design elements. Photos provide content, culture provides language.",
      journey_narrative: "Tell the story of MOVEMENT as a visual sequence \u2014 arrival, exploration, discovery. The composition has directionality: the eye moves through it like a traveler.",
      abstracted_essence: "Capture WHAT PLACES FEEL LIKE, not what they look like. Abstract key elements \u2014 shapes, colors, textures, light \u2014 into a design evoking emotional character rather than literal depiction."
    },
    postcard: {
      panoramic_journey: "Wide panoramic composition showing multiple scenes as if from a single vantage point. Scenes bleed into each other at edges. Text spanning full width at bottom.",
      triptych_narrative: "Three panels: PLACE (establishing shot), MOMENT (human-scale scene), DETAIL (texture/cultural element). You choose which photos fill each role.",
      illustrated_map: "Stylized illustrated map with vignette illustrations at each location. Drawn routes connect them. The map IS the postcard.",
      editorial_photo: "Magazine editorial aesthetic. One strong photo dominates, color-graded with design palette. Bold typographic overlay. Clean, contemporary.",
      layered_memory: "Multiple photos layered at varying opacity \u2014 some sharp, some ghosted. Layering creates depth and time passing. Location and date as anchor."
    },
    sticker: {
      merit_badge: "Circular/shield badge celebrating trip achievements. Central icon surrounded by smaller icons from other scenes. Decorative border. Patch aesthetic.",
      skyline_fusion: "All architectural silhouettes combined into one continuous skyline. Every landmark contributes its outline. Bold, graphic, immediately readable.",
      cultural_pattern: "Repeating pattern from cultural motifs. The sticker IS the pattern \u2014 textile quality encoding the place.",
      bold_hero: "One scene, maximum graphic impact. Simplified to essential shape and 3-4 colors. Die-cut follows shape.",
      icon_cluster: "Multiple hand-drawn icons in loose cluster. Each simple but specific to what makes each place unique."
    },
    pin: {
      panoramic_skyline: "Full trip skyline across circle \u2014 all landmarks in continuous silhouette. Sky above, optional reflection below.",
      jewel_detail: "Single most intricate visual element \u2014 architectural ornament, stained glass. Maximum enamel richness. Collector's pin.",
      cultural_symbol: "Symbol synthesized from cultural research. Heraldic device: clean, authoritative, memorable.",
      scene_fusion: "Two contrasting scenes fused \u2014 split diagonally, horizontally, or concentrically. Most interesting visual dialogue.",
      map_pin: "Pin IS a location marker (teardrop). Inside: compressed illustration of the trip's most iconic scene."
    },
    stamp: {
      engraved_portrait: "Classic stamp engraving of most distinctive scene. Fine crosshatch, intaglio depth. 2-3 colors.",
      panoramic_miniature: "Multiple scenes compressed into one miniature panorama. Fine detail at stamp scale \u2014 a tiny world.",
      cultural_symbol: "Most potent cultural symbol centered. Graphic, abstract. The stamp that becomes a design classic.",
      atmospheric_scene: "Capture ATMOSPHERE rather than landmarks. Woodcut or aquatint treatment. Emotional truth.",
      data_portrait: "Stamp image IS data: elevation profile, route line, distance stats as bold graphic elements."
    }
  };

  // ═══════════════════════════════════════════════════════════════════
  // Route type detection + design language
  // ═══════════════════════════════════════════════════════════════════

  const NATURE_DESIGN_LANGUAGE = `DESIGN LANGUAGE FOR NATURE / HIKING ROUTES:
This is a hiking or nature route \u2014 the design should celebrate:
- The landscape itself: peaks, ridges, valleys, water, sky
- The physical experience: elevation gain, distance, exertion, solitude
- Light and atmosphere: golden hour, morning mist, harsh midday, dusk
- Flora and fauna specific to this region
- The FEELING of being out there: scale, remoteness, freedom

Product-specific nature treatments:
Fridge magnet: Layered topographic relief \u2014 sky layer (atmospheric gradient), mountain/ridge midground (sharp silhouette with texture), foreground (trail, vegetation, or water). Earthy palette: stone grey, forest green, sky blue, warm rock amber. NO urban skylines.
Postcard: Wide panoramic landscape. Let the terrain breathe \u2014 generous sky, sweeping horizon. Small human figure for scale if appropriate.
Sticker: Topographic contour lines as graphic element, OR bold mountain silhouette. Clean, outdoorsy aesthetic. Earth tones.
Pin: Mountain/peak silhouette across circle diameter, OR trail elevation profile. Summit marker. Clean and iconic.
Stamp: Botanical illustration style OR fine topographic engraving. Capture a specific natural detail.`;

  const URBAN_DESIGN_LANGUAGE = `DESIGN LANGUAGE FOR URBAN ROUTES:
Focus on: architecture, street life, cultural energy, city texture.
Use landmark buildings as anchors, cultural motifs as texture.
Skylines, facades, cultural symbols, street patterns.`;

  function _detectRouteType(ctx) {
    const urbanKW = ["street","avenue","blvd","road","highway","metro","downtown","plaza","mall","market","theater","museum","stadium","pier"];
    const natureKW = ["trail","mountain","peak","summit","ridge","valley","lake","forest","canyon","creek","river","waterfall","glacier","meadow","overlook","pass","hut","campsite","wilderness"];
    const allNames = ((ctx.key_locations||[]).map(l=>l.name).join(" ") + " " + (ctx.narrative_keywords||[]).join(" ")).toLowerCase();
    let urbanScore = 0, natureScore = 0;
    for (const kw of urbanKW) if (allNames.includes(kw)) urbanScore++;
    for (const kw of natureKW) if (allNames.includes(kw)) natureScore++;
    const es = ctx.elevation_story;
    if (es) {
      if ((es.total_gain_m||0) > 300) natureScore += 3;
      if ((es.total_distance_km||0) > 10) natureScore += 1;
    }
    if (natureScore > urbanScore + 1) return "nature";
    if (urbanScore > natureScore + 1) return "urban";
    return "mixed";
  }

  function _getDesignLanguage(routeType) {
    if (routeType === "nature") return NATURE_DESIGN_LANGUAGE;
    if (routeType === "urban") return URBAN_DESIGN_LANGUAGE;
    return NATURE_DESIGN_LANGUAGE + "\n" + URBAN_DESIGN_LANGUAGE;
  }

  function _isDesignable(name) {
    const skip = ["access path","parking lot","bus stop","intersection","highway","ramp","rest area","gas station","exit"];
    const lower = (name||"").toLowerCase();
    return !skip.some(s => lower.includes(s));
  }

  // ═══════════════════════════════════════════════════════════════════
  // Utility: JSON extractor
  // ═══════════════════════════════════════════════════════════════════

  function _extractJson(text) {
    if (!text) return null;
    text = text.trim();
    if (text.includes("```")) {
      const parts = text.split("```");
      for (let i = 1; i < parts.length; i += 2) {
        const b = parts[i].replace(/^\w+\n/, "");
        if (b.includes("{")) { text = b; break; }
      }
    }
    const s = text.indexOf("{");
    if (s === -1) return null;
    let d = 0, q = false, esc = false, e = -1;
    for (let i = s; i < text.length; i++) {
      const c = text[i];
      if (esc) { esc = false; continue; }
      if (c === "\\") { esc = true; continue; }
      if (c === '"') { q = !q; continue; }
      if (q) continue;
      if (c === "{") d++;
      else if (c === "}") { d--; if (d === 0) { e = i; break; } }
    }
    if (e === -1) e = text.lastIndexOf("}");
    if (e === -1) return null;
    let j = text.slice(s, e + 1).replace(/,\s*([}\]])/g, "$1");
    try { return JSON.parse(j); } catch { return null; }
  }

  // ═══════════════════════════════════════════════════════════════════
  // Pre-Processing: GeoResolver (Nominatim) — public API, no AI
  // ═══════════════════════════════════════════════════════════════════

  async function _geoResolve(lat, lng) {
    try {
      const url = `https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lng}&format=json&zoom=18&addressdetails=1`;
      const r = await fetch(url, { headers: { "User-Agent": "HikerScrolls/1.0" } });
      if (!r.ok) return null;
      const d = await r.json();
      const addr = d.address || {};
      return {
        name: d.name || addr.tourism || addr.building || addr.amenity || "",
        neighbourhood: addr.neighbourhood || addr.suburb || "",
        city: addr.city || addr.town || addr.village || "",
        country: addr.country || "",
        place_type: d.type || ""
      };
    } catch { return null; }
  }

  // ═══════════════════════════════════════════════════════════════════
  // Pre-Processing: POI Finder (Overpass API) — public API, no AI
  // ═══════════════════════════════════════════════════════════════════

  async function _findPOIs(waypoints, radiusM) {
    try {
      const r = radiusM || 2000;
      const wps = (waypoints || []).filter(w => w.lat && w.lng).slice(0, 2);
      if (!wps.length) return [];
      const aroundParts = wps.map(w =>
        `node["tourism"~"attraction|museum|viewpoint"](around:${r},${w.lat},${w.lng});` +
        `node["historic"](around:${r},${w.lat},${w.lng});` +
        `node["natural"~"peak|beach|cliff"](around:${r},${w.lat},${w.lng});`
      ).join("");
      const query = `[out:json][timeout:15];(${aroundParts});out body 20;`;
      const resp = await fetch("https://overpass-api.de/api/interpreter", {
        method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: "data=" + encodeURIComponent(query)
      });
      if (!resp.ok) { console.warn("[SVN] Overpass", resp.status); return []; }
      const d = await resp.json();
      return (d.elements || []).filter(e => e.tags?.name).map(e => ({
        name: e.tags.name, lat: e.lat, lon: e.lon,
        type: e.tags.tourism || e.tags.historic || e.tags.natural || "poi",
        wikipedia: e.tags.wikipedia || ""
      }));
    } catch(e) { console.warn("[SVN] Overpass error:", e.message); return []; }
  }

  // ═══════════════════════════════════════════════════════════════════
  // Pre-Processing: Route Visualizer (deterministic, no API)
  // ═══════════════════════════════════════════════════════════════════

  function _routeVisualize(gpxTrack, keyLocations) {
    if (!gpxTrack || gpxTrack.length < 2) return { svg_path: "", simplified: [], total_km: 0 };
    const step = Math.max(1, Math.floor(gpxTrack.length / 100));
    const simplified = [];
    for (let i = 0; i < gpxTrack.length; i += step) simplified.push(gpxTrack[i]);
    if (simplified[simplified.length-1] !== gpxTrack[gpxTrack.length-1]) simplified.push(gpxTrack[gpxTrack.length-1]);
    let minLat = 999, maxLat = -999, minLng = 999, maxLng = -999;
    for (const p of simplified) {
      if (p.lat < minLat) minLat = p.lat; if (p.lat > maxLat) maxLat = p.lat;
      if (p.lng < minLng) minLng = p.lng; if (p.lng > maxLng) maxLng = p.lng;
    }
    const dLat = maxLat - minLat || 0.01, dLng = maxLng - minLng || 0.01;
    const pts = simplified.map(p => ({ x: (p.lng - minLng) / dLng, y: 1 - (p.lat - minLat) / dLat }));
    let svg = "M" + pts[0].x.toFixed(3) + "," + pts[0].y.toFixed(3);
    for (let i = 1; i < pts.length; i++) svg += " L" + pts[i].x.toFixed(3) + "," + pts[i].y.toFixed(3);
    let totalKm = 0;
    for (let i = 1; i < simplified.length; i++) {
      const R = 6371, dLa = (simplified[i].lat - simplified[i-1].lat) * Math.PI/180;
      const dLo = (simplified[i].lng - simplified[i-1].lng) * Math.PI/180;
      const a = Math.sin(dLa/2)**2 + Math.cos(simplified[i-1].lat*Math.PI/180)*Math.cos(simplified[i].lat*Math.PI/180)*Math.sin(dLo/2)**2;
      totalKm += R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
    }
    const elevProfile = simplified.filter(p => p.ele != null).map((p, i) => ({ km: (totalKm * i / simplified.length).toFixed(1), ele: Math.round(p.ele) }));
    return { svg_path: svg, simplified, total_km: totalKm, bounding_box: { minLat, maxLat, minLng, maxLng }, elevation_profile: elevProfile };
  }

  // ═══════════════════════════════════════════════════════════════════
  // Agent 1: Build Context (geo-resolve + POI + AI text synthesis)
  // ═══════════════════════════════════════════════════════════════════

  async function _buildContext(trip, onStatus) {
    console.log("[SVN] buildContext entered, waypoints:", (trip.waypoints||[]).length);
    if (onStatus) onStatus("Resolving locations...");
    const wps = trip.waypoints || [];

    // Geo-resolve each waypoint
    const geoNames = {};
    for (let wi = 0; wi < Math.min(wps.length, 8); wi++) {
      const w = wps[wi];
      if (w.lat && w.lng) {
        console.log("[SVN] GeoResolve", wi+1, w.title, w.lat, w.lng);
        try {
          const geo = await _geoResolve(w.lat, w.lng);
          if (geo) { geoNames[w.title] = geo; console.log("[SVN] GeoResolved:", w.title, "->", geo.name||geo.city); }
        } catch(e) { console.warn("[SVN] GeoResolve failed:", e.message); }
        await new Promise(r => setTimeout(r, 1100)); // Nominatim rate limit: 1/sec
      }
    }

    // Find POIs along the route
    if (onStatus) onStatus("Discovering nearby landmarks...");
    console.log("[SVN] Finding POIs...");
    const allPOIs = await _findPOIs(wps, 2000);
    console.log("[SVN] POIs found:", allPOIs.length);
    const uniquePOIs = [...new Map(allPOIs.map(p => [p.name, p])).values()].slice(0, 15);
    const poiStr = uniquePOIs.map(p => "- " + p.name + " (" + p.type + ")" + (p.wikipedia ? " [wiki:" + p.wikipedia + "]" : "")).join("\n");
    const geoStr = Object.entries(geoNames).map(([k,v]) => "- " + k + " \u2192 REAL: " + (v.name||v.neighbourhood||v.city) + ", " + v.city + ", " + v.country).join("\n");

    if (onStatus) onStatus("Analyzing trip context...");
    const stats = trip.stats || {};
    const gpxSum = (trip.gpxTrack||[]).length >= 2
      ? "Distance: " + (stats.distanceKm||0).toFixed(1) + "km  MaxElev: " + (stats.maxElevation||"?") + "m  Gain: " + (stats.elevGain||"?") + "m"
      : "No GPX";

    const sys = `You are a travel context analyst. Synthesize travel data into a structured trip portrait.

CRITICAL RULES FOR LOCATION NAMES:
- Use REAL PLACE NAMES from the geo-resolution data below, NOT navigation labels like "18th Street Access Path"
- Cross-reference with POIs found nearby
- If a waypoint is near a famous landmark, use the landmark name
- Infer from GPS coordinates + geo data + nearby POIs

Geo-resolved names:
${geoStr}

Nearby POIs discovered:
${poiStr}

key_locations: max 5, ranked by importance, named as REAL PLACES (famous landmarks preferred)
narrative_keywords: 5-8 evocative words capturing the trip essence
All text in ENGLISH

Output ONLY strict JSON:
{"trip_title":"string","key_locations":[{"name":"string","coord":[lat,lon],"dwell_minutes":0,"photo_count":0,"description":"string"}],"photo_density_hotspots":["string"],"elevation_story":{"max_m":0,"min_m":0,"total_gain_m":0,"total_distance_km":0},"narrative_keywords":["string"],"dominant_mood":"Adventure|Leisure|Pilgrimage|Healing|Cultural|Unknown","season_and_weather_cues":"string","trip_summary":"string \u226420 words"}`;

    const user = "Trip: " + trip.name + "\n\nLocations with photo counts:\n" +
      wps.map(w => "- " + w.title + " (" + (w.lat||0).toFixed(4) + "," + (w.lng||0).toFixed(4) + ") photos: " + (w.photos?.length||0)).join("\n") +
      "\n\nGPX: " + gpxSum +
      "\n\nJournal: " + (trip.journalText||trip.name||"").slice(0,2000);

    const result = await callAI("text", { systemPrompt: sys, userPrompt: user, temperature: 0.5 });
    const txt = result?.text || result || "";
    const ctx = _extractJson(txt) || {
      trip_title: trip.name, key_locations: wps.slice(0,5).map(w=>({name:w.title,coord:[w.lat,w.lng],description:""})),
      narrative_keywords:[], dominant_mood:"Unknown", season_and_weather_cues:"", trip_summary: trip.name
    };
    ctx._geoNames = geoNames;
    ctx._pois = uniquePOIs;
    return ctx;
  }

  // ═══════════════════════════════════════════════════════════════════
  // Agent 2: Curate Photos (score with vision AI)
  // Accepts photoBase64Array = [{base64, mimeType, location, title}]
  // ═══════════════════════════════════════════════════════════════════

  async function _curatePhotos(photoBase64Array, onStatus) {
    if (onStatus) onStatus("Scoring photos...");
    const allP = (photoBase64Array || []).map(p => ({
      b64: p.base64,
      mime: p.mimeType || "image/jpeg",
      loc: p.location || p.title || "Unknown",
      title: p.title || ""
    }));

    console.log("[SVN] Photos to score:", allP.length);
    const toScore = allP.slice(0, 20);
    const scored = [];

    for (let i = 0; i < toScore.length; i++) {
      const ph = toScore[i];
      if (onStatus) onStatus(`Scoring photo ${i+1}/${toScore.length}: ${ph.loc}`);
      try {
        if (!ph.b64) { console.warn("[SVN] photo has no base64 data:", ph.loc); continue; }
        console.log("[SVN] Scoring photo", i+1, ph.loc, "b64 length:", ph.b64.length);
        const prompt = `Score this travel photo on 4 dimensions (each 0-25, total 100).
Output ONLY JSON:
{"composition_score":N,"landmark_score":N,"color_score":N,"narrative_score":N,
 "crop_suggestion":{"aspect_ratio":"16:9 or 1:1 or 4:3","focal_point":"description","safe_zone":"description"},
 "usage_suggestion":"best product type for this photo",
 "detected_elements":["element1","element2"]}`;

        console.log("[SVN] Calling Vision for scoring...");
        const result = await callAI("vision", {
          systemPrompt: null,
          parts: [
            { inlineData: { mimeType: ph.mime, data: ph.b64 } },
            { text: prompt }
          ],
          temperature: 0.3
        });
        const txt = result?.text || result || "";
        console.log("[SVN] Score response:", txt?.slice?.(0, 200));
        const res = _extractJson(txt);
        if (res) {
          console.log("[SVN] Score parsed:", JSON.stringify(res).slice(0,200));
          scored.push({
            ...ph,
            score: (res.composition_score||0)+(res.landmark_score||0)+(res.color_score||0)+(res.narrative_score||0),
            elements: res.detected_elements||[],
            crop: res.crop_suggestion,
            usage: res.usage_suggestion
          });
        } else console.warn("[SVN] score parse FAIL:", ph.loc, txt?.slice?.(0,200));
      } catch(e) { console.error("[SVN] score EXCEPTION:", ph.loc, e.message); }
      if (i < toScore.length - 1) await new Promise(r => setTimeout(r, 1500));
    }
    scored.sort((a,b) => b.score - a.score);
    return { topPhotos: scored.slice(0, 5), heroPhoto: scored[0] || null };
  }

  // ═══════════════════════════════════════════════════════════════════
  // Agent 3: Cultural Enrichment (search + text AI)
  // Uses callAI("search") for Tavily, callAI("text") for synthesis
  // ═══════════════════════════════════════════════════════════════════

  async function _culturalEnrich(ctx, onStatus) {
    if (onStatus) onStatus("Researching cultural elements...");
    const locs = (ctx.key_locations||[]).slice(0, 5);
    const locNames = locs.map(l=>l.name).join(", ");

    // Try search + text synthesis (replaces Claude tool_use loop)
    let searchContext = "";
    try {
      for (const loc of locs.slice(0, 3)) {
        if (onStatus) onStatus("Searching: " + loc.name);
        try {
          const r1 = await callAI("search", { query: loc.name + " visual landmarks architecture" }, "tavily");
          const r1Text = (r1?.results || []).map(r => r.title + ": " + (r.content||"").slice(0,200)).join("\n");
          searchContext += "\n--- " + loc.name + " ---\n" + r1Text;
        } catch(e) { console.warn("[SVN] Search 1 failed for", loc.name, e.message); }
        try {
          const r2 = await callAI("search", { query: loc.name + " cultural symbols colors design" }, "tavily");
          const r2Text = (r2?.results || []).map(r => r.title + ": " + (r.content||"").slice(0,200)).join("\n");
          searchContext += "\n" + r2Text;
        } catch(e) { console.warn("[SVN] Search 2 failed for", loc.name, e.message); }
        await new Promise(r => setTimeout(r, 500));
      }
    } catch(e) { console.warn("[SVN] Search phase failed:", e.message); }

    const cultSys = `You are a travel souvenir design researcher.
Collect visual cultural elements for each location to inform merchandise design.
Output ONLY raw JSON. FIRST CHARACTER must be {. Keep arrays MAX 5 items, strings <60 chars.`;
    const cultUser = "Locations: " + locNames + "\nKeywords: " + (ctx.narrative_keywords||[]).join(", ") +
      (searchContext ? "\n\nWeb research:\n" + searchContext.slice(0, 4000) : "") +
      '\n\nOutput: {"locations":[{"location_name":"str","visual_motifs":["max5"],"color_palette":["#hex"],"architectural_features":["max5"],"natural_features":["max5"]}],"unified_motifs":["max5"],"recommended_palette":["#hex"]}';

    const result = await callAI("text", { systemPrompt: cultSys, userPrompt: cultUser, temperature: 0.6 });
    const txt = result?.text || result || "";
    return _extractJson(txt) || { locations:[], unified_motifs:[], recommended_palette:[] };
  }

  // ═══════════════════════════════════════════════════════════════════
  // Agent 4a: Extract Visual Elements from hero photo
  // ═══════════════════════════════════════════════════════════════════

  async function _extractElements(heroPhoto, ctx, cultural, onStatus) {
    if (!heroPhoto?.b64) return null;
    if (onStatus) onStatus("Extracting visual elements from hero photo...");
    const prompt = `You are a visual element analyst for travel merchandise design.
Study this photo carefully. Trip: ${ctx.trip_title || ""}, Location: ${heroPhoto.loc || ""}

Extract the PRIMARY visual element (building, mountain, bridge, monument, etc.) for souvenir design.

Output ONLY JSON:
{"element_name":"English name","element_type":"building|mountain|bridge|monument|statue|tower|church|nature|cityscape",
 "description":"precise visual description for AI image generation",
 "shape_notes":"silhouette character, distinctive features for die-cut/outline",
 "real_colors":["#HEX","#HEX","#HEX"],
 "search_query":"best web search query to find reference images of this element",
 "crop_hint":"where in photo, how to isolate the element",
 "per_product":[
   {"product_type":"magnet","treatment":"3D enamel relief style description","color_note":"specific colors","composition_note":"positioning"},
   {"product_type":"postcard","treatment":"composition style","color_note":"","composition_note":""},
   {"product_type":"sticker","treatment":"die-cut simplification","color_note":"","composition_note":""},
   {"product_type":"pin","treatment":"cloisonne enamel with metal boundaries","color_note":"max 6 colors","composition_note":""},
   {"product_type":"stamp","treatment":"engraving/woodcut style","color_note":"","composition_note":""}
 ]}`;

    const result = await callAI("vision", {
      systemPrompt: null,
      parts: [
        { inlineData: { mimeType: heroPhoto.mime || "image/jpeg", data: heroPhoto.b64 } },
        { text: prompt }
      ],
      temperature: 0.5
    });
    const txt = result?.text || result || "";
    return _extractJson(txt);
  }

  // ═══════════════════════════════════════════════════════════════════
  // Agent 4b: Journey Moments (vision AI per top photo)
  // ═══════════════════════════════════════════════════════════════════

  async function _journeyMoments(photoResult, ctx, cultural, onStatus) {
    const routeType = _detectRouteType(ctx);
    const designLang = _getDesignLanguage(routeType);
    if (onStatus) onStatus("Route type: " + routeType);
    const moments = [];
    const top = (photoResult.topPhotos || []).filter(p => _isDesignable(p.loc));

    for (let i = 0; i < top.length; i++) {
      const ph = top[i];
      if (onStatus) onStatus(`Designing moment ${i+1}/${top.length}: ${ph.loc}`);
      try {
        const cultLoc = (cultural.locations||[]).find(l => l.location_name === ph.loc) || {};
        const prompt = `You are a creative director for premium travel souvenirs.
Study this photo. Trip: ${ctx.trip_title||""}, Location: ${ph.loc}
Mood: ${ctx.dominant_mood||""} | Season: ${ctx.season_and_weather_cues||""}
Detected elements: ${(ph.elements||[]).join(", ")}
Cultural motifs: ${(cultLoc.visual_motifs||[]).join(", ")}
Architecture: ${(cultLoc.architectural_features||[]).join(", ")}

${designLang}

Write CONCRETE, ACTIONABLE design directions \u2014 not style labels.
For magnets/pins, describe the PHYSICAL 3D quality: raised layers, enamel fills, metallic dividers.
For stamps, describe engraving treatment. For stickers, describe die-cut shape.

Output ONLY JSON:
{"location_name":"English name (famous landmark if applicable)","moment_caption":"one evocative sentence",
 "defining_quality":"2-3 sentences describing unique visual character",
 "emotional_note":"feeling/sensation this moment evokes",
 "design_fridge_magnet":"3D enamel relief: describe layers, metallic dividers, raised elements",
 "design_postcard":"composition, framing, text placement, border treatment",
 "design_sticker":"die-cut shape outline, simplification strategy, key details to keep",
 "design_pin":"cloisonne enamel: metal wire boundaries, max 6 color fills, arc text",
 "design_stamp":"engraving/woodcut treatment, detail crop, frame style"}`;

        const result = await callAI("vision", {
          systemPrompt: null,
          parts: [
            { inlineData: { mimeType: ph.mime || "image/jpeg", data: ph.b64 } },
            { text: prompt }
          ],
          temperature: 0.7
        });
        const txt = result?.text || result || "";
        const m = _extractJson(txt);
        if (m) moments.push({...m, photo_loc: ph.loc, photo_elements: ph.elements});
      } catch(e) { console.warn("[SVN] moment fail:", e); }
      if (i < top.length - 1) await new Promise(r => setTimeout(r, 1500));
    }

    // Geo-moments fallback: if no photo moments, generate from location data
    if (moments.length === 0) {
      if (onStatus) onStatus("No photo moments \u2014 generating from geographic data...");
      const locs = (ctx.key_locations||[]).filter(l => _isDesignable(l.name)).slice(0, 5);
      const poiStr = (ctx._pois||[]).map(p => p.name + " (" + p.type + ")").join(", ");
      const cultStr = (cultural.locations||[]).map(l => l.location_name + ": " + (l.visual_motifs||[]).join(",")).join("\n");
      const geoSys = "You are a travel souvenir creative director. Generate design briefs from geographic and cultural data (no photos available).\n\n" + designLang;
      const geoUser = "Trip: " + (ctx.trip_title||"") + "\nLocations: " + locs.map(l=>l.name + " \u2014 " + (l.description||"")).join("\n") +
        "\nNearby POIs: " + poiStr + "\nCultural data:\n" + cultStr +
        '\n\nFor EACH location, output a JSON array of design briefs:\n[{"location_name":"English","moment_caption":"one sentence","defining_quality":"2-3 sentences","emotional_note":"feeling","design_fridge_magnet":"3D enamel","design_postcard":"composition","design_sticker":"die-cut","design_pin":"cloisonne","design_stamp":"engraving"}]';
      try {
        const result = await callAI("text", { systemPrompt: geoSys, userPrompt: geoUser, temperature: 0.7 });
        const txt = result?.text || result || "";
        const arrStart = txt.indexOf("[");
        const arrEnd = txt.lastIndexOf("]");
        if (arrStart !== -1 && arrEnd > arrStart) {
          try { const arr = JSON.parse(txt.slice(arrStart, arrEnd + 1)); if (Array.isArray(arr)) moments.push(...arr); } catch {}
        }
        if (moments.length && onStatus) onStatus("Generated " + moments.length + " geo-moments");
      } catch(e) { console.warn("[SVN] geo-moments fallback failed:", e); }
    }

    return moments;
  }

  // ═══════════════════════════════════════════════════════════════════
  // Agent 5: Design System (unified visual language)
  // ═══════════════════════════════════════════════════════════════════

  async function _designSystem(ctx, photoResult, cultural, moments, routeViz, onStatus) {
    if (onStatus) onStatus("Creating unified design system...");
    const photoInfo = (photoResult.topPhotos||[]).map((p,i) => "Photo " + (i+1) + " (score:" + p.score + "): " + p.loc + " \u2014 " + (p.elements||[]).join(", ")).join("\n");
    const cultInfo = (cultural.locations||[]).map(l =>
      l.location_name + ": motifs=" + (l.visual_motifs||[]).join(",") + " arch=" + (l.architectural_features||[]).join(",") + " colors=" + (l.color_palette||[]).join(",")
    ).join("\n");
    const momentInfo = moments.map(m => "- " + m.location_name + ": " + m.moment_caption + " | " + (m.defining_quality||"").slice(0,80)).join("\n");

    const sys = `You are an art director specializing in travel merchandise design.
Based on the provided trip context, curated photos, regional cultural elements, and route data, create a unified visual system.

Color principles:
- Primary from photo dominant color OR regional traditional colors
- Text must have \u22654.5:1 contrast ratio with primary
- Secondary max 2 colors, harmonious
- Accent for emphasis only

Output ONLY strict JSON:
{"visual_approach":"photo-driven or route-driven",
 "color_system":{"primary":"#hex","secondary":["#hex","#hex"],"text_on_primary":"#hex","accent":"#hex","rationale":"color logic"},
 "typography":{"headline_style":"serif/sans-serif/handwriting","body_style":"serif/sans-serif","required_text_elements":["location (English)","date","elevation or distance"],"suggested_headline":"English \u22648 words, poetic"},
 "hero_photo_id":"filename or null",
 "primary_motif":"core visual symbol",
 "secondary_motifs":["supporting symbols"],
 "mood_descriptor":"overall mood \u226410 chars",
 "product_focus":{"postcard":"visual focus","magnet":"3D enamel focus","sticker":"die-cut focus","pin":"cloisonne focus","stamp":"engraving focus"}}`;

    const user = "Trip: " + (ctx.trip_title||"") + "\nKeywords: " + (ctx.narrative_keywords||[]).join(", ") +
      "\nMood: " + (ctx.dominant_mood||"") + " | Season: " + (ctx.season_and_weather_cues||"") +
      "\nRoute: " + (routeViz.total_km||0).toFixed(1) + "km" +
      "\n\nTop Photos:\n" + photoInfo +
      "\n\nCultural Research:\n" + cultInfo + "\nUnified motifs: " + (cultural.unified_motifs||[]).join(", ") + "\nPalette: " + (cultural.recommended_palette||[]).join(", ") +
      "\n\nJourney Moments:\n" + momentInfo;

    const result = await callAI("text", { systemPrompt: sys, userPrompt: user, temperature: 0.7 });
    const txt = result?.text || result || "";
    return _extractJson(txt) || {
      visual_approach:"photo-driven", color_system:{primary:"#2563eb",secondary:["#f59e0b"],text_on_primary:"#fff",accent:"#ef4444",rationale:"default"},
      typography:{headline_style:"sans-serif",suggested_headline:ctx.trip_title||"Journey"}, primary_motif:"landscape", secondary_motifs:[], mood_descriptor:"adventure", product_focus:{}
    };
  }

  // ═══════════════════════════════════════════════════════════════════
  // Agent 6: Image Generation
  // ═══════════════════════════════════════════════════════════════════

  async function _genImage(trip, ctx, photoResult, cultural, ds, moments, prodType, stratName, stratDir, varNum) {
    const cs = ds.color_system || {};
    const rule = RULES[prodType] || "";

    // Build scene inventory from all journey moments
    const sceneInventory = moments.map((m,i) => {
      const dk = "design_" + (prodType === "magnet" ? "fridge_magnet" : prodType);
      return `  [${i+1}] ${m.location_name}
     "${m.moment_caption}"
     ${(m.defining_quality||"").slice(0,120)}
     Emotion: ${m.emotional_note||""}
     Design: ${(m[dk]||m.design_postcard||"").slice(0,150)}`;
    }).join("\n");

    // Cultural context string
    const cultStr = (cultural.locations||[]).map(l =>
      l.location_name + ": symbols=" + (l.visual_motifs||[]).join(",") + " arch=" + (l.architectural_features||[]).join(",") + " nature=" + (l.natural_features||[]).join(",") + " colors=" + (l.color_palette||[]).join(",")
    ).join("\n");

    const prompt = `You are a senior travel souvenir designer. Create variant ${varNum} of 5.

Above are the traveler's OWN PHOTOS from this trip \u2014 they are your PRIMARY design material.
Study each photo carefully. You may:
- Use a single standout photo as the hero, artistically enhanced
- Blend multiple photos with smooth transitions and artistic treatment
- Incorporate local cultural elements, architectural motifs, and symbols discovered in research
- Use the GPX route shape as a design element if available
The photos should be CENTRAL to the design, enhanced with artistic style and cultural context.

=== YOUR CREATIVE BRIEF: "${stratName}" ===
${stratDir}

This is your PRIMARY CREATIVE DIRECTIVE. Follow its spirit, not just its letter.

=== ALL SCENES AVAILABLE ===
${sceneInventory}

=== GEOGRAPHIC + CULTURAL CONTEXT ===
Trip: ${ctx.trip_title||trip.name}
All locations: ${(ctx.key_locations||[]).map(l=>l.name).join(", ")}
Mood: ${ctx.dominant_mood||""} | Season: ${ctx.season_and_weather_cues||""}
${cultStr}

=== DESIGN SYSTEM (coherence across all variants) ===
Primary: ${cs.primary||""} (${cs.rationale||""})
Secondary: ${(cs.secondary||[]).join(", ")} | Accent: ${cs.accent||""}
Text color: ${cs.text_on_primary||"#fff"} | Motif: ${ds.primary_motif||""}
Headline: "${ds.typography?.suggested_headline||""}"

=== PRODUCT FORMAT ===
${rule}

=== LANGUAGE ===
ALL text ENGLISH. No Chinese characters.
Stamp top: "COMMEMORATIVE". Pin arc: location name.

=== OUTPUT RULES ===
Pure white (#FFFFFF) background \u2014 NO mockup surface, NO fabric/table/felt behind the product.
PRODUCT-SPECIFIC FINISH:
- Postcard: PAPER feel, warm matte print, natural ink colors. NO metallic/enamel/3D relief. Like a real printed postcard.
- Magnet: 3D enamel relief with metallic dividers. Physical object you can pick up.
- Sticker: Clean die-cut graphic, bold colors, flat design.
- Pin: Cloisonne enamel with fine metal wire boundaries.
- Stamp: Engraving/crosshatch line style, classic print.
COMPOSITION QUALITY:
- The design must have INTENTIONAL COMPOSITION \u2014 not just photos placed side by side.
- If using multiple photos, they must flow into each other with artistic transitions (gradient blends, overlapping layers, shared color palette).
- If using a single photo, apply artistic treatment (illustration style, color grading, stylized rendering).
- Incorporate cultural motifs and local elements as decorative accents.
- Typography must be clean, well-placed, and readable.
- Color harmony across the entire design.
Museum gift shop standard. Worth keeping 20 years.
Each variant must offer something genuinely different.`;

    // Attach reference photos
    const parts = [];
    const top = photoResult.topPhotos || [];
    for (let i = 0; i < Math.min(top.length, 5); i++) {
      if (top[i].b64) parts.push({ inlineData: { mimeType: top[i].mime || "image/jpeg", data: top[i].b64 } });
    }
    parts.push({ text: prompt });

    const result = await callAI("image", { parts });
    return result; // {base64, mime} or null
  }

  // ═══════════════════════════════════════════════════════════════════
  // Quality Judge — evaluates generated souvenir image
  // ═══════════════════════════════════════════════════════════════════
  async function _judgeImage(imageBase64, imageMime, prodType, stratName) {
    try {
      const prompt = `You are a quality control judge for travel souvenir products.
Evaluate this generated ${prodType} design (strategy: ${stratName}).

Score on 4 dimensions (each 0-25, total 100):
1. composition: Is the layout intentional and well-balanced? Are elements arranged with purpose?
2. artistry: Does it look like a designed product, not a raw photo collage? Is there artistic treatment?
3. product_fit: Does it look like a real ${prodType}? Would you buy this in a gift shop?
4. text_quality: Is text (if any) clean, readable, and well-placed?

IMPORTANT: A design that simply places unmodified photos side-by-side with harsh cuts scores LOW on composition and artistry (max 10 each).

Output ONLY JSON:
{"composition":N,"artistry":N,"product_fit":N,"text_quality":N,"total":N,"verdict":"pass or fail","reason":"one sentence explaining the score"}`;

      const result = await callAI("vision", {
        systemPrompt: null,
        parts: [
          { inlineData: { mimeType: imageMime || "image/png", data: imageBase64 } },
          { text: prompt }
        ],
        temperature: 0.3
      });

      const txt = (typeof result === "string" ? result : result?.text) || "";
      const match = txt.match(/\{[\s\S]*\}/);
      if (match) {
        const parsed = JSON.parse(match[0]);
        return { score: parsed.total || 0, reason: parsed.reason || "", details: parsed };
      }
    } catch (e) {
      console.warn("[SVN] Judge failed:", e.message);
    }
    return { score: 100, reason: "Judge unavailable, accepting by default" };
  }

  async function _genComposite(trip, ctx, photoResult, cultural, ds, moments, prodType) {
    const strategy = {
      name: "full_collage_signature",
      directive: "This is the SIGNATURE PIECE \u2014 the one design that captures everything. Use ALL provided scenes. Pack in as much of the trip as possible while maintaining visual coherence. Every scene should earn its place. The result should reward close looking \u2014 new details emerge on each viewing. This is the keeper, the centrepiece, the souvenir that tells the complete story of the trip."
    };
    return await _genImage(trip, ctx, photoResult, cultural, ds, moments, prodType, strategy.name, strategy.directive, 0);
  }

  // ═══════════════════════════════════════════════════════════════════
  // Main Pipeline: generate()
  // ═══════════════════════════════════════════════════════════════════

  /**
   * Run the full 6-agent souvenir generation pipeline.
   *
   * @param {Object} tripData - {name, waypoints:[{title,lat,lng,photos}], gpxTrack:[{lat,lng,ele}], stats:{distanceKm,maxElevation,elevGain}, journalText}
   * @param {Array}  photoBase64Array - [{base64, mimeType, location, title}]
   * @param {Array}  selectedProducts - ["postcard","magnet","sticker","pin","stamp"]
   * @param {number} variantsPerProduct - 1-5 variants per product type
   * @param {Function} onStatus - callback(statusMessage) for progress updates
   * @returns {Array} [{type, strategy, base64, mime}]
   */
  async function generate(tripData, photoBase64Array, selectedProducts, variantsPerProduct, onStatus) {
    const status = onStatus || (() => {});
    const products = selectedProducts || ["postcard"];
    const numVariants = Math.max(1, Math.min(5, variantsPerProduct || 3));

    try {
      // ── Agent 1: Build Context ──
      status("Agent 1/6: Building trip context...");
      const ctx = await _buildContext(tripData, status);
      console.log("[SVN] Context built:", ctx.trip_title, "mood:", ctx.dominant_mood);

      // ── Route visualization (deterministic) ──
      const routeViz = _routeVisualize(tripData.gpxTrack, ctx.key_locations);

      // ── Agent 2: Curate Photos ──
      status("Agent 2/6: Curating photos...");
      const photoResult = await _curatePhotos(photoBase64Array, status);
      console.log("[SVN] Photos curated:", photoResult.topPhotos.length, "top, hero:", photoResult.heroPhoto?.loc);

      // ── Agent 3: Cultural Enrichment ──
      status("Agent 3/6: Cultural research...");
      const cultural = await _culturalEnrich(ctx, status);
      console.log("[SVN] Cultural enrichment done, locations:", cultural.locations?.length);

      // ── Agent 4: Extract Elements + Journey Moments ──
      status("Agent 4/6: Analyzing visual elements...");
      const heroElements = await _extractElements(photoResult.heroPhoto, ctx, cultural, status);
      const moments = await _journeyMoments(photoResult, ctx, cultural, status);
      console.log("[SVN] Moments:", moments.length, "Hero elements:", heroElements?.element_name);

      // ── Agent 5: Design System ──
      status("Agent 5/6: Creating design system...");
      const ds = await _designSystem(ctx, photoResult, cultural, moments, routeViz, status);
      console.log("[SVN] Design system:", ds.visual_approach, ds.primary_motif, ds.color_system?.primary);

      // ── Agent 6: Generate Images ──
      status("Agent 6/6: Generating souvenir images...");
      const results = [];

      for (const prodType of products) {
        const fusionStrategies = FUSIONS[prodType] || {};
        const stratEntries = Object.entries(fusionStrategies);
        const selectedStrats = stratEntries.slice(0, numVariants);

        // Generate each variant
        for (let vi = 0; vi < selectedStrats.length; vi++) {
          const [stratName, stratDir] = selectedStrats[vi];
          status(`Generating ${prodType} variant ${vi+1}/${selectedStrats.length}: ${stratName}`);
          try {
            let img = await _genImage(tripData, ctx, photoResult, cultural, ds, moments, prodType, stratName, stratDir, vi + 1);
            if (img && img.base64) {
              // Quality Judge
              status(`Judging ${prodType} ${stratName}...`);
              const judge = await _judgeImage(img.base64, img.mime, prodType, stratName);
              const scoreStr = "Quality: " + judge.score + "/100";
              console.log("[SVN]", scoreStr, judge.reason);

              if (judge.score < 60) {
                // Retry once with feedback
                status(`${scoreStr} (low) — regenerating ${prodType} ${stratName}...`);
                console.warn("[SVN] Rejected:", prodType, stratName, judge.reason);
                try {
                  const retryDir = stratDir + "\n\nCRITICAL FEEDBACK from quality review: Previous attempt scored " + judge.score + "/100. Reason: " + judge.reason + ". Fix this issue in the new version.";
                  img = await _genImage(tripData, ctx, photoResult, cultural, ds, moments, prodType, stratName, retryDir, vi + 1);
                  if (img && img.base64) {
                    const judge2 = await _judgeImage(img.base64, img.mime, prodType, stratName);
                    status(`Retry quality: ${judge2.score}/100`);
                  }
                } catch(re) { console.warn("[SVN] Retry failed:", re.message); }
              } else {
                status(scoreStr);
              }

              if (img && img.base64) {
                results.push({ type: prodType, strategy: stratName, base64: img.base64, mime: img.mime || "image/png" });
                console.log("[SVN] Accepted", prodType, stratName);
              }
            } else {
              console.warn("[SVN] No image returned for", prodType, stratName);
            }
          } catch(e) {
            console.error("[SVN] Image gen failed:", prodType, stratName, e.message);
          }
          // Rate limiting between generations
          if (vi < selectedStrats.length - 1) await new Promise(r => setTimeout(r, 2000));
        }

        // Signature composite variant (bonus)
        if (numVariants > 1) {
          status(`Generating ${prodType} signature composite...`);
          try {
            const composite = await _genComposite(tripData, ctx, photoResult, cultural, ds, moments, prodType);
            if (composite && composite.base64) {
              results.push({
                type: prodType,
                strategy: "signature_composite",
                base64: composite.base64,
                mime: composite.mime || "image/png"
              });
              console.log("[SVN] Generated", prodType, "signature composite");
            }
          } catch(e) { console.error("[SVN] Composite gen failed:", prodType, e.message); }
        }

        // Pause between product types
        if (products.indexOf(prodType) < products.length - 1) {
          await new Promise(r => setTimeout(r, 2000));
        }
      }

      status(`Done! Generated ${results.length} souvenir designs.`);
      return results;

    } catch(e) {
      console.error("[SVN] Pipeline error:", e);
      status("Error: " + e.message);
      throw e;
    }
  }

  // ═══════════════════════════════════════════════════════════════════
  // Public API
  // ═══════════════════════════════════════════════════════════════════

  return {
    PRODUCT_SPECS,
    RULES,
    FUSIONS,
    generate,

    // Expose individual agents for advanced use
    _buildContext,
    _judgeImage,
    _curatePhotos,
    _culturalEnrich,
    _extractElements,
    _journeyMoments,
    _designSystem,
    _genImage,
    _genComposite,

    // Expose utilities
    _extractJson,
    _geoResolve,
    _findPOIs,
    _routeVisualize,
    _detectRouteType,
    _getDesignLanguage
  };
})();
