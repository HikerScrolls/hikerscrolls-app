# User Profile + Cloud-Synced Trips — Changes & Testing Guide

**Feature:** Signed-in users can manage their trips across devices. Trips are persisted in Supabase (Postgres + private Storage bucket) with row-level security so every user only sees their own data. Anonymous users retain the existing localStorage flow (progressive enhancement).

**Related docs:**
- Plan: [profile-cloud-trips-implementation-plan.md](./profile-cloud-trips-implementation-plan.md)
- Dev log: [profile-cloud-trips-devlog.md](./profile-cloud-trips-devlog.md)

---

## 1. Purpose

Before this change, trips lived only in `localStorage` + `IndexedDB`, pinned to one browser on one device. Signing in gave identity but no data persistence.

This feature closes that gap:

- **Cloud storage for trips** — a Postgres row per trip, photos in Supabase Storage.
- **Per-user isolation** — RLS policies mean no user can read or write anyone else's data, enforced server-side.
- **Profile surface** — dedicated modal for identity + bulk trip management (rename, delete, export, open).
- **Migration path** — one-click "Sync to cloud" for any existing local trip.
- **Zero regression for anonymous users** — the wizard, sidebar, and trip viewer continue to work exactly as before without an account.

---

## 2. What changed

### 2.1 New files

| File | Purpose |
|---|---|
| `supabase/migrations/20260416000001_trips.sql` | Creates `public.trips` table, RLS policies (SELECT/INSERT/UPDATE/DELETE gated on `auth.uid() = user_id`), an `updated_at` trigger, the private `trip-photos` Storage bucket, and storage policies scoped to the `{user_id}/…` path prefix. |
| `shared/trips-repo.js` | Client-side Supabase wrapper exposed as `window.HikerTripsRepo`. Provides `listTrips`, `getTrip`, `saveTrip`, `renameTrip`, `deleteTrip`, `uploadPhoto`, `getPhotoSignedUrl`, `resolvePhotoUrls`, `syncLocalTripToCloud`. Translates between the DB snake_case row and the in-app camelCase trip shape. Caches signed URLs for 1 hour. |
| `shared/profile.js` | Profile modal exposed as `window.HikerProfile.show()`. Renders identity block (avatar, email, sign-out) + cloud trip list with Open / Rename / Export / Delete actions per row. |
| `shared/profile.css` | Styles for the Profile modal. |
| `docs/profile-cloud-trips-implementation-plan.md` | Feature plan. |
| `docs/profile-cloud-trips-devlog.md` | Running log of concrete changes. |

### 2.2 Modified files

| File | Change | Why |
|---|---|---|
| `shared/auth.js` | Added `HikerAuth.getClient()`; added a "Profile" item to the auth dropdown. | Other modules need the live Supabase client; the dropdown is the canonical entry point to the Profile UI. |
| `demo/index.html` | Loads `shared/trips-repo.js`, `shared/profile.js`, `shared/profile.css`. | So the demo app can read/write cloud trips and open the Profile modal. |
| `souvenir/index.html` | Same script/css additions. | So the Profile dropdown item works from the studio. |
| `index.html` (landing) | Same script/css additions. | So the Profile dropdown item works from the landing page. |
| `demo/app.js` | See 2.3 for the substantive edits. | Merges cloud trips into the sidebar, enables sync + cloud-first creation, reacts to auth state changes. |

### 2.3 `demo/app.js` edits in detail

