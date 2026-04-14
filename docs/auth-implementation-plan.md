# Supabase Authentication — Implementation Plan

**Date:** 2026-04-14
**Status:** In Progress

## Overview

Add user authentication (register, login, logout, password reset, email verification, Google SSO, Apple SSO) to HikerScrolls using Supabase Auth. The auth module is a shared vanilla JS file loaded by all 3 entry points. All existing features remain fully functional for unauthenticated users (progressive enhancement).

## Features

- Email + password registration with email verification
- Email + password login
- Logout
- Password reset (forgot password flow)
- Google OAuth SSO
- Apple OAuth SSO
- Auth state shared across all 3 entry points (same origin localStorage)
- Server-side JWT verification for future protected endpoints

## Architecture

### New Files

| File | Purpose | Est. Lines |
|------|---------|------------|
| `shared/auth.js` | Shared auth module — Supabase client init, auth modal UI, state management | ~300 |
| `shared/auth.css` | Auth modal styles | ~200 |
| `api/auth/callback.js` | Server-side email confirmation + OAuth redirect handler | ~50 |
| `api/_lib/auth.js` | Server-side JWT verification utility | ~30 |

### Modified Files

| File | Change |
|------|--------|
| `api/config.js` | Add `supabaseUrl` and `supabaseAnonKey` to JSON response |
| `api/ai.js` | Add optional `Authorization` header verification + CORS for auth header |
| `index.html` | Load Supabase CDN + `shared/auth.js` + `shared/auth.css`, add auth button in `.nav-links` |
| `demo/index.html` | Load Supabase CDN + `shared/auth.js` + `shared/auth.css`, add auth button in `.sidebar-header-actions` |
| `souvenir/index.html` | Load Supabase CDN + `shared/auth.js` + `shared/auth.css`, add auth button in `.svn-nav-links` |
| `demo/app.js` | Pass `Authorization: Bearer <token>` in `callAI` fetch headers when session exists |
| `souvenir/souvenir-app.js` | Same — pass auth token in `callAI` fetch headers |
| `package.json` | Add `@supabase/supabase-js` as server dependency |
| `vercel.json` | Add function config for `api/auth/callback.js` if needed |

### New Environment Variables

| Variable | Exposure | Purpose |
|----------|----------|---------|
| `SUPABASE_URL` | Client (via `/api/config`) | Supabase project URL |
| `SUPABASE_PUBLISHABLE_KEY` | Client (via `/api/config`) | Public publishable key (safe — RLS enforces security) |
| `SUPABASE_SECRET_KEY` | Server only | Private key for JWT verification + token exchange |

## Design Decisions

### Modal, not a dedicated page
The app has no router. A modal matches the existing settings modal pattern (e.g. `demo/app.js:1733`, `souvenir/souvenir-app.js:38`). No new HTML pages or URL routing needed.

### Config from `/api/config`, not hardcoded
Keeps keys out of committed source. Supports staging vs production. Anon key is public by design but cleaner to serve dynamically.

### `shared/` directory
First shared cross-cutting module. Auth is the first occupant; future shared code can follow.

### Supabase session storage
Supabase JS v2 persists sessions in localStorage under `sb-<project-ref>-auth-token`. Sessions survive refreshes and are shared across all 3 entry points (same origin).

### OAuth redirect flow
Google and Apple SSO use `supabase.auth.signInWithOAuth({ provider, options: { redirectTo } })`. Supabase redirects to the OAuth provider, then back to our callback URL. The callback handler at `/api/auth/callback` exchanges the code and redirects to the app.

## Implementation Phases

### Phase 1: Config + Foundation
1. Update `api/config.js` — add `supabaseUrl`, `supabaseAnonKey`
2. Create `shared/auth.js` — init Supabase client, expose `HikerAuth` global
3. Create `shared/auth.css` — modal styles

### Phase 2: Auth UI Modal
4. Implement auth modal in `shared/auth.js`:
   - Login tab (email + password + "Forgot password?" link)
   - Register tab (email + password + confirm password)
   - SSO buttons (Google, Apple) with divider
   - Forgot password view (email + send link)
   - Post-action messages (check email, reset sent)
   - Inline error display, loading states
5. Implement auth state UI (button text/icon updates on login/logout)

### Phase 3: HTML Integration
6. Update `index.html` — CDN script, shared module, auth button
7. Update `demo/index.html` — CDN script, shared module, auth button
8. Update `souvenir/index.html` — CDN script, shared module, auth button

### Phase 4: Server-Side
9. Create `api/auth/callback.js` — handle email confirmation + OAuth redirect
10. Create `api/_lib/auth.js` — JWT verification utility
11. Update `api/ai.js` — optional auth header check, CORS for Authorization header
12. Add `@supabase/supabase-js` to `package.json`

### Phase 5: Token Passing
13. Update `callAI` in `demo/app.js:1704` — add auth token to fetch headers
14. Update `callAI` in `souvenir/souvenir-app.js:14` — same

## Supabase Dashboard Configuration

1. **Auth > URL Configuration**: Set site URL and add redirect URL for `/api/auth/callback`
2. **Auth > Providers**: Enable Google (needs OAuth client ID/secret), enable Apple (needs Service ID, Team ID, Key ID, private key)
3. **Auth > Email Templates**: Customize if desired (defaults work)
4. **Auth > Settings**: Enable email confirmations, min password length 8

## Risks

| Risk | Impact | Mitigation |
|------|--------|------------|
| Supabase CDN fails to load | Auth button hidden | `HikerAuth.init()` checks `window.supabase` exists; all existing features unaffected |
| Email verification link expires | User can't verify | Show "Resend verification" in login form on unverified email error |
| Service role key exposure | Security breach | Only used in server-side files; `/api/config` only exposes publishable key |
| `shared/` not served by Vercel | 404 on auth.js | Vercel serves all files from output dir (`.`); no config needed |
