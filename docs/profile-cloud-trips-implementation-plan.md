# User Profile + Cloud-Synced Trips — Implementation Plan

**Date:** 2026-04-16
**Status:** In Progress
**Depends on:** `docs/auth-implementation-plan.md` (Supabase auth already shipped)

## Overview

Add a **user profile** feature where signed-in users can manage their trips across devices. Trips are persisted in Supabase (Postgres + Storage) with RLS so each user only sees their own data. Unauthenticated users continue to work fully against localStorage (progressive enhancement). Existing local trips can be migrated to the cloud on demand.

## Goals

- Signed-in users see their trips on any device.
- A dedicated **Profile** modal surfaces identity + trip management (rename, delete, export, open).
- Migration path: one-click "Sync to cloud" for any local trip.
- New trips save to the cloud when signed in; fall back to local otherwise.
- Photos (currently IndexedDB-only) are mirrored to Supabase Storage for cloud trips.

## Non-goals (defer)

- Real-time sync / multi-device conflict resolution.
- Sharing trips with other users.
- Offline-first sync engine (simple read-on-open + write-on-save is enough for v1).

## Architecture

### Data model

`public.trips` — one row per trip, JSONB for the variable shape (matches v5 client schema).

| column | type | notes |
|---|---|---|
| `id` | `uuid` (pk) | `gen_random_uuid()` |
| `user_id` | `uuid` | FK → `auth.users.id`, `on delete cascade` |
| `name` | `text` | |
| `region` | `text` | nullable |
| `trip_date` | `date` | nullable |
| `end_date` | `date` | nullable |
| `description` | `text` | nullable |
| `template` | `text` | `scrollytelling` \| `scrapbook` \| `illustrated` |
| `map_style` | `text` | |
| `stats` | `jsonb` | `{ distanceKm, elevationGainM, elevationLossM }` |
| `gpx_track` | `jsonb` | array of `{ lat, lng, ele?, time? }` |
| `waypoints` | `jsonb` | full waypoint array with photo refs |
| `cover_photo_id` | `text` | nullable — id of the cover photo (in Storage) |
| `version` | `int` | default `5` |
| `created_at` | `timestamptz` | default `now()` |
| `updated_at` | `timestamptz` | default `now()`, trigger on update |

Index: `(user_id, updated_at desc)`.

### Row-level security

- `enable row level security`
- Four policies (`select`, `insert`, `update`, `delete`) all gated on `auth.uid() = user_id`.

### Photo storage

Bucket: `trip-photos` (private).

- Path convention: `{user_id}/{trip_id}/{photo_id}.jpg`
- RLS on `storage.objects`: users can `select`/`insert`/`update`/`delete` only where the first path segment equals `auth.uid()::text`.
- Photos are served via **signed URLs** (1h TTL), resolved on trip open.
- URL scheme in `waypoints[].photos[].imageUrl`:
  - `idb://<id>` — legacy localStorage photo (unchanged)
  - `supabase://<path>` — cloud photo; resolved to a signed URL at render time

### Client module layout

| File | Purpose | New / Modified |
|---|---|---|
| `supabase/migrations/20260416000001_trips.sql` | Table, RLS, storage bucket + policies, trigger | **New** |
| `shared/trips-repo.js` | Supabase-backed trip repo: `listTrips`, `getTrip`, `saveTrip`, `deleteTrip`, `uploadPhoto`, `getPhotoSignedUrl`, `syncLocalToCloud` | **New** |
| `shared/profile.js` | Profile modal UI — identity + trip management actions | **New** |
| `shared/profile.css` | Profile modal styles | **New** |
| `shared/auth.js` | Expose `HikerAuth.getClient()`; add "Profile" dropdown item | **Modified** |
| `demo/app.js` | Merge cloud trips into `loadTripIndex()`; "Sync to cloud" control; cloud-first save on create | **Modified** |
| `demo/index.html` | Load `shared/trips-repo.js`, `shared/profile.js`, `shared/profile.css` | **Modified** |
| `souvenir/index.html` | Load profile + trips-repo (dropdown "Profile" works from studio) | **Modified** |
| `index.html` | Load profile + trips-repo (dropdown "Profile" works from landing) | **Modified** |

### Why client-direct Supabase and not new API endpoints?

Supabase RLS is the authoritative boundary — with the publishable key + the user's JWT, the browser can safely talk to Postgres/Storage directly. Adding a Node proxy would duplicate auth logic already enforced by RLS. `api/_lib/auth.js` remains available for features that need server-side compute (AI proxy, etc.), not for trip CRUD.

## Phases

### Phase 1 — Foundation (this session)

1. `supabase/migrations/20260416000001_trips.sql`: table, RLS, trigger, bucket, storage policies.
2. `shared/trips-repo.js`: client-side repository.
3. `shared/profile.js` + `shared/profile.css`: Profile modal listing cloud trips with rename / delete / open / export.
4. `shared/auth.js`: expose client + add "Profile" dropdown item.
5. Load new scripts in all 3 entry points.

### Phase 2 — Sync & cloud-first writes (this session)

6. `demo/app.js`: merge cloud trips into sidebar list when signed in; show a badge distinguishing cloud vs local vs demo.
7. "Sync to cloud" action on local trips (from sidebar + Profile): upload waypoint photos to Storage → insert row → delete local.
8. When signed in, the creation wizard writes new trips directly to cloud (photos → Storage, row → `trips`). Anonymous users keep writing to localStorage.

### Phase 3 — Polish (follow-up session)

9. Cache signed URLs by photo id with TTL; refresh on 403.
10. Conflict handling (updated_at guards on save).
11. Delete dialog wording + optimistic UI refresh.
12. E2E smoke: sign in → create trip → sign out/in on another browser → trip visible.

## Risks & tradeoffs

- **Payload size**: `gpx_track` can be large (thousands of points). JSONB is fine for most hikes; for very long tracks we may want to split to a child table later.
- **Photo cost**: images count against Storage quota; compression (existing 1200px / 0.8 JPEG) keeps this bounded.
- **Signed URL renewal**: 1h TTL means long sessions need a re-fetch path; handled in Phase 3.
- **Schema drift**: JSONB `waypoints` keeps the client schema flexible but loses column-level constraints. Acceptable for v1.

## Rollout

- Migration is additive — no existing data touched.
- Feature is progressive: unauthenticated flow is unchanged.
- No feature flag needed; the UI only shows cloud controls when `HikerAuth.getUser()` is truthy.

## Dev log

See `docs/profile-cloud-trips-devlog.md`.