| Location | Change | Purpose |
|---|---|---|
| `loadTripIndex()` | Now fetches cloud trips via `HikerTripsRepo.listTrips()` when signed in and merges them with local + server demo trips. Cloud trips are tagged `_isCloud: true`. | Single source of truth for the sidebar list regardless of where the data lives. |
| `openTrip()` | Detects cloud trips in `tripsData`, refetches the latest row, deep-clones it, and resolves any `supabase://` photo URLs to signed URLs via `HikerTripsRepo.resolvePhotoUrls()`. | Always opens fresh data and never mutates the cached list. Keeps the three URL schemes (`idb://`, `blob:`, `supabase://`) interoperable. |
| `renderTripList()` | Adds Cloud/Local badges, routes the delete button to cloud when the card is cloud-owned, and adds a "Sync" button on local cards when signed in. | Visible provenance for each trip and a one-click path to promote a local trip. |
| Creation wizard `finishWizard()` | When signed in, uploads photos to Storage and inserts the trip row directly into `trips` (via `syncLocalTripToCloud`). Falls back to localStorage on failure or when signed out. | New trips land in the cloud by default for authenticated users without requiring a separate "Save to cloud" action. |
| Init (`DOMContentLoaded`) | Subscribes to `HikerAuth.onAuthStateChange`; reloads the sidebar when the effective user id changes. Also exposes `window.openTrip` and `window.reloadTripList`. | Sidebar reflects sign-in/sign-out immediately. The Profile modal calls these globals to trigger navigation and refresh. |

### 2.4 Key design decisions

- **Client-direct Supabase, no new API proxy.** RLS is the authoritative boundary; a Node proxy would duplicate auth logic already enforced in Postgres.
- **JSONB for `gpx_track` and `waypoints`.** Keeps the v5 client schema flexible; splitting into child tables is deferrable.
- **Photo URL scheme stays string-prefixed.** `idb://<id>` for local, `supabase://<path>` for cloud, resolved at render time. Lets a trip mix sources during migration.
- **Private bucket + signed URLs.** Prevents enumeration even if a user guesses another user's id; 1h TTL matches the open-then-read flow.

---

## 3. How to test

### 3.1 Setup (one-time)

1. **Apply the migration.** From repo root, run `npx supabase db push`, or copy [20260416000001_trips.sql](../supabase/migrations/20260416000001_trips.sql) into the Supabase SQL Editor on the linked project and execute it.
2. **Verify the schema.** In the Supabase dashboard:
   - **Database → Tables →** `public.trips` exists with the expected columns.
   - **Database → Policies →** four policies on `public.trips` and four on `storage.objects` scoped to `trip-photos`.
   - **Storage → Buckets →** `trip-photos` exists and is marked **Private**.
3. **Start the dev server.** `vercel dev`, then visit `http://localhost:3000/demo/`.

### 3.2 Scenario 1 — Anonymous regression (must still work)

**Purpose:** Confirm the feature does not break the unauthenticated flow.

1. Open the demo **without** signing in.
2. Create a trip via the wizard with a GPX + one or two photos.
3. Expected: the trip saves to localStorage, the sidebar lists it, the viewer renders it, photos load from IndexedDB. No cloud/local badge is shown (badges only appear when signed in).

### 3.3 Scenario 2 — Profile modal opens

**Purpose:** Confirm wiring between auth dropdown, Profile module, and Supabase.

1. Sign in (email or SSO).
2. Click the avatar → **Profile**.
3. Expected: modal shows your email, "Member since …", and "No cloud-synced trips yet." (assuming this is a fresh account).
4. Close with Esc, overlay click, and ×. All three should dismiss the modal.

### 3.4 Scenario 3 — Cloud-first create

**Purpose:** End-to-end proof that a new trip lands in Postgres + Storage.

1. Signed in, run the creation wizard with GPX + a few photos.
2. Expected behaviour:
   - Sidebar card shows a green **Cloud** badge.
   - **Supabase → Storage → `trip-photos`** contains `{your_uid}/{trip_id}/…jpg` objects.
   - **Supabase → Table Editor → `trips`** shows a row with your `user_id`, populated `waypoints`, `gpx_track`, `stats`.
   - Opening the trip loads photos via `*.supabase.co/storage/.../sign/...` (check DevTools → Network).

### 3.5 Scenario 4 — Cross-device visibility

**Purpose:** The core promise — same account, different browser, same data.

1. In a second browser profile or Incognito window, sign in with the same account.
2. Expected: the trip from Scenario 3 appears in the sidebar with a **Cloud** badge and opens correctly.

