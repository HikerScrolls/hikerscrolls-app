# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

HikerScrolls is an AI-powered travel journal web app. Users import GPX tracks and photos to create shareable travel stories with AI-generated souvenir designs (postcards, magnets, stickers, pins, stamps). Deployed on Vercel.

## Architecture

**Zero-build, vanilla JavaScript** — no framework, no bundler, no TypeScript. Static HTML/CSS/JS served directly.

### Frontend Apps (3 separate entry points)

- **Landing page** (`/index.html`) — marketing site linking to demo and studio
- **Demo app** (`/demo/index.html` + `demo/app.js`) — full travel journal with 5-step creation wizard, Leaflet maps, GPX track visualization, photo management, and trip rendering in three templates (scrollytelling, scrapbook, illustrated)
- **Souvenir Studio** (`/souvenir/index.html` + `souvenir/souvenir-app.js`) — standalone photo-to-merchandise design tool

### Shared Modules (`/shared/`)

- **`shared/auth.js`** — Supabase auth module loaded by all 3 entry points. Exposes global `HikerAuth` with `init()`, `getUser()`, `getSession()`, `getAccessToken()`, `showAuthModal()`, `signOut()`. Supports email/password + Google/Apple SSO. Progressive enhancement — all features work without login.
- **`shared/auth.css`** — Auth modal styles

### Backend (`/api/`)

- **POST /api/ai** (`api/ai.js`) — unified AI proxy routing to 9+ LLM providers (Gemini, Claude, OpenAI, Qwen, DeepSeek, etc.). Supports `text`, `vision`, `image`, and `search` capabilities. In-memory rate limiting per IP. Optionally verifies auth token if `Authorization` header present.
- **GET /api/config** (`api/config.js`) — public-safe config (map tile keys, Supabase URL + publishable key)
- **GET /api/ai/providers** (`api/ai/providers.js`) — available providers/models metadata
- **GET /api/auth/callback** (`api/auth/callback.js`) — handles Supabase email confirmation + OAuth redirect code exchange
- **`api/_lib/auth.js`** — server-side JWT verification utility using Supabase secret key

### Key Architectural Patterns

- **Multi-LLM provider adapter**: Each provider in `api/ai.js` implements `text()`, `vision()`, `image()` methods behind a unified interface. Auto-retries with exponential backoff on 503/429/529.
- **Dual client storage**: Metadata in localStorage (`hikerscrolls_local_trips`, `hikerscrolls_svn_settings`), binary photo data in IndexedDB (`hikerscrolls-photos` database, `photos` object store).
- **Hand-written EXIF parser**: Binary EXIF GPS extraction in `demo/app.js:62-169` — reads JPEG ArrayBuffer directly, no library.
- **Souvenir generation pipeline** (`souvenir-core.js`): Multi-phase stateful generator — photo classification → hero assignment → cultural enrichment → design strategy → batch image generation → AI quality judgment → iterative refinement.
- **`souvenir-core.js` is duplicated** between `/demo/` and `/souvenir/` — edits must be synced manually.

## Development

No build step. No npm scripts. No test framework.

- **Run locally**: Use `vercel dev` or any static file server. The `/api/` functions require Vercel's serverless runtime.
- **Deploy**: Push to `main` — Vercel auto-deploys. Config in `vercel.json` (no build command, output dir is `.`).
- **Install server deps**: `npm install` (installs `@supabase/supabase-js` for server-side auth)
- **Environment variables** (set in Vercel dashboard): `GEMINI_API_KEY`, `ANTHROPIC_API_KEY`, `QWEN_API_KEY`, `OPENAI_API_KEY`, `KIMI_API_KEY`, `DEEPSEEK_API_KEY`, `MINIMAX_API_KEY`, `SEEDREAM_API_KEY`, `TAVILY_API_KEY`, `STADIA_API_KEY`, `RATE_LIMIT_PER_MIN` (default 60), `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SECRET_KEY`.

## Workflow Rules

- **Implementation plan first**: Before starting any non-trivial feature, write an implementation plan in `docs/` (e.g. `docs/<feature>-implementation-plan.md`).
- **Dev log**: Always maintain a dev log in `docs/` (e.g. `docs/<feature>-devlog.md`) documenting every file changed and what was done.

## Code Layout Notes

- `demo/app.js` (~5,100 lines) is the main application file — contains the 5-step wizard, trip rendering, map integration, photo management, and all UI logic
- External libs loaded from CDN: Leaflet.js (maps), Marked.js (markdown), Supabase JS v2 (auth)
- Trip data format lives in `demo/data/*.json` — versioned schema (currently v5) with `gpxTrack`, `locations`, `sections`, `souvenirResults`
- Rate limiting resets on Vercel cold start (in-memory Map)
