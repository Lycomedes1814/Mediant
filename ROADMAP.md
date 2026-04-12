# Roadmap

## Edit entry

Muted crayon icon appears on hover over any agenda item. Clicking it opens the existing add-entry panel pre-filled with the entry's data for editing. In server mode, writes the change back to the .org file.

## Server backend

### Context

Mediant is currently a static SPA — users paste org text into a textarea. Goal: add a server that reads/writes a single `.org` file and serves the UI. Access from other devices via `tailscale serve`. No application-level auth.

## Architecture

```
  Express :3000
  ├─ GET  /api/org     → read file, return source
  ├─ POST /api/org     → append to file
  ├─ SSE  /api/events  → push on file change (fs.watch)
  └─ static dist/      → serve the built frontend
        ↕
  ~/org/todo.org  (single file, configured via ORG_FILE env var)
```

- Server points at **one file** via `ORG_FILE` env var
- Reads it, watches it with `fs.watch`, writes to it
- Frontend fetches source on load, re-renders on server-sent file-change events
- Standalone mode (no server) still works — textarea/localStorage fallback

## API

| Route | Method | Description |
|---|---|---|
| `/api/org` | GET | Returns `{ "source": "..." }` — full file contents |
| `/api/org` | POST | Body `{ "content": "* TODO ..." }` — appends to file |
| `/api/events` | GET | SSE stream — sends `event: change` when file changes on disk |

## New Files

| File | Purpose |
|---|---|
| `server/index.ts` | Express app — routes, static serving, SSE, fs.watch |
| `server/__tests__/server.test.ts` | Tests for read/write/watch logic |
| `tsconfig.server.json` | Extends base tsconfig, includes `server/` |

## Modified Files

| File | Changes |
|---|---|
| `src/main.ts` | Add `tryServerLoad()`, async `init()`, SSE listener for auto-refresh, server-mode `appendOrgText()` POSTs instead of localStorage |
| `src/ui/render.ts` | Show refresh button in server mode |
| `package.json` | Add `express` dep, `tsx` devDep, `start` and `dev:server` scripts |
| `vite.config.ts` | Add `/api` proxy for dev |
| `CLAUDE.md` | Document server setup |

## Frontend Changes

- On startup, fetch `/api/org`. Success → parse and render (skip textarea). Failure → existing standalone flow.
- Open SSE connection to `/api/events`. On `change` event, re-fetch `/api/org` and re-render. No manual refresh needed.
- `appendOrgText()`: in server mode, POST to `/api/org` (server appends to file, which triggers fs.watch, which triggers SSE, which triggers re-render).

## Implementation Order

1. Install deps: `express`, `@types/express`, `tsx`
2. Create `server/index.ts` — read, write, watch, SSE, static serving
3. Create `tsconfig.server.json`
4. Update `vite.config.ts` — dev proxy
5. Update `package.json` — scripts
6. Update `src/main.ts` — server mode detection, SSE, async init
7. Update `src/ui/render.ts` — refresh button
8. Tests + update `CLAUDE.md`

## Verification

1. `npm test` — existing tests still pass
2. `ORG_FILE=~/org/todo.org npm start` → open localhost:3000, agenda loads from file
3. Edit the .org file externally → agenda auto-updates via SSE
4. Add item from UI → appears in file on disk
5. Stop server, `npx vite` → standalone textarea mode works as before
