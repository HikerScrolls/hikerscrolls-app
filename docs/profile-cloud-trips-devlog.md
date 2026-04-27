# User Profile + Cloud-Synced Trips — Dev Log

**Feature:** Profile modal + Supabase-backed trip storage
**Plan:** [profile-cloud-trips-implementation-plan.md](./profile-cloud-trips-implementation-plan.md)

---

## 2026-04-16 — Phase 1 & 2

### Created

- `docs/profile-cloud-trips-implementation-plan.md` — plan doc.
- `docs/profile-cloud-trips-devlog.md` — this file.
- `supabase/migrations/20260416000001_trips.sql` — `public.trips` table, RLS policies (SELECT/INSERT/UPDATE/DELETE each gated on `auth.uid() = user_id`), `updated_at` trigger, `trip-photos` private Storage bucket, and `storage.objects` policies scoped to `{user_id}/…` prefix.
- `shared/trips-repo.js` — Client-side Supabase wrapper exposed as `window.HikerTripsRepo`. Provides `listTrips`, `getTrip`, `saveTrip`, `deleteTrip`, `uploadPhoto`, `getPhotoSignedUrl`, `resolvePhotoUrls`, `syncLocalTripToCloud`. Converts between the DB snake_case shape and the in-app camelCase trip shape.
- `shared/profile.js` — Profile modal (`window.HikerProfile.show()`). Renders identity block + cloud trip list with actions: open, rename, delete, export JSON. Hooks into `HikerAuth.onAuthStateChange` so opening the modal always reflects the latest session.
- `shared/profile.css` — Styles for the Profile modal, list rows, actions.

### Modified

- `shared/auth.js` — Added `HikerAuth.getClient()` (returns the live Supabase client) and added a "Profile" item to the auth dropdown that calls `HikerProfile.show()`.
- `demo/index.html` — Loads `shared/trips-repo.js`, `shared/profile.js`, and `shared/profile.css`.
- `souvenir/index.html` — Loads the profile modal so the avatar dropdown's "Profile" entry works from the studio.
- `index.html` (landing) — Loads the profile modal for the landing-page avatar dropdown.
- `demo/app.js`:
  - `loadTripIndex()` now merges cloud trips (when signed in) with local + server-demo trips; cloud trips are tagged `_isCloud: true`, local trips continue to be tagged `_isLocal: true`.
  - `openTrip()` resolves `supabase://` photo URLs via `HikerTripsRepo.getPhotoSignedUrl` in addition to existing `idb://` resolution.
  - Creation wizard `onCreate()` writes to cloud when signed in (photos uploaded to Storage, row inserted into `trips`); falls back to localStorage otherwise.
  - Sidebar trip card delete handler routes to cloud delete when the card is cloud-owned.
  - Added "Sync to cloud" action on local-trip cards (shown when signed in) which calls `HikerTripsRepo.syncLocalTripToCloud`.
  - Subscribed to `HikerAuth.onAuthStateChange` so the sidebar refreshes when the user signs in/out.

### Decisions

- **Client-direct Supabase, no new API proxy.** RLS is the authoritative boundary; adding a Node layer would duplicate `auth.js` + `api/_lib/auth.js` without improving security.
- **JSONB for `gpx_track` and `waypoints`.** Keeps the client schema (v5) flexible; can be split later if payload grows.
- **Photo URL scheme kept string-prefixed.** `idb://` stays for local-only trips; new prefix `supabase://<path>` is resolved to signed URLs at render time.
- **Signed URLs over public bucket.** Private + per-user prefix + signed URLs guards photos against enumeration; 1h TTL is fine for the open-then-read flow.

### Verification

- `node --check` on `shared/auth.js`, `shared/trips-repo.js`, `shared/profile.js`, `demo/app.js` — all parse cleanly.
- Progressive enhancement preserved: if `HikerTripsRepo` is missing or the user is anonymous, `loadTripIndex()` returns `[local, serverDemo]` and the wizard saves to `localStorage` — unchanged behaviour for signed-out users.

### To run

