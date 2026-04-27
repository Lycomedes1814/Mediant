# AGENTS.md

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
| `src/org/timestamp.ts` | Timestamp parsing, Date conversion, recurrence expansion, per-occurrence exception application. **Only** module that does date arithmetic. Exports both `expandRecurrences()` (pure base series) and `expandOccurrences()` (base series with exceptions applied). |
| `src/org/parser.ts` | Line-by-line Org parser → `OrgEntry[]`. Delegates all timestamp work to `timestamp.ts`. Reads `:EXCEPTION-<date>:`, `:EXCEPTION-NOTE-<date>:`, and `:SERIES-UNTIL:` keys inside `:PROPERTIES:` drawers; every other drawer and every other property key is skipped. |
| `src/org/model.ts` | Parser output types: `OrgEntry` (including `seriesUntil`), `OrgPlanning`, `TodoState`, `Priority`, `CheckboxItem`, `RecurrenceOverride`, `RecurrenceException`. |
| `src/org/drawer.ts` | Property-drawer text mutation helpers (`upsertProperty`, `removeProperty`). Operate on raw source strings; preserve key order and other drawer content; used by the edit panel to write exception properties. |
| `src/agenda/model.ts` | Agenda/render types: `AgendaItem`, `AgendaDay`, `AgendaWeek`, `DeadlineItem`, `OverdueItem`, `SomedayItem`, `RenderCategory`, `AgendaItemOverride`. |
| `src/agenda/generate.ts` | 7-day generation from a start date, recurrence expansion with exceptions (bounded to requested range), classification, sorting, overdue/someday collection. |
| `src/ui/render.ts` | DOM rendering from `AgendaWeek` + `DeadlineItem[]` + `OverdueItem[]`. Renders the per-occurrence override chip, instance note, active tag-filter state, and tag color-mode UI. |
| `src/ui/tagColors.ts` | Dynamic tag color management. Auto-assigns from palette, persists in localStorage. |
| `src/ui/style.css` | All styles. CSS grid layout with fixed time column. |
| `src/main.ts` | Entry point. Probes `/api/source` on boot; if present, enters server mode (hydrates from the server, subscribes to `/api/events` for external file changes). Otherwise shows the textarea input screen backed by localStorage. Owns global keyboard shortcuts, tag-filter state, tag color mode, quick-capture overlay, add-item & edit-item panels, and the "This occurrence" section that writes exception properties via the drawer helpers. |
| `server/cli.mjs` | Node CLI + HTTP server. `mediant <file.org> [--port N] [--daemon]`. Serves `dist/` plus `GET/PUT /api/source` (with `If-Match` version checks) and `GET /api/events` SSE backed by `fs.watch`. Node built-ins only, no deps. |

## Commands

```sh
npm test              # run all tests (vitest)
npm run test:watch    # vitest in watch mode
npx vite              # dev server (serves index.html)
npm run build         # build dist/ for the server to serve
npm start <file.org>  # build + start the local server against a file
```

## Change workflow

- Update docs only for meaningful behavior, workflow, architecture, persistence, or data-model changes.
- Keep small spacing/styling polish out of high-level docs unless it changes an explicit documented UI contract.
- Mention minor visual polish in the commit message instead of README/AGENTS.
- Commit completed changes with a verbose commit message that explains the behavior change, persistence or data-model impact, and test coverage.

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
- **Recurrence expansion is always bounded.** `expandRecurrences()` and `expandOccurrences()` only generate occurrences within a given date range. Never expand globally.
- **Exceptions are keyed by base date, not final date.** A rescheduled occurrence on Tue 12 May still lives under `:EXCEPTION-2026-05-11:` if the base series hit Mon 11 May. UI labels reflect final date/time; property writes round-trip through the unshifted base slot.
- **Exceptions on non-repeating entries are parsed but inert.** `entry.exceptions` is populated regardless of whether the entry has a repeater; expansion simply never runs. Do not "fix" this by applying the map to the single timestamp.
- **`:SERIES-UNTIL:` is exclusive and base-slot-based.** An occurrence whose base date equals `seriesUntil` is not generated; the successor heading (if any) may start *on* that date without overlap. Reschedules keyed at/after the end are ignored because the base slot no longer exists, but a valid base slot before `seriesUntil` may still be moved past the cutoff. Like exceptions, it is parsed-but-inert on non-repeating entries.
- **Override is behaviour, note is metadata.** A single occurrence can carry both (e.g. `shift +45m` + a note, or `cancelled` + a note). A cancelled+note pair is intentionally allowed.
- **All dates use local time.** No timezone handling — Org files don't encode timezones.
- **Only `TODO` and `DONE` states are recognized.** Other keywords (WAITING, NEXT, etc.) are treated as part of the heading title.
- **Readonly data structures.** Types use `readonly` throughout — data flows between stages, never mutated in place.

