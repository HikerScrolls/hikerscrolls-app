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

  // ═══════════════════════════════════════════════════════════════════
  // Photo classification categories + per-product hero assignment
  // ═══════════════════════════════════════════════════════════════════

  const PHOTO_CATEGORIES = ["LANDMARK", "LANDSCAPE", "DETAIL", "ATMOSPHERE"];

  // Each product picks its hero from the optimal category.
  // Priority determines pick order for cross-product dedup.
  const PRODUCT_HERO_MAP = {
    postcard: { primary: "LANDSCAPE",  fallback: "ATMOSPHERE", priority: 1 },
    magnet:   { primary: "LANDMARK",   fallback: "LANDSCAPE",  priority: 2 },
    sticker:  { primary: "LANDMARK",   fallback: "DETAIL",     priority: 3 },
    pin:      { primary: "LANDMARK",   fallback: "DETAIL",     priority: 4 },
    stamp:    { primary: "DETAIL",     fallback: "LANDMARK",   priority: 5 }
  };

  const RULES = {
    postcard: "148x100mm landscape, STRICT 3:2 aspect ratio, full-bleed (design fills edge to edge, no inner white border). Output canvas: pure #FFFFFF background OUTSIDE the postcard shape \u2014 NO table, hands, fabric, or mockup surface.\n\nRENDERING MODE (critical): By default, the postcard is ILLUSTRATED/PAINTED/PRINTED \u2014 NOT a photograph. The attached reference photos inform subject matter, composition, and color palette, but are NOT the final content. Every visual element must be re-rendered in the chosen artistic medium (watercolor, gouache, screenprint, woodcut, ink, mixed-media). EXCEPTION: only the editorial_photo strategy allows a photographic hero, and even then it must be heavily color-graded (duotone, tritone, or matched to the design palette).\n\nCORE AESTHETIC: A REAL printed postcard you would actually mail. Warm matte paper feel, ink-on-paper finish. NOT glossy, NOT metallic, NOT 3D enamel, NOT plasticky, NOT digital-screen-looking. Reference aesthetics: WPA National Park posters, mid-century travel posters (Cassandre, Steinweiss), Kinfolk/Cereal magazine editorial, museum gift shop art postcards, Charley Harper prints.\n\nTEXT LAYOUT (mandatory):\n- Headline (location OR poetic title): CONFIDENT display typeface \u2014 vintage serif, geometric sans, or refined hand-lettering. Large and unmissable. Anchored to top 20% OR bottom 20% \u2014 never floating mid-frame.\n- Date: small, subordinate, in a corner or tucked under the headline.\n- Optional micro-label: distance/elevation, small caps.\n- Max 2 typefaces total. No comic sans, no clip-art fonts, no random decorative scripts.\n- Text MUST sit on a protected zone \u2014 scrim, gradient, panel, or clean sky area. NEVER stacked over busy photo textures where it becomes illegible.\n\nHARD AVOID:\n- Raw unmodified photographs placed in panels or frames (unless strategy is editorial_photo)\n- Photo collage with harsh rectangular cuts and no artistic treatment\n- Floating disconnected text elements\n- Clip-art borders, stock corner ornaments, shutterstock-watermark look\n- Multiple competing focal points fighting for attention\n- Muddy low-contrast color palettes\n- Over-saturated Instagram-filter look\n- Text that a 60-year-old cannot read at arm's length",
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
      panoramic_journey: "MEDIUM: Gouache or watercolor panorama, painted in a single unified session. NOT stitched photographs. The entire horizon is ONE painting with loose bleeding edges between scene areas. Shared atmospheric wash (golden hour, morning mist, or dusk haze) unifies everything. Subjects are PAINTED, not photographed. Bottom third carries a thin horizontal type bar with location name left-aligned and date right-aligned, separated by a hairline rule. The eye travels left to right like a traveler crossing the painted landscape. Reference: WPA National Park watercolor posters, David Hockney panoramas.",
      triptych_narrative: "MEDIUM: Illustrated gouache, screenprint, or vintage travel poster style. Three narrative scenes (PLACE \u2192 MOMENT \u2192 DETAIL) arranged left to right, telling a story of arrival, experience, and memory. CRITICAL LAYOUT: NO hard panel dividers, NO visible gutters or borders between scenes. The three scenes FLOW INTO EACH OTHER through soft gradient transitions, shared atmospheric light, overlapping silhouettes, or color washes that bridge scene boundaries. The edges between scenes should be INVISIBLE \u2014 one scene melts into the next like a dissolve in film. ONE PRIMARY SUBJECT must clearly dominate: it occupies the visual center, is rendered in the most detail and contrast, and draws the eye first. The other two scenes recede in saturation, detail, or scale \u2014 they support the hero, they don't compete with it. Shared palette (4\u20136 colors), unified light direction, same brushwork texture throughout. Headline at bottom in hand-lettered or custom type, anchored to the illustration. Reference: WPA travel posters, Charley Harper, mid-century illustrated travel brochures where multiple scenes merge into one composition.",
      illustrated_map: "MEDIUM: Hand-drawn ink and watercolor map. The postcard IS a stylized map, NOT a photo composite. Stylized terrain drawn in ink lines, hand-lettered place names, confident route line connecting waypoints, tiny vignette illustrations at each stop (small watercolor sketches, NEVER pasted photos). Optional compass rose or scale bar. Title set in a vintage cartouche in the top-left corner. Limited palette: 4\u20135 inks max, plus subtle warm paper texture showing through. Reference: Tolkien Middle-earth maps, Lonely Planet illustrated maps, vintage national park maps.",
      editorial_photo: "THIS IS THE ONE STRATEGY WHERE A PHOTOGRAPHIC HERO IS ALLOWED. One dominant hero PHOTO fills the entire card, but heavily color-graded to MATCH the design system palette (not the raw photo colors) \u2014 duotone, tritone, bleached, warmed, or pushed into a unified grade. Large confident typographic overlay \u2014 the headline IS the point, set in a display serif or elegant geometric sans, anchored either full-width at the bottom OR hard-left in a corner. A dark scrim, color gradient, or solid color block sits behind the text for legibility. Think Kinfolk magazine cover, Cereal magazine, New York Times editorial travel feature. NOT a social media share card.",
      layered_memory: "MEDIUM: Mixed-media collage \u2014 aged paper, hand-stamped elements, illustration mixed with heavily-processed image fragments. NOT raw photos. Every image fragment must be TREATED (aged, desaturated to near-monochrome with selective color, halftone-printed, or painted over). Soft feathered edges, no hard crops. One clean typographic anchor: the location name set confidently in one spot (lower-left or lower-right), date as a subtle companion beneath. Warm nostalgic palette. Feels hand-assembled from a travel journal. Reference: vintage scrapbooks, Wes Anderson title design, Peter Beard journals."
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

  // ═══════════════════════════════════════════════════════════════════
  // Artistic Lettering Styles — crafted letterforms, NOT default fonts
  // The headline must feel drawn by an artist, not set in Helvetica.
  // ═══════════════════════════════════════════════════════════════════
  const LETTERING_STYLES = {
    hand_lettered:        "Custom hand-drawn letters with personality and slight imperfections. Variable stroke weights, playful ligatures, subtle wobble. Think contemporary lettering artists (Jessica Hische, Lauren Hom), indie travel journals, hand-painted signage. NOT a font \u2014 drawn letter by letter.",
    vintage_display_serif: "Bold high-contrast display serif, 1920s\u20131940s editorial elegance. Didone/Bodoni proportions, fine hairlines meeting thick stems, sometimes with decorative swash terminals. Think National Geographic masthead, vintage travel brochures, Vogue covers.",
    deco_sans:            "Geometric Art Deco display sans \u2014 crisp angles, streamlined forms, perfectly circular O's, triangular A's. Cassandre travel posters, Paris Metro entrances, Chrysler Building signage, Broadway marquees.",
    sign_painter:         "Traditional hand-painted sign aesthetic \u2014 confident brush strokes with drop shadow, outline fills, sometimes multi-color layered letters. American diner signs, barbershops, national park trail markers, vintage storefronts.",
    western_wood_type:    "Victorian/western display wood type \u2014 slab serifs, extreme weight contrast, condensed compressed letters stacked in multiple sizes, ornamental flourishes and wood grain texture. Old west posters, carnival broadsides, frontier expedition prints.",
    cartouche_script:     "Vintage map cartouche \u2014 flourished calligraphic script enclosed in a decorative frame (scrolls, ribbons, laurel). Reference: Tolkien's Middle-earth maps, 18th\u201319th century exploration journals, historical atlases.",
    brush_lettering:      "Expressive brush stroke lettering with variable weight and wet-ink feel. East Asian calligraphy influence, contemporary brush hand. Strokes have direction, pressure, and rhythm. Good for Japan/China/Korea routes or energetic adventures.",
    stencil_industrial:   "Bold stencil letters with visible gaps/bridges \u2014 military, industrial, travel crate aesthetic. Can have spray paint texture or clean cut. Good for adventure/expedition/urban explorer vibes.",
    badge_monogram:       "Letters integrated into a monogram, crest, or shield \u2014 trip branded like a heraldic device. Letters interlock, stack, or nest inside a circular/shield frame. National Park emblem, college crest, boy scout badge.",
    engraved_classical:   "Classical engraved inscription \u2014 Trajan column proportions, museum plaque, commemorative medal, currency engraving. Perfectly spaced capitals, restrained elegance. For formal/historical/pilgrimage trips."
  };

  // ═══════════════════════════════════════════════════════════════════
  // Quality framework (inspired by "complexity vs harmony" composition theory)
  //
  // Q = Harmony × f(Complexity), where f is an inverted-U function.
  // Low complexity → boring/empty. High complexity → chaotic. Mid + organized = best.
  //
  // 5 scoring dimensions, each 0-20, max raw = 100:
  //   1. composition         — layout balance, hierarchy, focal point, rule of thirds
  //   2. style_coherence     — UNIFIED rendering style (no photo+illustration+3D mix — #1 AI failure)
  //   3. stacking_quality    — layered elements: boundary consistency, depth clarity, natural transitions
  //   4. product_fit         — believability as the specific product type
  //   5. text_typography     — legibility, contrast, placement, typographic craft
  //
  // Failure flags deduct hard penalties on top of weighted score.
  // ═══════════════════════════════════════════════════════════════════

  // Strategies that allow photographic content in the final output.
  // Any strategy NOT in this set must produce an illustration/painting/print
  // — raw photos in the output are a hard failure.
  const PHOTO_ALLOWED_STRATEGIES = new Set([
    "editorial_photo" // postcard: the one strategy built around a heavily-graded hero photo
  ]);

  // Hard deductions for specific failure modes (applied AFTER weighted dimension score).
  const FAILURE_FLAG_PENALTIES = {
    raw_photos_in_design:       18, // design contains raw/unprocessed photos when strategy requires illustration (highest penalty)
    mixed_rendering_styles:     15, // photo pasted into illustration, or 3D element in flat design
    subjects_blurred_together:  12, // overlap density too high, no clear individual subjects
    harsh_photo_cuts:           10, // rectangular photo boxes placed next to each other
    random_floating_elements:   10, // text or motifs with no visual anchor
    boundary_style_inconsistent: 8, // some edges sharp, others feathered — incoherent
    over_stacked_lost_subjects: 10, // too many layered elements, main subjects unreadable
    illegible_text:             12, // text stacked on busy regions, poor contrast
    typography_too_plain:       10, // default system font look (Helvetica/Arial/Times dropped on image, no craft)
    visual_weight_unstable:      6, // heavy elements floating, light elements pinned down (anti-physics)
    complexity_too_low:          8, // almost empty, boring, no design happening (inverted-U left tail)
    complexity_too_high:         8  // chaotic clutter, no hierarchy (inverted-U right tail)
  };

  const PRODUCT_JUDGE_CRITERIA = {
    postcard: {
      focus: "Does this look like a REAL printed postcard you could mail? Paper/ink feel, NOT metallic/3D/enamel. Correct 3:2 landscape aspect. Text must be legible with strong contrast, sitting on a protected zone (scrim, sky, or panel). Typography is confident and intentional, not floating random elements.",
      fail_conditions: [
        "metallic, enamel, or 3D relief finish (wrong product \u2014 this is flat paper)",
        "raw photo with no design treatment or artistic grading",
        "text stacked over busy photo regions without scrim or panel (illegible)",
        "clip-art borders, stock frame ornaments, or shutterstock-watermark aesthetic",
        "wrong aspect ratio (not 3:2 landscape)",
        "multiple competing focal points with no clear hierarchy",
        "floating disconnected text in the middle of the frame"
      ],
      complexity_target: "medium-high", // postcard can carry rich detail
      weight: { composition: 1.1, style_coherence: 1.2, stacking_quality: 1.0, product_fit: 0.9, text_typography: 0.8 }
    },
    magnet: {
      focus: "Does this look like a 3D enamel fridge magnet? Visible raised layers, metallic dividers between color fields, physical depth you can feel. Photo content should be STYLIZED into enamel, not pasted flat.",
      fail_conditions: [
        "flat print with no 3D relief or layering",
        "no metallic dividers between color zones",
        "photo-realistic texture instead of stylized enamel",
        "looks like a sticker or postcard, not a magnet"
      ],
      complexity_target: "medium",
      weight: { composition: 0.9, style_coherence: 1.2, stacking_quality: 1.2, product_fit: 1.3, text_typography: 0.4 }
    },
    sticker: {
      focus: "Does this look like a die-cut sticker? Bold simplified shapes, clean die-cut outline, flat graphic colors, readable at small scale.",
      fail_conditions: [
        "photo-realistic rendering (stickers must be simplified/graphic)",
        "too much fine detail for sticker scale",
        "missing the die-cut shape outline",
        "muddy or too many colors"
      ],
      complexity_target: "low", // stickers need restraint at small scale
      weight: { composition: 1.0, style_coherence: 1.3, stacking_quality: 0.8, product_fit: 1.3, text_typography: 0.6 }
    },
    pin: {
      focus: "Does this look like a cloisonne enamel pin? Visible metal wire boundaries between color fills, jewel-like enamel depth, limited color palette, refined craftsmanship.",
      fail_conditions: [
        "no visible metal boundary lines between color zones",
        "more than 6 flat colors (cloisonne requires restraint)",
        "flat print aesthetic instead of enamel depth",
        "shape is not circular (unless strategy explicitly says otherwise)"
      ],
      complexity_target: "low-medium",
      weight: { composition: 0.9, style_coherence: 1.3, stacking_quality: 1.0, product_fit: 1.5, text_typography: 0.3 }
    },
    stamp: {
      focus: "Does this look like a commemorative postage stamp? Perforated edge visible or implied, engraving/crosshatch line work, scale-appropriate fine detail, classic print aesthetic.",
      fail_conditions: [
        "no perforated edge",
        "photographic rendering instead of engraved/crosshatched",
        "missing 'COMMEMORATIVE' or similar marking",
        "detail too coarse for stamp scale"
      ],
      complexity_target: "low", // stamp scale demands restraint
      weight: { composition: 0.9, style_coherence: 1.3, stacking_quality: 0.9, product_fit: 1.4, text_typography: 0.5 }
    }
  };

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

  // Synthesize "what makes this trip unique" from context + cultural + route data.
  // Pure JS, zero API calls. Used to inject signature hints into photo classification prompt.
  function _buildSignatureHints(ctx, cultural, routeViz) {
    const parts = [];
    if (cultural.unified_motifs?.length)
      parts.push("Cultural identity: " + cultural.unified_motifs.join(", "));
    const arch = (cultural.locations || []).flatMap(l => l.architectural_features || []).filter((v, i, a) => a.indexOf(v) === i).slice(0, 5);
    if (arch.length) parts.push("Architecture: " + arch.join(", "));
    const nat = (cultural.locations || []).flatMap(l => l.natural_features || []).filter((v, i, a) => a.indexOf(v) === i).slice(0, 5);
    if (nat.length) parts.push("Natural features: " + nat.join(", "));
    const routeType = _detectRouteType(ctx);
    if (routeViz && routeViz.total_km > 0)
      parts.push("Route: " + routeType + ", " + routeViz.total_km.toFixed(1) + "km");
    if (ctx.narrative_keywords?.length)
      parts.push("Trip essence: " + ctx.narrative_keywords.join(", "));
    const pois = (ctx._pois || []).slice(0, 5).map(p => p.name + " (" + p.type + ")");
    if (pois.length) parts.push("Notable POIs: " + pois.join(", "));
    return parts.join("\n") || "No specific signature features identified";
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
  // Agent 2b: Classify Photos by design role (replaces _curatePhotos)
  // Uses cultural + route data to understand local character FIRST,
  // then classifies each photo by category (LANDMARK/LANDSCAPE/DETAIL/ATMOSPHERE).
  // ═══════════════════════════════════════════════════════════════════

  async function _classifyPhotos(photoBase64Array, ctx, cultural, routeViz, onStatus) {
    if (onStatus) onStatus("Classifying photos...");
    const signatureHints = _buildSignatureHints(ctx, cultural, routeViz);
    console.log("[SVN] Signature hints:\n", signatureHints);

    const allP = (photoBase64Array || []).map((p, idx) => ({
      _idx: idx,
      b64: p.base64,
      mime: p.mimeType || "image/jpeg",
      loc: p.location || p.title || "Unknown",
      title: p.title || ""
    }));

    const toClassify = allP.slice(0, 20);
    const classified = [];

    for (let i = 0; i < toClassify.length; i++) {
      const ph = toClassify[i];
      if (onStatus) onStatus(`Classifying photo ${i + 1}/${toClassify.length}: ${ph.loc}`);
      try {
        if (!ph.b64) { console.warn("[SVN] photo has no base64:", ph.loc); continue; }
        const prompt = `You are a travel photo classifier for souvenir product design.

Classify this photo into ONE primary and ONE secondary category:

CATEGORIES:
- LANDMARK: Iconic buildings, monuments, sculptures, distinctive man-made structures. Clear singular subject that could be the centerpiece of a magnet or pin.
- LANDSCAPE: Wide vistas, panoramas, skylines, bay/ocean/mountain views, nature scenes. Emphasizes breadth, space, and horizon. Good for postcards.
- DETAIL: Textures, patterns, close-ups, food, crafts, street art, cultural objects, architectural ornaments. Small-scale, tactile. Good for stamps.
- ATMOSPHERE: Street scenes, light/mood, people in context, candid moments, weather, urban energy. Captures a feeling more than a subject.

Score this photo's FITNESS for each category (0-25). A landscape panorama scores high on LANDSCAPE, low on DETAIL.
Also score overall design quality (0-25): composition, color, visual impact.

ROUTE CONTEXT (what makes this trip locally distinctive):
${signatureHints}

Does this photo capture any of the distinctive local features listed above? If yes, describe which specific feature. If no, output null.

Output ONLY JSON:
{"primary_category":"LANDMARK|LANDSCAPE|DETAIL|ATMOSPHERE","secondary_category":"LANDMARK|LANDSCAPE|DETAIL|ATMOSPHERE","category_scores":{"LANDMARK":0,"LANDSCAPE":0,"DETAIL":0,"ATMOSPHERE":0},"quality_score":0,"signature_match":"specific local feature or null","detected_elements":["element1","element2"],"crop_suggestion":{"aspect_ratio":"16:9 or 1:1 or 4:3","focal_point":"description","safe_zone":"description"},"distinctive_feature":"what makes THIS photo unique in 1 sentence"}`;

        const result = await callAI("vision", {
          systemPrompt: null,
          parts: [
            { inlineData: { mimeType: ph.mime, data: ph.b64 } },
            { text: prompt }
          ],
          temperature: 0.3
        });
        const txt = result?.text || result || "";
        const res = _extractJson(txt);
        if (res) {
          const catScores = res.category_scores || {};
          classified.push({
            ...ph,
            category: res.primary_category || "ATMOSPHERE",
            secondary_category: res.secondary_category || "ATMOSPHERE",
            category_scores: catScores,
            quality_score: res.quality_score || 0,
            score: res.quality_score || 0, // backward compat
            signature_match: (res.signature_match && res.signature_match !== "null" && res.signature_match.length > 5) ? res.signature_match : null,
            elements: res.detected_elements || [],
            crop: res.crop_suggestion,
            distinctive_feature: res.distinctive_feature || ""
          });
          console.log("[SVN] Classified:", ph.loc, "→", res.primary_category,
            "quality:", res.quality_score,
            "sig:", res.signature_match ? "YES" : "no",
            "scores:", JSON.stringify(catScores));
        } else {
          console.warn("[SVN] classify parse FAIL:", ph.loc, txt?.slice?.(0, 200));
        }
      } catch (e) { console.error("[SVN] classify EXCEPTION:", ph.loc, e.message); }
      if (i < toClassify.length - 1) await new Promise(r => setTimeout(r, 1500));
    }

    // Build byCategory buckets: each photo sorted by its score in that category
    const byCategory = {};
    for (const cat of PHOTO_CATEGORIES) {
      byCategory[cat] = classified
        .filter(p => (p.category_scores[cat] || 0) > 5) // only include if reasonable fit
        .sort((a, b) => (b.category_scores[cat] || 0) - (a.category_scores[cat] || 0));
    }

    // Signature photos: those with a non-null signature_match, ranked by quality
    const signaturePhotos = classified
      .filter(p => p.signature_match)
      .sort((a, b) => b.quality_score - a.quality_score);

    // Backward-compat: topPhotos and heroPhoto
    const topPhotos = [...classified].sort((a, b) => b.quality_score - a.quality_score).slice(0, 5);

    console.log("[SVN] Classification summary:",
      "LANDMARK:", byCategory.LANDMARK?.length || 0,
      "LANDSCAPE:", byCategory.LANDSCAPE?.length || 0,
      "DETAIL:", byCategory.DETAIL?.length || 0,
      "ATMOSPHERE:", byCategory.ATMOSPHERE?.length || 0,
      "signature:", signaturePhotos.length);

    return {
      byCategory,
      signaturePhotos,
      topPhotos,
      heroPhoto: topPhotos[0] || null,
      allClassified: classified
    };
  }

  // ═══════════════════════════════════════════════════════════════════
  // Agent 2c: Extract elements from top photo per category
  // ═══════════════════════════════════════════════════════════════════

  async function _extractMultiElements(classifiedResult, ctx, cultural, onStatus) {
    const elementSets = {};
    const seen = new Set();
    for (const cat of PHOTO_CATEGORIES) {
      const photos = classifiedResult.byCategory[cat] || [];
      const photo = photos.find(p => !seen.has(p._idx)) || photos[0];
      if (!photo?.b64) { elementSets[cat] = null; continue; }
      if (seen.has(photo._idx)) {
        // Already extracted this photo for another category — alias the result
        for (const [prevCat, prevSet] of Object.entries(elementSets)) {
          if (prevSet && classifiedResult.byCategory[prevCat]?.[0]?._idx === photo._idx) {
            elementSets[cat] = prevSet;
            break;
          }
        }
        continue;
      }
      seen.add(photo._idx);
      if (onStatus) onStatus(`Extracting ${cat} elements: ${photo.loc}`);
      elementSets[cat] = await _extractElements(photo, ctx, cultural, onStatus);
      await new Promise(r => setTimeout(r, 1500));
    }
    console.log("[SVN] Multi-elements extracted:", Object.entries(elementSets).filter(([, v]) => v).map(([k, v]) => k + ": " + (v?.element_name || "?")).join(", "));
    return elementSets;
  }

  // ═══════════════════════════════════════════════════════════════════
  // Agent 2d: Assign heroes per product (deterministic, 0 API calls)
  // ═══════════════════════════════════════════════════════════════════

  function _assignHeroes(classifiedResult, elementSets, selectedProducts) {
    const assignments = {};
    const usedPhotos = new Set();

    // Sort products by priority (lower picks first)
    const sorted = [...selectedProducts].sort((a, b) =>
      (PRODUCT_HERO_MAP[a]?.priority || 99) - (PRODUCT_HERO_MAP[b]?.priority || 99)
    );

    for (const prodType of sorted) {
      const map = PRODUCT_HERO_MAP[prodType];
      if (!map) continue;

      let photo = null, category = null;

      // Try primary category, then fallback
      for (const cat of [map.primary, map.fallback]) {
        const candidates = classifiedResult.byCategory[cat] || [];
        // Prefer signature-matched photos in this category
        const sigMatch = candidates.find(p => !usedPhotos.has(p._idx) && p.signature_match);
        const available = sigMatch || candidates.find(p => !usedPhotos.has(p._idx));
        if (available) { photo = available; category = cat; break; }
      }

      // Last resort: best available from any category
      if (!photo) {
        photo = classifiedResult.topPhotos.find(p => !usedPhotos.has(p._idx))
          || classifiedResult.topPhotos[0];
        category = photo?.category || "LANDSCAPE";
      }

      if (photo) usedPhotos.add(photo._idx);

      assignments[prodType] = {
        photo,
        elements: elementSets[category] || elementSets[photo?.category] || null,
        category
      };
      console.log("[SVN] Hero assigned:", prodType, "→", photo?.loc, `(${category})`, photo?.signature_match ? "[SIG]" : "");
    }
    return assignments;
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

Typography principle: The headline is a CRAFTED VISUAL ELEMENT, not a default font.
Pick ONE lettering_style from this list that best fits the trip's mood and region:
${Object.entries(LETTERING_STYLES).map(([k,v]) => "- " + k + ": " + v).join("\n")}

Output ONLY strict JSON:
{"visual_approach":"photo-driven or route-driven",
 "color_system":{"primary":"#hex","secondary":["#hex","#hex"],"text_on_primary":"#hex","accent":"#hex","rationale":"color logic"},
 "typography":{
   "lettering_style":"EXACTLY one key from the list above (e.g., hand_lettered, deco_sans)",
   "lettering_rationale":"why this style fits this specific trip \u2264 20 words",
   "headline_treatment":"how the headline integrates with the artwork \u2014 banner, cartouche, overlay, decorative flourishes, texture \u2264 30 words",
   "secondary_type_style":"smaller type style for date/distance labels \u2264 15 words",
   "required_text_elements":["location","date","distance or elevation"],
   "suggested_headline":"English \u22648 words, poetic"
 },
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
      typography:{lettering_style:"hand_lettered",lettering_rationale:"default fallback",headline_treatment:"integrated with illustration",secondary_type_style:"small caps",suggested_headline:ctx.trip_title||"Journey"}, primary_motif:"landscape", secondary_motifs:[], mood_descriptor:"adventure", product_focus:{}
    };
  }

  // ═══════════════════════════════════════════════════════════════════
  // Agent 6: Image Generation
  // ═══════════════════════════════════════════════════════════════════

  async function _genImage(trip, ctx, photoResult, cultural, ds, moments, prodType, stratName, stratDir, varNum, heroAssignment) {
    const cs = ds.color_system || {};
    const rule = RULES[prodType] || "";
    const dk = "design_" + (prodType === "magnet" ? "fridge_magnet" : prodType);

    // ── Variant hero selection ──
    // heroAssignment = {photo, elements, category} or null for composite.
    const hasHero = heroAssignment && heroAssignment.photo && moments.length > 0;
    // Find the moment that matches the assigned hero photo's location
    const heroMoment = hasHero
      ? (moments.find(m => m.photo_loc === heroAssignment.photo.loc || m.location_name === heroAssignment.photo.loc) || moments[0])
      : null;
    const otherMoments = hasHero ? moments.filter(m => m !== heroMoment) : moments;

    // Build scene inventory
    let sceneInventory;
    if (hasHero && heroMoment) {
      const h = heroMoment;
      const supportingStr = otherMoments.slice(0, 3).map((m, i) =>
        `  [supporting ${i + 1}] ${m.location_name} \u2014 ${(m.moment_caption || "").slice(0, 80)}`
      ).join("\n");
      sceneInventory =
        `  [\u2B50 PRIMARY HERO \u2014 THIS variant is about THIS scene] ${h.location_name}\n` +
        `     "${h.moment_caption}"\n` +
        `     ${(h.defining_quality || "").slice(0, 140)}\n` +
        `     Emotion: ${h.emotional_note || ""}\n` +
        `     Design direction for ${prodType}: ${(h[dk] || h.design_postcard || "").slice(0, 180)}\n\n` +
        `  Supporting scenes (may appear as subtle background context only, NOT as focal points):\n` +
        (supportingStr || "  (none)");
    } else {
      sceneInventory = moments.map((m, i) =>
        `  [${i + 1}] ${m.location_name}\n     "${m.moment_caption}"\n     ${(m.defining_quality || "").slice(0, 120)}\n     Emotion: ${m.emotional_note || ""}\n     Design: ${(m[dk] || m.design_postcard || "").slice(0, 150)}`
      ).join("\n");
    }

    // Cultural context string
    const cultStr = (cultural.locations||[]).map(l =>
      l.location_name + ": symbols=" + (l.visual_motifs||[]).join(",") + " arch=" + (l.architectural_features||[]).join(",") + " nature=" + (l.natural_features||[]).join(",") + " colors=" + (l.color_palette||[]).join(",")
    ).join("\n");

    const heroCategory = heroAssignment?.category || "";
    const heroElementInfo = heroAssignment?.elements
      ? `\nHero element: ${heroAssignment.elements.element_name || ""} (${heroAssignment.elements.element_type || ""})\n  ${heroAssignment.elements.description || ""}`
      : "";
    const variantFocusSection = hasHero && heroMoment ? `

=== HERO ASSIGNMENT (from ${heroCategory} category) ===
This product (${prodType}) has been assigned a ${heroCategory} hero.
The hero was selected because ${heroCategory} photos work best for ${prodType} products.
${heroElementInfo}

PRIMARY SUBJECT for THIS product: "${heroMoment.location_name}"
  Caption: ${heroMoment.moment_caption}
  Key elements: ${(heroMoment.photo_elements || []).join(", ") || "(see attached photo)"}
  Distinctive feature: ${heroAssignment.photo?.distinctive_feature || ""}

This subject MUST occupy 50-70% of the visual weight and be the clear, unmistakable focal point.
Other scenes appear as subtle supporting context only — they MUST NOT compete with the hero.

IMPORTANT: Other product types in this batch have been assigned DIFFERENT heroes from different categories.
Your job is to tell the story of "${heroMoment.location_name}" for this ${prodType}. Do not substitute a different subject.
` : "";

    const photoAllowed = PHOTO_ALLOWED_STRATEGIES.has(stratName);
    const ruleZero = photoAllowed
      ? `\u2554\u2550\u2550 RULE ZERO \u2014 EDITORIAL PHOTO STRATEGY \u2550\u2550\u2557
This strategy ("${stratName}") is the ONE exception where a photographic hero is allowed.
Use ONE hero photo, but you MUST heavily color-grade it \u2014 duotone, tritone, bleached,
warmed, or pushed into the design-system palette. A raw unmodified photo is still a failure.
\u255a\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u255d`
      : `\u2554\u2550\u2550 RULE ZERO \u2014 NO RAW PHOTOGRAPHS IN THE OUTPUT \u2550\u2550\u2557
The final design MUST NOT contain raw photographic imagery. Every visual element
must be RE-RENDERED as illustration, painting, watercolor, gouache, screenprint,
woodcut, ink-and-wash, or mixed-media \u2014 following the strategy's chosen MEDIUM.

The attached photos are REFERENCE ONLY \u2014 use them to understand subject identity,
composition geometry, and dominant colors. They MUST NOT appear in the final output.

If you find yourself placing a photo inside a frame/panel/box, STOP and redraw
the scene in the chosen artistic medium instead. A photo with a title bar is
NOT a designed postcard.
\u255a\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u255d`;

    const prompt = `You are a senior travel souvenir designer. Create variant ${varNum}.

${ruleZero}

Above are reference photos from this trip. They are REFERENCE MATERIAL to understand the place, subjects, and colors \u2014 NOT the final output. The final design must be RE-RENDERED in the chosen illustration/print style.

=== YOUR CREATIVE BRIEF: "${stratName}" ===
${stratDir}

This is your PRIMARY CREATIVE DIRECTIVE. Follow its spirit, not just its letter.
${variantFocusSection}
=== SCENE INVENTORY ===
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

=== ARTISTIC LETTERING (CRITICAL \u2014 do NOT use default fonts) ===
The headline is a CRAFTED VISUAL ELEMENT, not a default font dropped on the image.
It must feel DRAWN BY AN ARTIST as part of the artwork \u2014 custom letterforms, decorative flourishes, texture, integration with the illustration.

Chosen lettering style: "${ds.typography?.lettering_style || "hand_lettered"}"
Style reference: ${LETTERING_STYLES[ds.typography?.lettering_style] || LETTERING_STYLES.hand_lettered}

Headline treatment: ${ds.typography?.headline_treatment || "hand-drawn title integrated with the illustration"}
Secondary type style: ${ds.typography?.secondary_type_style || "small caps, refined, subordinate"}

LETTERING REQUIREMENTS:
- Custom letterforms with personality \u2014 variable stroke weights, ligatures, swashes, or decorative terminals
- Lettering can curve, arc, integrate with banners, cartouches, ribbons, or scenic elements
- Match the chosen lettering style's historical/cultural reference
- The headline should be a FOCAL POINT or a crafted accent, not an afterthought overlay
- Secondary labels (date, distance) in a complementary but subordinate style

HARD AVOID in typography:
- Arial, Helvetica, Times New Roman, or any default system-font look
- Plain centered uppercase with no character
- "Photoshop text tool" aesthetic \u2014 flat, pasted, no integration
- Generic "travel template" look
- Lettering that contradicts the chosen style

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

    // Attach reference photos based on hero assignment.
    // Hero-focused: attach the assigned hero photo + 1 supporting photo from a DIFFERENT category.
    // Composite (heroAssignment=null): attach all top photos for the "full story" collage.
    const parts = [];
    const top = photoResult.topPhotos || [];
    if (hasHero && heroAssignment?.photo) {
      const hp = heroAssignment.photo;
      if (hp.b64) {
        parts.push({ inlineData: { mimeType: hp.mime || "image/jpeg", data: hp.b64 } });
      }
      // Add 1 supporting photo from a DIFFERENT category for context
      const supportingPhoto = top.find(p => p !== hp && p.category !== heroAssignment.category);
      if (supportingPhoto && supportingPhoto.b64) {
        parts.push({ inlineData: { mimeType: supportingPhoto.mime || "image/jpeg", data: supportingPhoto.b64 } });
      }
    } else {
      // Composite path: use all top photos
      for (let i = 0; i < Math.min(top.length, 5); i++) {
        if (top[i].b64) parts.push({ inlineData: { mimeType: top[i].mime || "image/jpeg", data: top[i].b64 } });
      }
    }
    parts.push({ text: prompt });

    const result = await callAI("image", { parts });
    return result; // {base64, mime} or null
  }

  // ═══════════════════════════════════════════════════════════════════
  // Quality Judge — evaluates generated souvenir image
  // ═══════════════════════════════════════════════════════════════════
  async function _judgeImage(imageBase64, imageMime, prodType, stratName) {
    const criteria = PRODUCT_JUDGE_CRITERIA[prodType] || PRODUCT_JUDGE_CRITERIA.postcard;
    const failList = criteria.fail_conditions.map((f, i) => `   ${i + 1}. ${f}`).join("\n");
    const flagList = Object.entries(FAILURE_FLAG_PENALTIES).map(([k, v]) => `   - ${k} (\u22121${v})`).join("\n");
    const photoAllowed = PHOTO_ALLOWED_STRATEGIES.has(stratName);
    const photoPolicy = photoAllowed
      ? `This strategy ("${stratName}") ALLOWS a photographic hero, but the photo MUST be heavily color-graded (duotone, tritone, matched to the design palette) \u2014 a raw unmodified photo still fails. If you see a raw/unprocessed photo, flag raw_photos_in_design.`
      : `This strategy ("${stratName}") does NOT allow raw photographs. The design must be illustration/painting/print (watercolor, gouache, screenprint, woodcut, ink, mixed-media). If you see a raw unmodified photograph anywhere in the output, flag raw_photos_in_design \u2014 this is the highest-severity failure for this strategy.`;
    try {
      const prompt = `You are a strict quality judge for travel souvenir products, trained in composition theory, visual design, and craft manufacturing.
Evaluate this generated ${prodType} design (strategy: ${stratName}).

=== PHOTO POLICY FOR THIS STRATEGY ===
${photoPolicy}

=== QUALITY FRAMEWORK ===
Good design = Harmony \u00D7 f(Complexity), where f is an inverted-U curve.
- LOW complexity (empty/boring) \u2192 bad
- HIGH complexity (chaotic/cluttered) \u2192 bad
- MEDIUM complexity organized with harmony \u2192 best
For this product, the target complexity is: ${criteria.complexity_target}

=== 5 SCORING DIMENSIONS (each 0-20) ===

1. composition (0-20)
   Layout balance, visual hierarchy, clear focal point, rule-of-thirds or golden-ratio awareness.
   Is the eye guided on a deliberate path? Is there a dominant subject?
   Complexity on target (not empty, not chaotic)?

2. style_coherence (0-20) \u2014 #1 AI failure mode, judge ruthlessly
   Are ALL elements rendered in ONE unified visual style?
   FAIL if the design mixes: photo + illustration + 3D render + flat vector in the same frame.
   FAIL if boundary treatments are inconsistent: some edges sharp, others feathered, others glowing.
   FAIL if lighting direction differs between elements (one lit from left, another from above).
   PASS if every element feels like it came from the same artist's hand in the same session.

3. stacking_quality (0-20) \u2014 layering and overlap harmony
   If elements overlap: are transitions natural (gradients, blends, shared palette) or harsh (rectangular photo cuts)?
   Are depth layers clear: foreground / middle / background distinguishable?
   Do heavy elements sit at the bottom/anchor points (physical visual weight)?
   Are partially-occluded subjects still readable in their remaining visible area?
   If NO overlapping elements, judge based on element separation and negative-space handling.

4. product_fit (0-20)
   ${criteria.focus}

5. text_typography (0-20) \u2014 legibility AND artistic craft
   Two sub-checks, both matter:
   (a) Legibility: strong contrast, sits on a protected zone (scrim/panel/clean area), readable at product scale.
   (b) Artistic craft: Is the headline CRAFTED as a visual element, or is it a default font dropped on the image?
       HIGH score (16\u201320): custom hand-lettering, vintage display type, decorative letterforms, cartouche/banner integration, brush strokes, sign-painter aesthetic, letterforms with personality and integration with the artwork.
       MID score (10\u201315): well-chosen typeface but generic placement, clean but unremarkable.
       LOW score (0\u20139): Arial/Helvetica/Times New Roman default look, plain centered uppercase, "Photoshop text tool" pasted on top, generic travel template feel.
   If the design has NO text at all, score 12/20 by default (no text is acceptable but not rewarded).

=== PRODUCT-SPECIFIC FAIL CONDITIONS (deduct 5+ from product_fit per match) ===
${failList}

=== FAILURE FLAGS (automatic hard penalties applied on top) ===
Check for these specific failure modes. Include ALL that apply in the "flags" array:
${flagList}

=== OUTPUT ===
List up to 3 specific issues the generator can fix on retry (empty array if clean).
Each issue: short actionable phrase, not vague.

Output ONLY strict JSON:
{
  "composition": N,
  "style_coherence": N,
  "stacking_quality": N,
  "product_fit": N,
  "text_typography": N,
  "flags": ["flag_name_from_list_above", ...],
  "issues": ["specific actionable issue", ...],
  "reason": "one sentence overall verdict"
}`;

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
        const w = criteria.weight;
        const sumW = w.composition + w.style_coherence + w.stacking_quality + w.product_fit + w.text_typography;
        // Weighted dimension score, normalized to 0-100.
        // Each dim is 0-20, so max raw = 20 * sumW. Scale: raw / sumW * 5 → 0-100.
        const weightedRaw =
          ((parsed.composition || 0) * w.composition +
            (parsed.style_coherence || 0) * w.style_coherence +
            (parsed.stacking_quality || 0) * w.stacking_quality +
            (parsed.product_fit || 0) * w.product_fit +
            (parsed.text_typography || 0) * w.text_typography);
        const weighted = weightedRaw / sumW * 5;

        // Apply failure flag penalties (hard deductions)
        const flags = Array.isArray(parsed.flags) ? parsed.flags.filter(f => FAILURE_FLAG_PENALTIES[f] != null) : [];
        const flagPenalty = flags.reduce((sum, f) => sum + FAILURE_FLAG_PENALTIES[f], 0);

        const finalScore = Math.max(0, Math.round(weighted - flagPenalty));

        return {
          score: finalScore,
          weighted_score: Math.round(weighted),
          flag_penalty: flagPenalty,
          flags,
          reason: parsed.reason || "",
          issues: Array.isArray(parsed.issues) ? parsed.issues : [],
          details: parsed
        };
      }
    } catch (e) {
      console.warn("[SVN] Judge failed:", e.message);
    }
    return { score: 100, weighted_score: 100, flag_penalty: 0, flags: [], reason: "Judge unavailable, accepting by default", issues: [], details: {} };
  }

  async function _genComposite(trip, ctx, photoResult, cultural, ds, moments, prodType) {
    const strategy = {
      name: "full_collage_signature",
      directive: "This is the SIGNATURE PIECE \u2014 the one design that captures everything. Use ALL provided scenes. Pack in as much of the trip as possible while maintaining visual coherence. Every scene should earn its place. The result should reward close looking \u2014 new details emerge on each viewing. This is the keeper, the centrepiece, the souvenir that tells the complete story of the trip."
    };
    // heroIdx=null tells _genImage to use ALL scenes equally (full story mode)
    return await _genImage(trip, ctx, photoResult, cultural, ds, moments, prodType, strategy.name, strategy.directive, 0, null);
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
      status("Agent 1/8: Building trip context...");
      const ctx = await _buildContext(tripData, status);
      console.log("[SVN] Context built:", ctx.trip_title, "mood:", ctx.dominant_mood);

      // ── Route visualization (deterministic) ──
      const routeViz = _routeVisualize(tripData.gpxTrack, ctx.key_locations);

      // ── Agent 2: Cultural Enrichment (moved BEFORE photos to inform classification) ──
      status("Agent 2/8: Cultural research...");
      const cultural = await _culturalEnrich(ctx, status);
      console.log("[SVN] Cultural enrichment done, locations:", cultural.locations?.length);

      // ── Agent 3: Classify Photos (replaces _curatePhotos) ──
      status("Agent 3/8: Classifying photos by design role...");
      const photoResult = await _classifyPhotos(photoBase64Array, ctx, cultural, routeViz, status);
      console.log("[SVN] Photos classified:", photoResult.topPhotos.length, "top, categories:", Object.entries(photoResult.byCategory).map(([k, v]) => k + ":" + v.length).join(" "));

      // ── Agent 4: Multi-Element Extraction (1 per category, not 1 total) ──
      status("Agent 4/8: Extracting visual elements per category...");
      const elementSets = await _extractMultiElements(photoResult, ctx, cultural, status);

      // ── Agent 5: Assign Heroes per product (deterministic, 0 API calls) ──
      const heroMap = _assignHeroes(photoResult, elementSets, products);

      // ── Agent 6: Journey Moments ──
      status("Agent 6/8: Building design briefs...");
      const moments = await _journeyMoments(photoResult, ctx, cultural, status);
      console.log("[SVN] Moments:", moments.length);

      // ── Agent 7: Design System ──
      status("Agent 7/8: Creating design system...");
      const ds = await _designSystem(ctx, photoResult, cultural, moments, routeViz, status);
      console.log("[SVN] Design system:", ds.visual_approach, ds.primary_motif, ds.color_system?.primary);

      // ── Agent 8: Generate Images ──
      status("Agent 8/8: Generating souvenir images...");
      const results = [];

      for (let pIdx = 0; pIdx < products.length; pIdx++) {
        const prodType = products[pIdx];
        const fusionStrategies = FUSIONS[prodType] || {};
        const stratEntries = Object.entries(fusionStrategies);
        const selectedStrats = stratEntries.slice(0, numVariants);
        const assignment = heroMap[prodType];

        // Generate each variant — same hero for all variants of this product.
        // Variant diversity comes from the STRATEGY (fusion style), not hero rotation.
        for (let vi = 0; vi < selectedStrats.length; vi++) {
          const [stratName, stratDir] = selectedStrats[vi];
          const heroName = assignment?.photo?.loc || "composite";
          status(`Generating ${prodType} variant ${vi+1}/${selectedStrats.length}: ${stratName} (hero: ${heroName} [${assignment?.category}])`);
          try {
            let img = await _genImage(tripData, ctx, photoResult, cultural, ds, moments, prodType, stratName, stratDir, vi + 1, assignment);
            if (img && img.base64) {
              // Quality Judge
              status(`Judging ${prodType} ${stratName}...`);
              let judge = await _judgeImage(img.base64, img.mime, prodType, stratName);
              const scoreStr = "Quality: " + judge.score + "/100" + (judge.flag_penalty ? " (\u2212" + judge.flag_penalty + " flags)" : "");
              console.log("[SVN]", scoreStr, "reason:", judge.reason, "flags:", judge.flags, "issues:", judge.issues);

              // Retry threshold: 65/100 final score. Keep whichever version scores higher.
              if (judge.score < 65) {
                status(`${scoreStr} (low) \u2014 regenerating ${prodType} ${stratName}...`);
                console.warn("[SVN] Rejected:", prodType, stratName, judge.reason);
                try {
                  // Build structured feedback: per-dimension weak points + flags + specific issues
                  const d = judge.details || {};
                  const weak = [];
                  if ((d.composition || 0) < 12) weak.push("composition was " + (d.composition || 0) + "/20 \u2014 improve layout balance, establish a clear focal point, guide the eye");
                  if ((d.style_coherence || 0) < 12) weak.push("style_coherence was " + (d.style_coherence || 0) + "/20 \u2014 unify rendering style across ALL elements (this is the #1 failure: do not mix photo + illustration + 3D). REMEMBER: unless the strategy is editorial_photo, DO NOT put raw photographs in the output \u2014 re-render every scene as illustration/painting/print");
                  if ((d.stacking_quality || 0) < 12) weak.push("stacking_quality was " + (d.stacking_quality || 0) + "/20 \u2014 use natural transitions between overlapping elements (gradient/blend/shared palette), not harsh rectangular cuts; keep boundary treatment consistent");
                  if ((d.product_fit || 0) < 12) weak.push("product_fit was " + (d.product_fit || 0) + "/20 \u2014 make it look more convincingly like a real " + prodType);
                  if ((d.text_typography || 0) < 12) weak.push("text_typography was " + (d.text_typography || 0) + "/20 \u2014 the headline must be CRAFTED (custom hand-lettering, vintage display type, decorative letterforms integrated with the artwork), NOT a default system font dropped on top. Also fix legibility/contrast/placement on a protected zone");

                  const flagStr = (judge.flags || []).length
                    ? "\nFailure flags triggered (MUST fix):\n- " + judge.flags.join("\n- ")
                    : "";
                  const issueStr = (judge.issues || []).length
                    ? "\nSpecific issues to fix:\n- " + judge.issues.join("\n- ")
                    : "";
                  const weakStr = weak.length
                    ? "\nWeak dimensions:\n- " + weak.join("\n- ")
                    : "";

                  const retryDir = stratDir +
                    "\n\n=== CRITICAL QUALITY FEEDBACK FROM JUDGE ===\n" +
                    "Previous attempt scored " + judge.score + "/100 (weighted " + judge.weighted_score + " \u2212 " + judge.flag_penalty + " flag penalty).\n" +
                    "Judge summary: " + judge.reason +
                    flagStr + issueStr + weakStr +
                    "\n\nGenerate a NEW version that specifically addresses these problems. Do NOT repeat the same mistakes. Focus especially on unified style across all elements.";

                  const retryImg = await _genImage(tripData, ctx, photoResult, cultural, ds, moments, prodType, stratName, retryDir, vi + 1, assignment);
                  if (retryImg && retryImg.base64) {
                    const judge2 = await _judgeImage(retryImg.base64, retryImg.mime, prodType, stratName);
                    status(`Retry quality: ${judge2.score}/100`);
                    // Keep whichever scored higher
                    if (judge2.score > judge.score) {
                      img = retryImg;
                      judge = judge2;
                      console.log("[SVN] Retry improved:", prodType, stratName, judge2.score);
                    } else {
                      console.log("[SVN] Retry did not improve, keeping original:", judge.score, "vs", judge2.score);
                    }
                  }
                } catch(re) { console.warn("[SVN] Retry failed:", re.message); }
              } else {
                status(scoreStr);
              }

              if (img && img.base64) {
                results.push({
                  type: prodType,
                  strategy: stratName,
                  base64: img.base64,
                  mime: img.mime || "image/png",
                  score: judge.score,
                  weighted_score: judge.weighted_score,
                  flags: judge.flags,
                  details: judge.details
                });
                console.log("[SVN] Accepted", prodType, stratName, "score:", judge.score);
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
        if (pIdx < products.length - 1) {
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
