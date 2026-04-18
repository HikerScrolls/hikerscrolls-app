# Auth Integration — Dev Log

## 2026-04-14

### Session Start
- Created implementation plan: `docs/auth-implementation-plan.md`
- Created dev log: `docs/auth-devlog.md`

### Phase 1: Config + Foundation

**`api/config.js`** — Added `supabaseUrl` and `supabaseAnonKey` fields to the GET response, reading from `process.env.SUPABASE_URL` and `process.env.SUPABASE_PUBLISHABLE_KEY`.

**`shared/auth.js`** (NEW) — Created shared auth module (~310 lines). Exposes global `HikerAuth` object with:
- `init()` — fetches Supabase config from `/api/config`, initializes client, restores session, listens for auth state changes, handles callback query params
- `showAuthModal(initialView)` — renders modal with login/register/forgot-password views
- SSO buttons for Google and Apple via `supabase.auth.signInWithOAuth()`
- `getUser()`, `getSession()`, `getAccessToken()`, `onAuthStateChange(fn)`, `signOut()`
- Auth button rendering: logged out = "Sign In" button; logged in = avatar initial with dropdown (email + sign out)
- Toast notifications for success/error feedback
- Form validation (empty fields, password length, password match)

**`shared/auth.css`** (NEW) — Auth modal styles (~280 lines). Overlay, modal card, tabs, SSO buttons, divider, form fields, submit button, error/success messages, avatar dropdown, toast notifications, spinner, responsive (mobile bottom sheet).

### Phase 2: HTML Integration

**`index.html`** — Added:
- `<link rel="stylesheet" href="shared/auth.css" />` in head
- `<span id="auth-btn"></span>` in `.nav-links` before the "Try Demo" CTA
- Supabase CDN script + `shared/auth.js` + `HikerAuth.init()` before `</body>`

**`demo/index.html`** — Added:
- `<link rel="stylesheet" href="../shared/auth.css">` in head
- `<span id="auth-btn"></span>` in `.sidebar-header-actions` before lang toggle
- Supabase CDN + `shared/auth.js` before existing scripts, `HikerAuth.init()` after `app.js`

**`souvenir/index.html`** — Added:
- `<link rel="stylesheet" href="../shared/auth.css">` in head
- `<span id="auth-btn"></span>` in `.svn-nav-links` before settings button
- Supabase CDN + `shared/auth.js` before existing scripts, `HikerAuth.init()` after `souvenir-app.js`

### Phase 3: Server-Side Auth

**`api/auth/callback.js`** (NEW) — Vercel serverless function handling Supabase email confirmation + OAuth redirects. Receives `code` query param, exchanges it for a session using the service role key, redirects to `/demo/?auth_confirmed=true` (or with `auth_error` on failure).

**`api/_lib/auth.js`** (NEW) — Server-side JWT verification utility. Exports `verifyAuth(req)` which extracts `Authorization: Bearer <token>` header, validates via `supabase.auth.getUser(token)`, returns user or null. Uses `SUPABASE_SECRET_KEY` (never exposed to client).

**`api/ai.js`** — Two changes:
1. Added `Authorization` to `Access-Control-Allow-Headers` CORS header
2. Added optional auth token verification block at top of handler — extracts user from Bearer token if present, stores in `authUser` variable (not yet used to gate anything — progressive enhancement)

### Phase 4: Token Passing

**`demo/app.js`** (line ~1710) — Modified `callAI()` to build headers object dynamically. If `HikerAuth.getAccessToken()` returns a token, adds `Authorization: Bearer <token>` header. Guarded by `typeof HikerAuth !== "undefined"` check for graceful degradation.

**`souvenir/souvenir-app.js`** (line ~20) — Same change as demo app's `callAI()`.

### Phase 5: Dependencies

**`package.json`** — Added `"dependencies": { "@supabase/supabase-js": "^2" }` for server-side usage in `api/_lib/auth.js` and `api/auth/callback.js`. Ran `npm install` — 13 packages added, 0 vulnerabilities.

---

### Environment Variables Required (set in Vercel dashboard)

| Variable | Purpose |
|----------|---------|
| `SUPABASE_URL` | Supabase project URL |
| `SUPABASE_PUBLISHABLE_KEY` | Public anon key (exposed to client via `/api/config`) |
| `SUPABASE_SECRET_KEY` | Private service role key (server-side only) |

### Supabase Dashboard Configuration Needed

1. Auth > URL Configuration: Set site URL + add redirect URL for `/api/auth/callback`
2. Auth > Providers: Enable Google OAuth + Apple OAuth
3. Auth > Settings: Enable email confirmations

### Key Migration: anon/service_role → publishable/secret

Supabase is deprecating legacy `anon` and `service_role` keys in favor of new `publishable` (`sb_publishable_xxx`) and `secret` keys. Updated all references:

**Files changed:**
- `api/config.js` — `supabaseAnonKey` → `supabasePublishableKey`
- `shared/auth.js` — reads `config.supabasePublishableKey` instead of `config.supabaseAnonKey`
- `api/_lib/auth.js` — `SUPABASE_SERVICE_ROLE_KEY` → `SUPABASE_SECRET_KEY`
- `api/auth/callback.js` — `SUPABASE_SERVICE_ROLE_KEY` → `SUPABASE_SECRET_KEY`
- `.env.local` — updated variable names
- `CLAUDE.md` — updated env var references
- `docs/auth-implementation-plan.md` — updated all references
- `docs/auth-devlog.md` — updated all references
