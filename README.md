# Mediant

A minimal Org-mode parser and week-agenda viewer. Paste Org-mode content into a textarea and get a responsive, visually clear week-agenda in HTML/CSS.

## What it does

1. **Parses** pasted Org content — only the subset of syntax needed for agenda views
2. **Models** the parsed data faithfully to Org semantics before any display logic
3. **Generates** a week-based agenda structure, expanding recurring events within the requested week only
4. **Renders** a responsive week-agenda UI with clear visual distinctions between event types

## Supported Org syntax

See [ORG-SYNTAX.md](ORG-SYNTAX.md) for the full breakdown of supported, gracefully ignored, and unsupported syntax.

| Feature | Example |
|---|---|
| Headings | `* Top level` / `** Second level` |
| TODO / DONE | `** TODO Some task` / `** DONE Finished` |
| Tags | `** Heading :tag1:tag2:` |
| Active timestamp | `<2026-04-07 ti. 15:15-16:00>` |
| Repeater | `<2026-04-07 ti. 15:15-16:00 +1w>` |
| SCHEDULED | `SCHEDULED: <2026-04-14 ti. 12:00>` |
| DEADLINE | `DEADLINE: <2026-05-05 ti.>` |
| Body text | Free text lines under a heading |

Anything outside this subset is ignored gracefully — it will not cause errors.

## Getting started

```sh
npm install
npx vite         # dev server at http://localhost:5173
npm test         # run all tests
```

The dev server serves `index.html` with a textarea to paste Org content.

## Architecture

Three clearly separated stages:

```
  .org file → Parser (src/org/) → Agenda (src/agenda/) → UI (src/ui/)
              OrgEntry[]           AgendaWeek             HTML/CSS
```

- **Parser types** reflect Org source faithfully (headings, timestamps, planning, tags, body)
- **Agenda types** reflect UI needs (render categories, week/day grouping, deadline collection)
- Classification into display categories happens at the agenda stage, never during parsing

## Project structure

```
src/
  org/
    model.ts           — Parser output types (OrgEntry, OrgPlanning, TodoState)
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
  main.ts              — Entry point: textarea input → parse → generate → render
index.html             — Minimal shell with #agenda container
```

## UI overview

- **Overdue section** at the top — TODO items past their DEADLINE or SCHEDULED date, sorted most overdue first
- **Upcoming deadlines** section below overdue (global, sorted by due date)
- **Day cards** (7 consecutive days starting from today) each containing:
  - All-day events (holidays, birthdays) in a subtle grouped section
  - Timed events with monospace time column, tag-colored left border, tag badges (colors auto-assigned from a palette, persisted in localStorage)
  - Scheduled tasks inline (time → TODO/DONE badge → title)
- **Someday section** at the bottom — undated TODO items (no timestamps, no SCHEDULED/DEADLINE)
- **DONE items** rendered at reduced opacity with line-through
- **Today** indicated by blue card border and small dot marker
- **Empty days** always shown (subtle em dash)
- **Week navigation** with prev/next/today buttons
- **Now line** on today's timed section
- **Add-item panel** for creating TODO tasks and events from the UI
- Responsive: sticky day headers and adjusted spacing on mobile

## Tech stack

- **TypeScript** — parser, data model, agenda generation, rendering
- **Vite** — dev server and bundling
- **Vitest** — 126 tests across parser, timestamp, and agenda suites
- **HTML/CSS** — responsive week-agenda UI with CSS grid
- No framework dependencies

## Non-goals (v1)

- Full Org-mode syntax
- Heading hierarchy in the agenda
- Priorities, properties, drawers, habits, clocking
- Timezone handling beyond local time
- Advanced state workflows / custom TODO keyword sequences
- Multi-file agenda, editing from the UI, export

## License

[GPLv3](LICENSE)
