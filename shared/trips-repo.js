// HikerScrolls — Cloud Trip Repository
// Thin wrapper around Supabase for per-user trip CRUD + photo storage.
// Loaded by all 3 entry points. Exposes global `HikerTripsRepo`.
// Requires `shared/auth.js` (HikerAuth) to be loaded first.

(function () {
  "use strict";

  const BUCKET = "trip-photos";
  const SIGNED_URL_TTL_SEC = 60 * 60; // 1 hour
  const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

  const _signedUrlCache = new Map(); // path → { url, expiresAt }

  function _isUuid(id) { return typeof id === "string" && UUID_RE.test(id); }

  function _newUuid() {
    if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
      return crypto.randomUUID();
    }
    // Fallback (RFC 4122 v4, pseudo-random)
    return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
      const r = (Math.random() * 16) | 0;
      const v = c === "x" ? r : (r & 0x3) | 0x8;
      return v.toString(16);
    });
  }

  function _client() {
    return window.HikerAuth && window.HikerAuth.getClient ? window.HikerAuth.getClient() : null;
  }

  function _user() {
    return window.HikerAuth && window.HikerAuth.getUser ? window.HikerAuth.getUser() : null;
  }

  function _rowToTrip(row) {
    return {
      id: row.id,
      _isCloud: true,
      _isLocal: false,
      version: row.version,
      file: row.id,
      name: row.name,
      region: row.region || "",
      date: row.trip_date || "",
      endDate: row.end_date || "",
      description: row.description || "",
      template: row.template,
      mapStyle: row.map_style,
      stats: row.stats || {},
      gpxTrack: Array.isArray(row.gpx_track) ? row.gpx_track : [],
      waypoints: Array.isArray(row.waypoints) ? row.waypoints : [],
      coverPhotoId: row.cover_photo_id || null,
      createdAt: row.created_at,
      updatedAt: row.updated_at
    };
  }

  function _tripToRow(trip, userId) {
    return {
      id: trip.id,
      user_id: userId,
      name: trip.name || "Untitled Trip",
      region: trip.region || null,
      trip_date: trip.date || null,
      end_date: trip.endDate || null,
      description: trip.description || null,
      template: trip.template || "scrollytelling",
      map_style: trip.mapStyle || "opentopomap",
      stats: trip.stats || {},
      gpx_track: Array.isArray(trip.gpxTrack) ? trip.gpxTrack : [],
      waypoints: Array.isArray(trip.waypoints) ? trip.waypoints : [],
      cover_photo_id: trip.coverPhotoId || null,
      version: trip.version || 5
    };
  }

  // ── Trip CRUD ──────────────────────────────────────────────

  async function listTrips() {
    const supabase = _client();
    const user = _user();
    if (!supabase || !user) return [];
    const { data, error } = await supabase
      .from("trips")
      .select("*")
      .order("updated_at", { ascending: false });
    if (error) {
      console.warn("[trips-repo] listTrips failed:", error.message);
      return [];
    }
    return (data || []).map(_rowToTrip);
  }

  async function getTrip(id) {
    const supabase = _client();
    if (!supabase) return null;
    const { data, error } = await supabase.from("trips").select("*").eq("id", id).maybeSingle();
    if (error) {
      console.warn("[trips-repo] getTrip failed:", error.message);
      return null;
    }
    return data ? _rowToTrip(data) : null;
  }

  async function saveTrip(trip) {
    const supabase = _client();
    const user = _user();
    if (!supabase || !user) throw new Error("Not signed in.");
    const row = _tripToRow(trip, user.id);
    const { data, error } = await supabase.from("trips").upsert(row).select().single();
    if (error) throw new Error(error.message || "Save failed.");
    return _rowToTrip(data);
  }

  async function renameTrip(id, name) {
    const supabase = _client();
    if (!supabase) throw new Error("Not signed in.");
    const { data, error } = await supabase
      .from("trips")
      .update({ name })
      .eq("id", id)
      .select()
      .single();
    if (error) throw new Error(error.message || "Rename failed.");
    return _rowToTrip(data);
  }

  async function deleteTrip(id) {
    const supabase = _client();
    const user = _user();
    if (!supabase || !user) throw new Error("Not signed in.");

    // Best-effort: remove photos under this trip prefix.
    const prefix = `${user.id}/${id}`;
    try {
      const { data: files } = await supabase.storage.from(BUCKET).list(prefix, { limit: 1000 });
      if (files && files.length) {
        const paths = files.map(f => `${prefix}/${f.name}`);
        await supabase.storage.from(BUCKET).remove(paths);
      }
    } catch (e) {
      console.warn("[trips-repo] photo cleanup failed:", e.message || e);
    }

    const { error } = await supabase.from("trips").delete().eq("id", id);
    if (error) throw new Error(error.message || "Delete failed.");
  }

  // ── Photos ─────────────────────────────────────────────────

  function _storagePath(tripId, photoId) {
    const user = _user();
    if (!user) throw new Error("Not signed in.");
    return `${user.id}/${tripId}/${photoId}.jpg`;
  }

  async function uploadPhoto(tripId, photoId, arrayBuffer) {
    const supabase = _client();
    if (!supabase) throw new Error("Not signed in.");
    const path = _storagePath(tripId, photoId);
    const blob = new Blob([arrayBuffer], { type: "image/jpeg" });
    const { error } = await supabase.storage.from(BUCKET).upload(path, blob, {
      contentType: "image/jpeg",
      upsert: true
    });
    if (error) throw new Error(error.message || "Photo upload failed.");
    return path;
  }

  async function getPhotoSignedUrl(path) {
    if (!path) return null;
    const cached = _signedUrlCache.get(path);
    if (cached && cached.expiresAt > Date.now() + 60_000) return cached.url;

    const supabase = _client();
    if (!supabase) return null;
    const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(path, SIGNED_URL_TTL_SEC);
    if (error || !data?.signedUrl) {
      console.warn("[trips-repo] signed url failed:", error?.message);
      return null;
    }
    _signedUrlCache.set(path, {
      url: data.signedUrl,
      expiresAt: Date.now() + SIGNED_URL_TTL_SEC * 1000
    });
    return data.signedUrl;
  }

  function _isSupabaseUrl(url) {
    return typeof url === "string" && url.startsWith("supabase://");
  }

  function _pathFromSupabaseUrl(url) {
    return url.slice("supabase://".length);
  }

  // Resolve `supabase://<path>` imageUrls in a trip to signed URLs (in-place).
  async function resolvePhotoUrls(trip) {
    if (!trip || !Array.isArray(trip.waypoints)) return trip;
    for (const wp of trip.waypoints) {
      for (const ph of (wp.photos || [])) {
        if (_isSupabaseUrl(ph.imageUrl)) {
          const path = _pathFromSupabaseUrl(ph.imageUrl);
          const signed = await getPhotoSignedUrl(path);
          if (signed) ph.imageUrl = signed;
        }
      }
    }
    return trip;
  }

  // ── Local → Cloud migration ────────────────────────────────

  /**
   * Upload a local trip (with idb:// photo refs) to the cloud.
   * Requires access to a `getPhotoBuffer(photoId) → Promise<ArrayBuffer|null>` callback
   * so this module stays decoupled from the demo app's IndexedDB code.
   */
  async function syncLocalTripToCloud(localTrip, getPhotoBuffer) {
    const user = _user();
    if (!user) throw new Error("Not signed in.");
    if (!localTrip || !localTrip.id) throw new Error("Invalid local trip.");

    // Clone so we don't mutate the caller's object.
    const trip = JSON.parse(JSON.stringify(localTrip));
    trip._isLocal = false;
    trip._isCloud = true;

    // `trips.id` is a uuid column — remap legacy ids like `trip-173...`.
    if (!_isUuid(trip.id)) {
      trip.id = _newUuid();
      trip.file = trip.id;
    }

    // Upload every idb:// photo, rewrite imageUrl.
    const tripId = trip.id;
    for (const wp of (trip.waypoints || [])) {
      for (const ph of (wp.photos || [])) {
        const url = ph.imageUrl;
        if (typeof url !== "string" || !url.startsWith("idb://")) continue;
        const photoId = url.slice("idb://".length);
        if (!getPhotoBuffer) continue;
        const buf = await getPhotoBuffer(photoId);
        if (!buf) continue;
        try {
          const path = await uploadPhoto(tripId, photoId, buf);
          ph.imageUrl = `supabase://${path}`;
        } catch (e) {
          console.warn("[trips-repo] photo upload failed for", photoId, e.message || e);
        }
      }
    }

    const saved = await saveTrip(trip);
    return saved;
  }

  // ── Public API ─────────────────────────────────────────────

  window.HikerTripsRepo = {
    listTrips,
    getTrip,
    saveTrip,
    renameTrip,
    deleteTrip,
    uploadPhoto,
    getPhotoSignedUrl,
    resolvePhotoUrls,
    syncLocalTripToCloud,
    newId: _newUuid,
    isUuid: _isUuid
  };
})();
