# CLAUDE.md

## Project overview

Mediant is a minimal Org-mode parser and agenda viewer. It parses a focused subset of Org syntax and renders a responsive rolling 7-day agenda in HTML/CSS. It runs in two modes: a **static mode** where users paste Org content into a textarea (localStorage-backed), and a **server mode** where a local Node CLI (`mediant <file.org>`) serves the UI and streams the configured Org file over `/api/source` + SSE. No framework dependencies.

## Architecture

Three clearly separated stages — do not collapse them:

```
  .org file → Parser (org/) → Agenda (agenda/)    → UI (ui/)
              OrgEntry[]       AgendaWeek            HTML/CSS
                               DeadlineItem[]
                               OverdueItem[]
                               SomedayItem[]
```

- **Parser output types** (`src/org/`) reflect Org source faithfully
- **Agenda types** (`src/agenda/`) reflect UI needs (render categories, 7-day structure)
- Classification into display categories happens at the agenda stage, never during parsing

## Key source files

| File | Responsibility |
|---|---|
| `src/org/timestamp.ts` | Timestamp parsing, Date conversion, recurrence expansion. **Only** module that does date arithmetic. |
| `src/org/parser.ts` | Line-by-line Org parser → `OrgEntry[]`. Delegates all timestamp work to `timestamp.ts`. |
| `src/org/model.ts` | Parser output types: `OrgEntry`, `OrgPlanning`, `TodoState`, `Priority`, `CheckboxItem`. |
| `src/agenda/model.ts` | Agenda/render types: `AgendaItem`, `AgendaDay`, `AgendaWeek`, `DeadlineItem`, `OverdueItem`, `SomedayItem`, `RenderCategory`. |
| `src/agenda/generate.ts` | 7-day generation from a start date, recurrence expansion (bounded to requested range), classification, sorting, overdue/someday collection. |
| `src/ui/render.ts` | DOM rendering from `AgendaWeek` + `DeadlineItem[]` + `OverdueItem[]`. |
| `src/ui/tagColors.ts` | Dynamic tag color management. Auto-assigns from palette, persists in localStorage. |
| `src/ui/style.css` | All styles. CSS grid layout with fixed time column. |
| `src/main.ts` | Entry point. Probes `/api/source` on boot; if present, enters server mode (hydrates from the server, subscribes to `/api/events` for external file changes). Otherwise shows the textarea input screen backed by localStorage. Add-item & edit-item panels with tag picker. |
| `server/cli.mjs` | Node CLI + HTTP server. `mediant <file.org> [--port N] [--daemon]`. Serves `dist/` plus `GET/PUT /api/source` (with `If-Match` version checks) and `GET /api/events` SSE backed by `fs.watch`. Node built-ins only, no deps. |

## Commands

```sh
npm test              # run all tests (vitest)
npm run test:watch    # vitest in watch mode
npx vite              # dev server (serves index.html)
npm run build         # build dist/ for the server to serve
npm start <file.org>  # build + start the local server against a file
```

## Server mode

