# CLAUDE.md

## Project overview

Mediant is a minimal Org-mode parser and agenda viewer. It parses a focused subset of Org syntax and renders a responsive rolling 7-day agenda in HTML/CSS. Users paste Org content into a textarea to load the agenda. No framework dependencies.

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
| `src/org/model.ts` | Parser output types: `OrgEntry`, `OrgPlanning`, `TodoState`. |
| `src/agenda/model.ts` | Agenda/render types: `AgendaItem`, `AgendaDay`, `AgendaWeek`, `DeadlineItem`, `OverdueItem`, `SomedayItem`, `RenderCategory`. |
| `src/agenda/generate.ts` | 7-day generation from a start date, recurrence expansion (bounded to requested range), classification, sorting, overdue/someday collection. |
| `src/ui/render.ts` | DOM rendering from `AgendaWeek` + `DeadlineItem[]` + `OverdueItem[]`. |
| `src/ui/tagColors.ts` | Dynamic tag color management. Auto-assigns from palette, persists in localStorage. |
| `src/ui/style.css` | All styles. CSS grid layout with fixed time column. |
| `src/main.ts` | Entry point. Shows textarea input, wires parser → agenda → render. Tag editor & add-item panels. |

## Commands

```sh
npm test              # run all tests (vitest)
npm run test:watch    # vitest in watch mode
npx vite              # dev server (serves index.html)
```

## Design principles

- **Parser types stay close to Org semantics.** `OrgEntry` mirrors the source. No display logic leaks in.
- **Timestamps store strings, not Dates.** `date` is `"2026-04-07"`, times are `"15:15"`. Conversion happens via helpers in `timestamp.ts`.
- **Recurrence expansion is always bounded.** `expandRecurrences()` only generates occurrences within a given date range. Never expand globally.
- **All dates use local time.** No timezone handling — Org files don't encode timezones.
- **Only `TODO` and `DONE` states are recognized.** Other keywords (WAITING, NEXT, etc.) are treated as part of the heading title.
- **Readonly data structures.** Types use `readonly` throughout — data flows between stages, never mutated in place.

## Org syntax scope

See `ORG-SYNTAX.md` for the full breakdown of supported, gracefully ignored, and unsupported syntax.

**Supported:** headings, TODO/DONE, tags, active timestamps, time ranges, repeaters (+Nd/w/m/y), SCHEDULED, DEADLINE, body text.

**Gracefully ignored:** file keywords (#+), inactive timestamps, drawers, properties, comments, links, inline markup, lists, tables.

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
- **Now line** on today's card — red line positioned proportionally within the timed section
- **Navigation** — prev/next by 7-day increments, "Today" button returns to today as start date
- **Someday section** at the bottom — undated TODO items (no timestamps, no SCHEDULED/DEADLINE), sorted alphabetically
- **Add-item panel** — slide-in panel for creating TODO tasks and events. Generates Org text and appends to localStorage source.
- **Org source persistence** — textarea content saved to `localStorage` (`mediant-org-source`) and auto-filled on reload

## Testing

Tests across three suites:

- `src/org/__tests__/timestamp.test.ts` — parsing, helpers, recurrence expansion edge cases (month boundaries, leap years)
- `src/org/__tests__/parser.test.ts` — headings, states, tags, planning, timestamps, body text, drawers, full integration
- `src/agenda/__tests__/generate.test.ts` — classification, recurrence, sorting, 7-day structure, full integration

Always run tests after changes to parser, timestamp, or agenda logic.

## Conventions

- 7-day range runs **startDate 00:00 through startDate+6 23:59:59** (local time)
- Source line numbers are **1-based**
- Body text is a **single string** with lines joined by `\n`, leading whitespace trimmed
- Planning lines only accepted **immediately after a heading** (or another planning line)
- Timestamp-only body lines are captured as timestamps; mixed prose+timestamp lines are body text
- `#+` keyword lines and `# ` comment lines inside entries are **skipped, not preserved as body**
- Any `:UPPERCASENAME:...:END:` block is skipped (covers all drawers)

## Non-goals (v1)

- Full Org-mode syntax
- Heading hierarchy in the agenda
- Priorities, properties, drawers, habits, clocking
- Timezone handling
- Advanced state workflows / custom TODO sequences
- Multi-file agenda
- Editing from the UI
- Export to other formats
