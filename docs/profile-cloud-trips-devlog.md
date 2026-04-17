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