## Org syntax scope

See `ORG-SYNTAX.md` for the full breakdown of supported, gracefully ignored, and unsupported syntax.

**Supported (standard Org):** headings, TODO/DONE, priority cookies (`[#A]`/`[#B]`/`[#C]`), tags, active timestamps, time ranges, repeaters (+Nd/w/m/y), SCHEDULED, DEADLINE, body text, checkbox lists (`- [ ]`/`- [X]`), progress cookies (`[2/3]`/`[66%]`).

**Mediant-specific extensions:** per-occurrence recurrence exceptions via `:EXCEPTION-<date>:` / `:EXCEPTION-NOTE-<date>:` (keyed on the *unshifted* base date), plus `:SERIES-UNTIL:` for an exclusive end date on a repeating series. `SERIES-UNTIL` is evaluated on the repeater's base slots, not the final moved-to date, which is what makes split-series handoff work cleanly. Both ride on ordinary Org property-drawer syntax, so files remain valid Org (Emacs opens and edits them without complaint — it just treats the keys as arbitrary properties).

**Gracefully ignored:** file keywords (#+), inactive timestamps, drawers (including property drawers — only the `:EXCEPTION-…:`, `:EXCEPTION-NOTE-…:`, and `:SERIES-UNTIL:` extension keys are read), comments, links, inline markup, plain lists, tables.

**Not supported:** .+/++ repeaters, diary sexp, custom TODO keywords, tag inheritance, habits, clocking.

## UI structure

- **Overdue section** at the very top — TODO items past their DEADLINE or SCHEDULED date, sorted most overdue first. Shows days overdue + kind badge (DEADLINE/SCHEDULED) + clickable TODO badge before the title. Red-accented border and labels.
- **Upcoming deadlines section** below overdue (global, not per-day). Due text is rendered as `Today` or compact day counts like `12d`, with urgency colors that progress from red to orange to yellow to a calmer tone as the due date gets farther away.
- **Day cards** (7 consecutive days starting from today), each containing:
  - All-day section (holidays, birthdays — no label, title flush left)
  - Deadline items (DEADLINE badge + title, time shown if present)
  - Timed events (time column + title + tag badges, tag-colored left border)
  - Scheduled tasks inline with events (time → TODO badge → title)
- **DONE items** rendered at `opacity: 0.55` with line-through
- **Today** indicated by blue border + small blue dot (not a text badge)
- **Hide empty days** — toolbar toggle removes day blocks with no visible agenda items. If no day blocks remain, the day-card container is not rendered. Preference persists in localStorage (`mediant-hide-empty-days`).
- **Tags** rendered as colored badge pills, right-aligned. Colors auto-assigned from a palette and persisted in localStorage (`mediant-tag-colors`).
- **Tag filtering** — clicking a tag toggles it in the active filter set. Filtering applies to the 7-day agenda, overdue section, upcoming deadlines, and someday section. Multiple selected tags use AND semantics: an item must contain every selected tag to remain visible.
- **Tag color mode** — explicit toolbar toggle that repurposes tag clicks from filtering to recoloring. `Alt`-click on a tag opens its color picker directly without changing mode.
- **Tag picker keyboard support** — in the add/edit panel, `ArrowUp`/`ArrowDown` move through tag suggestions, `Enter` selects the highlighted suggestion, and `Backspace` on an empty tag field removes the last selected pill.
- **Priority badges** — `[#A]`/`[#B]`/`[#C]` rendered as small colored badges (red/amber/blue) nested inside the item title so the row grid templates stay fixed. Do not duplicate priority in metadata rows; it should appear before the title everywhere.
- **Progress badges** — `[2/3]` rendered as a small badge next to the title (green when complete, gray otherwise)
- **Checkbox lists** — `- [ ]`/`- [X]` items rendered as a mini checklist under the agenda item; checked items dimmed with strikethrough. The checklist editor is hidden in the add/edit panel whenever a repeater is active, because checklist state is not modeled per occurrence.
- **Recurrence-exception chip** — shifted, rescheduled, or cancelled occurrences show a small muted chip (`shifted` / `moved` / `skipped`) nested in the title, with detail such as `+45m`, `from 2026-05-11 17:00-18:00`, or `Skipped occurrence` in the tooltip.
- **Instance note** — `:EXCEPTION-NOTE-<date>:` renders as an italic one-liner directly under the occurrence, aligned with the row's title column.
- **Now line** on today's card — orange line positioned proportionally within the timed section
- **Navigation** — prev/next by 7-day increments, "Today" button returns to today as start date
- **Keyboard shortcuts** — `n` next week, `p` previous week, `t` jump to today, `a` open add-item panel, `q` open quick capture, `c` toggle tag color mode, `h` toggle hide empty days, `x` clear active tag filters. Disabled while focus is inside text inputs, textareas, selects, or other editable controls.
- **Someday section** at the bottom — undated TODO items (no timestamps, no SCHEDULED/DEADLINE), shown in source order so quick captures stay in capture order
- **Quick capture** — fixed one-line overlay opened with `q`. Placeholder text is `Quick task capture`; `Enter` appends the text as an undated `TODO` child under top-level `* Inbox`, clears the field, and keeps focus ready for repeated capture. `Escape` or clicking outside the input exits. Captured Org-looking text is sanitized so priority cookies, trailing tags, progress cookies, and timestamps remain plain title text instead of changing agenda classification.
- **Add-item panel** — slide-in panel for creating TODO tasks and events. Defaults to Event because quick capture covers low-friction TODO entry. Generates Org text and appends to the active source (server file or localStorage).
- **Edit-item panel** — same slide-in panel, opened from a per-item edit button. Rewrites the existing Org block in place, preserving body lines, and autosaves valid field changes immediately rather than requiring a Save button. Shows interactive checkbox toggles for entries with checkbox items. When the clicked item is an occurrence of a repeating series, a **"This occurrence"** block appears alongside the **"Series"** fields, exposing skip/stop-repeat toggles, a move date/time field, a note field, and Clear override; these write `:EXCEPTION-<base>:` / `:EXCEPTION-NOTE-<base>:` via `upsertProperty` and `removeProperty` immediately. The base date passed through from the click (`data-base-date` on the clicked title) is always the **unshifted** slot, so writes stay stable even after a reschedule moves the occurrence to a different day.
- **Shorthand date input** — add/edit date fields accept `DD`, `DD/MM`, `DD/MM/YY`, `DD/MM/YYYY`, `+N`, and weekday names `mon`..`sun`. Ambiguous numeric forms resolve to the next future occurrence, and 2-digit years are interpreted in the current century.
- **Org source persistence** — in static mode, the textarea content is saved to `localStorage` (`mediant-org-source`). In server mode, the source is the file passed to `mediant <file.org>` and localStorage is not used for it. All writes flow through `persistSource()` in `main.ts`, which dispatches to the active backend.

## Testing

Tests across four suites:

- `src/org/__tests__/timestamp.test.ts` — parsing, helpers, recurrence expansion edge cases (month boundaries, leap years), per-occurrence exception application (cancelled / shift / reschedule, including midnight rollover in both directions)
- `src/org/__tests__/parser.test.ts` — headings, states, tags, planning, timestamps, body text, drawers, checkbox items, progress cookies, `parseOverride` grammar, exception-key scanning inside PROPERTIES drawers, full integration
- `src/org/__tests__/drawer.test.ts` — `upsertProperty` / `removeProperty` round-trips (create drawer in correct position, append/update/remove keys, drop empty drawer, idempotent writes)
- `src/agenda/__tests__/generate.test.ts` — classification, recurrence, sorting, 7-day structure, exception threading onto `AgendaItem`, full integration

Always run tests after changes to parser, timestamp, drawer, or agenda logic.

## Conventions

- 7-day range runs **startDate 00:00 through startDate+6 23:59:59** (local time)
- Source line numbers are **1-based**
- Body text is a **single string** with lines joined by `\n`, leading whitespace trimmed
- Planning lines only accepted **immediately after a heading** (or another planning line)
- Timestamp-only body lines are captured as timestamps; mixed prose+timestamp lines are body text
- Checkbox list items (`- [ ]`/`- [X]`) are captured into `checkboxItems`, not body text
- `#+` keyword lines and `# ` comment lines inside entries are **skipped, not preserved as body**
- Any `:UPPERCASENAME:...:END:` block is skipped **except** `:PROPERTIES:` drawers, where `:EXCEPTION-<date>:`, `:EXCEPTION-NOTE-<date>:`, and `:SERIES-UNTIL:` keys are read; every other property key is still ignored

## Non-goals (v1)

- Full Org-mode syntax
- Heading hierarchy in the agenda
- Arbitrary property drawers beyond `:EXCEPTION-…:` / `:EXCEPTION-NOTE-…:` / `:SERIES-UNTIL:`; habits, clocking, `:STYLE:`, `:CATEGORY:`, effort estimates
- "This and future" split operations (tracked in TODO.md)
- Timezone handling
- Advanced state workflows / custom TODO sequences
- Multi-file agenda
- Export to other formats