- `server/cli.mjs` is a self-contained Node script — no dependencies beyond Node built-ins (`http`, `fs`, `child_process`, etc.). Do not add npm deps to it casually.
- Version token is `mtimeMs` as a string. Client sends `If-Match: <version>` on `PUT /api/source`; mismatch → 409, client reloads from disk (disk wins).
- `fs.watch` fires multiple times per write on some platforms — the watcher is debounced 100 ms and only broadcasts on real `mtimeMs` changes.
- SSE clients receive `data: <version>\n\n`; the client ignores events whose version matches its own (so it doesn't reload after its own PUT).
- Server binds to `127.0.0.1` only. Auth is intentionally absent — the assumption is Tailscale or equivalent for remote access.
- `--daemon` re-execs the same node script detached with `MEDIANT_CHILD=1` and the flag stripped, then the parent prints the PID and exits. Stop with `kill <pid>`.

## Design principles

- **Parser types stay close to Org semantics.** `OrgEntry` mirrors the source. No display logic leaks in.
- **Timestamps store strings, not Dates.** `date` is `"2026-04-07"`, times are `"15:15"`. Conversion happens via helpers in `timestamp.ts`.
- **Recurrence expansion is always bounded.** `expandRecurrences()` only generates occurrences within a given date range. Never expand globally.
- **All dates use local time.** No timezone handling — Org files don't encode timezones.
- **Only `TODO` and `DONE` states are recognized.** Other keywords (WAITING, NEXT, etc.) are treated as part of the heading title.
- **Readonly data structures.** Types use `readonly` throughout — data flows between stages, never mutated in place.

## Org syntax scope

See `ORG-SYNTAX.md` for the full breakdown of supported, gracefully ignored, and unsupported syntax.

**Supported:** headings, TODO/DONE, priority cookies (`[#A]`/`[#B]`/`[#C]`), tags, active timestamps, time ranges, repeaters (+Nd/w/m/y), SCHEDULED, DEADLINE, body text, checkbox lists (`- [ ]`/`- [X]`), progress cookies (`[2/3]`/`[66%]`).

**Gracefully ignored:** file keywords (#+), inactive timestamps, drawers, properties, comments, links, inline markup, plain lists, tables.

**Not supported:** .+/++ repeaters, diary sexp, custom TODO keywords, tag inheritance, habits, clocking.

## UI structure

- **Overdue section** at the very top — TODO items past their DEADLINE or SCHEDULED date, sorted most overdue first. Shows days overdue + kind badge (DEADLINE/SCHEDULED). Red-accented border and labels.
- **Upcoming deadlines section** below overdue (global, not per-day)
- **Day cards** (7 consecutive days starting from today), each containing:
  - All-day section (holidays, birthdays — no label, title flush left)
  - Deadline items (DEADLINE badge + title, time shown if present)
  - Timed events (time column + title + tag badges, tag-colored left border)
  - Scheduled tasks inline with events (time → TODO badge → title)
- **DONE items** rendered at `opacity: 0.55` with line-through
- **Today** indicated by blue border + small blue dot (not a text badge)
- **Empty days** always present, shown with a subtle em dash
- **Tags** rendered as colored badge pills, right-aligned. Colors auto-assigned from a palette and persisted in localStorage (`mediant-tag-colors`)
- **Priority badges** — `[#A]`/`[#B]`/`[#C]` rendered as small colored badges (red/amber/blue) nested inside the item title so the row grid templates stay fixed
- **Progress badges** — `[2/3]` rendered as a small badge next to the title (green when complete, gray otherwise)
- **Checkbox lists** — `- [ ]`/`- [X]` items rendered as a mini checklist under the agenda item; checked items dimmed with strikethrough
- **Now line** on today's card — orange line positioned proportionally within the timed section
- **Navigation** — prev/next by 7-day increments, "Today" button returns to today as start date
- **Someday section** at the bottom — undated TODO items (no timestamps, no SCHEDULED/DEADLINE), sorted alphabetically
- **Add-item panel** — slide-in panel for creating TODO tasks and events. Generates Org text and appends to the active source (server file or localStorage).
- **Edit-item panel** — same slide-in panel, opened from a per-item edit button. Rewrites the existing Org block in place, preserving body lines. Shows interactive checkbox toggles for entries with checkbox items.
- **Org source persistence** — in static mode, the textarea content is saved to `localStorage` (`mediant-org-source`). In server mode, the source is the file passed to `mediant <file.org>` and localStorage is not used for it. All writes flow through `persistSource()` in `main.ts`, which dispatches to the active backend.

## Testing

Tests across three suites:

- `src/org/__tests__/timestamp.test.ts` — parsing, helpers, recurrence expansion edge cases (month boundaries, leap years)
- `src/org/__tests__/parser.test.ts` — headings, states, tags, planning, timestamps, body text, drawers, checkbox items, progress cookies, full integration
- `src/agenda/__tests__/generate.test.ts` — classification, recurrence, sorting, 7-day structure, full integration

Always run tests after changes to parser, timestamp, or agenda logic.

## Conventions

- 7-day range runs **startDate 00:00 through startDate+6 23:59:59** (local time)
- Source line numbers are **1-based**
- Body text is a **single string** with lines joined by `\n`, leading whitespace trimmed
- Planning lines only accepted **immediately after a heading** (or another planning line)
- Timestamp-only body lines are captured as timestamps; mixed prose+timestamp lines are body text
- Checkbox list items (`- [ ]`/`- [X]`) are captured into `checkboxItems`, not body text
- `#+` keyword lines and `# ` comment lines inside entries are **skipped, not preserved as body**
- Any `:UPPERCASENAME:...:END:` block is skipped (covers all drawers)

## Non-goals (v1)

- Full Org-mode syntax
- Heading hierarchy in the agenda
- Properties, drawers, habits, clocking
- Timezone handling
- Advanced state workflows / custom TODO sequences
- Multi-file agenda
- Export to other formats
