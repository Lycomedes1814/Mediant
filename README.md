# Mediant

A minimal, dependency-free web agenda for Org-mode files.

Parses the subset of Org syntax needed for agenda views and renders a responsive rolling week view. Runs in two modes:

- **Static mode** — paste Org content into a textarea, everything stays in `localStorage`. Zero-install, works from any static host.
- **Server mode** — `mediant <file.org>` starts a local Node server that reads and writes a real `.org` file. The UI hydrates from the file on load and picks up external edits (e.g. from Emacs) live via SSE.

The server can run locally for near-instant sync with your editor, or on a VPS for mobile access (behind Tailscale, an SSH tunnel, or a reverse proxy — no built-in auth). Keep the `.org` file in sync between machines with Syncthing, Dropbox, git, or whatever you prefer.

No framework dependencies. The server uses Node built-ins only — zero npm deps.

## Supported Org syntax

See [ORG-SYNTAX.md](ORG-SYNTAX.md) for the full breakdown of supported, gracefully ignored, and unsupported syntax.

| Feature | Example |
|---|---|
| Headings | `* Top level` / `** Second level` |
| TODO / DONE | `** TODO Some task` / `** DONE Finished` |
| Priority cookies | `** TODO [#A] Urgent task` |
| Tags | `** Heading :tag1:tag2:` |
| Active timestamp | `<2026-04-07 ti. 15:15-16:00>` |
| Repeater | `<2026-04-07 ti. 15:15-16:00 +1w>` |
| SCHEDULED | `SCHEDULED: <2026-04-14 ti. 12:00>` |
| DEADLINE | `DEADLINE: <2026-05-05 ti.>` |
| Checkbox lists | `- [ ] Pending` / `- [X] Done` |
| Progress cookies | `** TODO Task [2/3]` / `** TODO Task [66%]` |
| Body text | Free text lines under a heading |

Anything outside this subset is ignored gracefully — it will not cause errors.

## Getting started

```sh
npm install
npx vite         # dev server at http://localhost:5173 (textarea mode)
npm test         # run all tests
npm run build    # produce dist/
```

### Server mode

To run against a real `.org` file:

```sh
npm run build                    # produce dist/ (required once)
node server/cli.mjs ~/org/todo.org            # foreground, http://localhost:4242
node server/cli.mjs ~/org/todo.org --port 7000
node server/cli.mjs ~/org/todo.org --daemon   # fork to background, prints PID
```

Or, after `npm install -g .` (or `npm link`), just:

```sh
mediant ~/org/todo.org [--port N] [--daemon]
```

The browser UI hydrates directly from the file. Edits made in the UI are written back to disk, and external edits (from Emacs, Syncthing, etc.) are picked up automatically via SSE.

**Security:** the server binds to `127.0.0.1` with no authentication. For remote access, use Tailscale, an SSH tunnel, or a reverse proxy.

**Stopping a daemon:** `kill <pid>` (printed on `--daemon` start).

### API

The server exposes three endpoints on top of the static UI:

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/api/source` | Returns the file contents. Response header `X-Version: <mtimeMs>`. |
| `PUT` | `/api/source` | Writes the file. Accepts `If-Match: <version>`; mismatch returns `409`. Response header `X-Version` is the new version. |
| `GET` | `/api/events` | Server-Sent Events stream. Emits `data: <version>` whenever the file changes on disk. |

Conflict strategy: **disk wins**. If the file changes underneath you, the server rejects the write (409) and the UI reloads from disk.

## Architecture

Three clearly separated stages:

```
  .org file → Parser (src/org/) → Agenda (src/agenda/) → UI (src/ui/)
              OrgEntry[]           AgendaWeek             HTML/CSS
```

- **Parser types** reflect Org source faithfully (headings, timestamps, planning, tags, checkbox items, progress cookies, body)
- **Agenda types** reflect UI needs (render categories, week/day grouping, deadline collection)
- Classification into display categories happens at the agenda stage, never during parsing

## Project structure

```
src/
  org/
    model.ts           — Parser output types (OrgEntry, OrgPlanning, TodoState, Priority, CheckboxItem)
    timestamp.ts       — Timestamp parsing, Date conversion, recurrence expansion
    parser.ts          — Line-by-line Org file parser
    __tests__/         — Timestamp and parser tests
  agenda/
    model.ts           — Render types (AgendaItem, AgendaDay, AgendaWeek, DeadlineItem, OverdueItem, SomedayItem)
    generate.ts        — Week generation, classification, sorting, deadline collection
    __tests__/         — Agenda generation tests
  ui/
    render.ts          — DOM rendering from AgendaWeek + DeadlineItem[] + OverdueItem[]
    tagColors.ts       — Dynamic tag color management (auto-assign, localStorage)
    style.css          — All styles (CSS grid layout, responsive)
  main.ts              — Entry point: probes server, hydrates, wires parse → generate → render
server/
  cli.mjs              — Node CLI + HTTP server (no deps). Serves dist/ and exposes /api/source + /api/events.
index.html             — Minimal shell with #agenda container
```

## UI overview

- **Overdue section** at the top — TODO items past their DEADLINE or SCHEDULED date, sorted most overdue first
- **Upcoming deadlines** section below overdue (global, sorted by due date)
- **Day cards** (7 consecutive days starting from today) each containing:
  - All-day events (holidays, birthdays) in a subtle grouped section
  - Timed events with monospace time column, tag-colored left border, tag badges (colors auto-assigned from a palette, persisted in localStorage)
  - Scheduled tasks inline (time → TODO/DONE badge → title)
- **Priority badges** — A/B/C priority cookies rendered as small colored badges (red/amber/blue) before the item title
- **Progress badges** — `[2/3]` shown as a small badge next to the title (green when complete, gray otherwise)
- **Checkbox lists** — `- [ ]`/`- [X]` items rendered as a mini checklist under agenda items; toggleable in the edit panel
- **Someday section** at the bottom — undated TODO items (no timestamps, no SCHEDULED/DEADLINE)
- **DONE items** rendered at reduced opacity with line-through
- **Today** indicated by blue card border and small dot marker
- **Empty days** always shown (subtle em dash)
- **Week navigation** with prev/next/today buttons
- **Now line** on today's timed section
- **Add-item panel** for creating TODO tasks and events from the UI
- **Edit-item panel** for updating an existing entry in place (preserves body text)
- Responsive: sticky day headers and adjusted spacing on mobile

## Tech stack

- **TypeScript** — parser, data model, agenda generation, rendering
- **Vite** — dev server and bundling
- **Vitest** — 149 tests across parser, timestamp, and agenda suites
- **HTML/CSS** — responsive week view with CSS grid
- **Node** (built-ins only) — optional local server
- Zero runtime npm dependencies

## Non-goals (v1)

- Full Org-mode syntax
- Heading hierarchy in the agenda
- Properties, drawers, habits, clocking
- Timezone handling beyond local time
- Advanced state workflows / custom TODO keywords
- Multi-file agenda or export
- Built-in authentication (use Tailscale / SSH tunnel / reverse proxy)
- Collaborative editing (the file on disk is the single source of truth)

## Local storage

Mediant uses your browser's `localStorage` for the following:

| Key | Purpose |
|---|---|
| `mediant-org-source` | Pasted Org content (static mode only — ignored in server mode) |
| `mediant-tag-colors` | Tag-to-color assignments, so tag colors stay consistent |
| `theme` | Light/dark mode preference |

In static mode all data stays in the browser. In server mode the Org source lives in the file you passed to the CLI; tag colors and theme are still browser-local.

## License

[GPLv3](LICENSE)