1. Apply migration: from repo root, `supabase db push` (or paste `supabase/migrations/20260416000001_trips.sql` into the Supabase SQL editor for the linked project).
2. Verify Storage bucket `trip-photos` exists and is marked private.
3. `vercel dev` to run locally; sign in, create a trip, confirm it shows up on a different browser profile when signed in with the same account.

### Deferred

- Signed-URL refresh on 403 (Phase 3).
- Optimistic update conflict handling via `updated_at` (Phase 3).
- Cover-image signed URL for sidebar cards on cloud trips (Phase 3).
- Playwright smoke test for round-trip sign-in / trip visibility (Phase 3).

---

## 2026-04-17 — Follow-up: entry points for create / open

User feedback: from the landing page and the souvenir studio there was no direct path to "create a new trip" or "open an existing trip" — users had to navigate to `/demo/` and use the sidebar. Rather than adding a nav-bar button to every page, concentrate the entry points in the Profile modal (which is already the trip-management surface), and reach `/demo/` via deep-link query params so the flow works from anywhere.

### Modified

- `shared/profile.js`:
  - Added a **+ New Trip** primary button in the "My Trips" section header. On `/demo/` it calls `window.showCreationWizard()` directly; elsewhere it navigates to `/demo/?new=1`.
- `shared/profile.css`:
  - New `.hk-profile-section-header` flex row so the title + button align.
  - Tightened `.hk-profile-btn.primary` padding so it fits beside the section title.
- `demo/app.js`:
  - Exposed `window.showCreationWizard`.
  - Added `_consumeQueryParam(name)` helper that reads and strips a query param via `history.replaceState` so refreshes don't re-trigger.
  - On init, after `tripsData` is loaded, read `?new=1` → open wizard; read `?trip=<id>` → `openTrip(id)`.
  - Hardened `openTrip()`: if the id is a UUID and isn't in the cached list or local trips, fall back to `HikerTripsRepo.getTrip(id)` before attempting the demo-trip fetch. Handles the case where a deep link opens before auth hydration has finished populating the cached cloud list.

### Decisions

- **Put CTAs in Profile, not the nav bar.** Keeps the management flow coherent; easy to promote to nav later if users report discoverability issues.
- **Use query params, not hash fragments.** `?new=1` / `?trip=<id>` are trivially consumable server-side too if we ever move to SSR; they're also strip-on-consume so the URL stays clean after handling.

---

## 2026-04-17 — Bugfix: UUID id for cloud sync

Reported by user: syncing a local trip to the cloud failed with `invalid input syntax for type uuid: "trip-1776464467868"`. The legacy `finishWizard()` minted ids as `"trip-" + Date.now()`, but `trips.id` is a `uuid` column.

### Modified

- `shared/trips-repo.js`:
  - Added `_isUuid(id)` + `_newUuid()` (uses `crypto.randomUUID()`, with an RFC 4122 v4 fallback).
  - `syncLocalTripToCloud()` now rewrites the trip id to a fresh UUID if the incoming id isn't UUID-shaped; storage paths and the row pk both use the new id.
  - Exposed `HikerTripsRepo.newId()` and `HikerTripsRepo.isUuid()` for callers that want to generate UUIDs directly.
- `demo/app.js`:
  - `finishWizard()` now mints trip ids via `HikerTripsRepo.newId()` (falls back to `crypto.randomUUID()` or the legacy format only if neither is available). New trips created locally are therefore sync-compatible without id remapping.

### Decisions

- **Remap ids on sync instead of failing hard.** Existing local trips already on disk use the old `"trip-…"` format — we can't force users to re-create them. The remap happens only when we actually upload, and the new id is wired through both the row pk and the Storage path prefix in the same call.

---

## 2026-04-17 — Edit modal + Archive / Unarchive

Added trip editing (metadata + per-waypoint photo CRUD, waypoints themselves stay immutable) and archive/restore. Waypoints, sections, and GPX are intentionally read-only for now — see the plan doc for the scope discussion with the user.

### Created

- `supabase/migrations/20260417000001_trips_archived_at.sql` — adds nullable `archived_at timestamptz` column and a composite index `(user_id, archived_at nulls first, updated_at desc)`. Non-null means archived.

### Modified