### 3.6 Scenario 5 — Local → cloud migration

**Purpose:** Users with existing local trips can move them to the cloud.

1. Sign out. Create a new trip (saves locally).
2. Sign back in.
3. Hover the local trip card. A green **Sync** button appears bottom-right.
4. Click it. Expected:
   - Button flips to "Syncing…", then the card's badge changes from **Local** to **Cloud**.
   - New row in `trips`, new files in Storage.
   - The trip is removed from `localStorage` (inspect under `hikerscrolls_local_trips`).

### 3.7 Scenario 6 — Manage from Profile

**Purpose:** Rename, delete, and export work end-to-end through the Profile modal.

1. Open Profile.
2. **Rename** a trip. Sidebar updates after the modal refresh.
3. **Export** a trip. A `.json` file downloads; contents reflect the trip shape.
4. **Delete** a trip. Confirmation required. Row and Storage files are removed; sidebar refreshes.

### 3.7b Scenario 6b — Create / open a trip from Profile

**Purpose:** Verify the "+ New Trip" button and Open-from-anywhere flow.

1. On the landing page (`/`), sign in, open Profile → click **+ New Trip**. Expected: browser navigates to `/demo/?new=1`, the URL is immediately rewritten to `/demo/`, and the creation wizard appears automatically.
2. On `/demo/` itself, open Profile → click **+ New Trip**. Expected: modal closes and the wizard opens in-place (no navigation round-trip).
3. From the souvenir studio, open Profile → click **Open** on an existing cloud trip. Expected: browser navigates to `/demo/?trip=<id>`, URL is rewritten to `/demo/`, and the trip opens.
4. Paste `/demo/?trip=<valid-cloud-trip-id>` directly into the address bar while signed in. Expected: the trip opens even though it wasn't pre-loaded when the page started.

### 3.8 Scenario 7 — RLS sanity check (optional but recommended)

**Purpose:** Confirm the server actually blocks cross-user reads.

1. In the Supabase Table Editor, manually change `user_id` on one of your trips to a different uid (or create a trip as user A, then sign in as user B).
2. Expected: that trip disappears from user A's sidebar on next reload, and never appears for anyone except the owner. If it leaks, the RLS policy is wrong — re-check step 2 of setup.

### 3.9 What to watch in DevTools

- **Network** — `POST .../trips`, `PATCH .../trips`, `DELETE .../trips?id=eq.…`, `POST .../storage/.../object/...`, `POST .../storage/.../sign/...`.
- **Console** — any `[trips-repo]` warnings are non-fatal but worth investigating.
- **Application → IndexedDB** — `hikerscrolls-photos` should still hold buffers for any pre-sync local trips.
- **Application → localStorage** — `hikerscrolls_local_trips` shrinks as trips are synced.

### 3.10 Common failure modes

| Symptom | Likely cause |
|---|---|
| Creation wizard alerts "Cloud save failed" | Migration not applied → `trips` table missing. Re-run step 1 of setup. |
| Photo uploads return 403 | Storage policy path mismatch. Confirm bucket name is exactly `trip-photos` and the policy uses `(storage.foldername(name))[1] = auth.uid()::text`. |
| Profile modal "Cloud sync module not loaded" | `shared/trips-repo.js` missing from the entry point's HTML. Confirm it's in the `<script>` list. |
| Sidebar doesn't refresh on sign-in | `HikerAuth.onAuthStateChange` subscription didn't run. Confirm `app.js` loaded and no earlier JS error aborted init. |
| Photos 403 after ~1 hour | Signed URL expired. Reload the trip; Phase 3 will add automatic refresh. |

---

## 4. Deferred (Phase 3)

Documented in the dev log, not required for the feature to be useful:

- Automatic signed-URL refresh on 403.
- Cover-image signed URL for cloud cards in the sidebar.
- `updated_at` conflict guard on save.
- Playwright smoke test covering sign-in → create → cross-device visibility.