- `shared/trips-repo.js`:
  - `_rowToTrip` / `_tripToRow` thread `archived_at ↔ archivedAt`.
  - New `archiveTrip(id)`, `unarchiveTrip(id)`, `removePhotos(paths)` methods.
  - Public API extended with those plus `removePhotos` for the edit-save diff path.
- `shared/profile.js`:
  - Row renderer takes a `handlers` object (Open / Edit / Export / Archive / Unarchive / Delete). Active rows show Open + Edit + Export + Archive + Delete; archived rows show Unarchive + Delete.
  - Body now has two sections: "My Trips" (active) and "Archived" (hidden when empty).
  - Edit action opens `window.editTrip(id)` in-place or navigates to `/demo/?edit=<id>` otherwise.
- `demo/app.js`:
  - New `showEditModal(tripId)` — loads the canonical trip (via `HikerTripsRepo.getTrip` for cloud, `getLocalTrips()` for local) so imageUrls stay in their canonical `supabase://` / `idb://` form. Form edits `name / region / date / endDate / description / template / mapStyle`. Photo grid per waypoint with × remove and "+ Add" input. Staged additions hold an ArrayBuffer + blob URL until Save.
  - Save pipeline: upload staged photos (`supabase://` or `idb://`) → delete removed photos from Storage / IDB → persist the trip row via `saveTrip` or `saveLocalTrip`.
  - `_activeTrips()` helper filters archived trips out of the sidebar and global map.
  - Trip card hover now exposes three stacked buttons: Edit (pencil), Archive (□), Delete (×). Archive writes `archivedAt` to the cloud row or the local trip object.
  - Deep-link: `?edit=<id>` triggers the edit modal on init. `window.editTrip` exposed for cross-module callers.

### Decisions

- **Edit modal lives in `demo/app.js`, not `shared/`.** It needs `compressPhoto`, `getPhotoBlobUrl`, `savePhotoToIDB`, `deletePhotoFromIDB`, `saveLocalTrip` — all local helpers. Deep-link (`?edit=<id>`) makes it reachable from `landing` / `souvenir` without moving code.
- **Waypoints stay read-only.** User explicitly accepted this scope to avoid the complexity of rebuilding wizard state + managing section reference integrity + GPX replacement semantics.
- **Canonical photo URLs inside the editor.** `HikerTripsRepo.getTrip` returns `supabase://` paths (doesn't mutate with signed URLs). Thumbnails resolve lazily via `thumbUrlFor`. This makes diff computation on save unambiguous: every photo either has `_staged=true` (new) or is tracked in `removedPhotos` if the user removed it.
- **Archive is soft delete.** Rows stay in the DB; Storage files stay too. Unarchive is a one-column update — cheap and reversible. Permanent removal still goes through Delete.
- **Local trip archive uses the same `archivedAt` key.** Same filter logic works for both local and cloud trips.

---

## 2026-04-18 — Storage hardening: file size + MIME type

Follow-up from a security review of the Storage policies. Cross-user isolation was already fine (private bucket + RLS on `(storage.foldername(name))[1] = auth.uid()`), but the `trip-photos` bucket had no server-side `file_size_limit` or `allowed_mime_types` — a client that bypassed `compressPhoto` could upload arbitrary binaries into its own prefix.

### Created

- `supabase/migrations/20260418000001_trip_photos_limits.sql` — updates the existing bucket with `file_size_limit = 10 MiB` and `allowed_mime_types = ['image/jpeg', 'image/png', 'image/webp']`.

### Decisions

- **10 MiB cap.** A 1200px JPEG at 0.8 quality is well under 1 MiB, but an unmodified phone-camera original can be 4–5 MiB. 10 MiB leaves headroom without letting a bad actor burn through their own quota too quickly.
- **JPEG + PNG + WEBP.** The existing `compressPhoto` always outputs JPEG, but PNG (screenshots) and WEBP (modern captures) are reasonable image formats to allow without broadening attack surface. Any other MIME gets rejected at the Storage layer.
- **Defence-in-depth, not new isolation.** The cross-user policies didn't change — this is purely a tighter perimeter for what a user can store under *their own* prefix. The attacker model "malicious user fills their own folder with arbitrary blobs" is now blocked at the bucket level even with a client-side bypass.
