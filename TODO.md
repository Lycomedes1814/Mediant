# TODO

## General
- [ ] Multilingual support
- [ ] Mobile notifications
- [ ] ICS import/export
- [ ] Subscribe to ICS URLs
- [ ] Serve ICS endpoint
- [ ] Time-grid view

## This and future operations

Goal: support the Google Calendar-style third option for repeating items: apply a delete or edit from the selected occurrence onward, while keeping earlier occurrences intact.

### Implementation

- [ ] Persistence helper: add `splitSeries(source, entry, baseDate, { mode: "truncate" | "fork"; patch? })`
- [ ] Edit panel: add a "This and future" section with Delete + Change actions
- [ ] Tests: truncation boundary, fork behavior, exception handling after split, parser round-trip

### Edge cases to lock down

- [ ] Decide semantics when splitting at the very first occurrence
- [ ] Decide whether future exceptions are dropped or migrated when a series is split

## Multi-day timestamps (`--`)

Goal: support Org's `<DATE …>--<DATE …>` spanning timestamps so multi-day events (vacations, conferences, retreats) render across each day they cover instead of being skipped as body text.

### Data model

- [ ] Extend `OrgTimestamp` with `endDate: string | null` (parallel to `endTime`); single-day timestamps keep `endDate: null`
- [ ] At parse time, drop the range and fall back to body text if `endDate < date` or if the two endpoints carry different repeaters

### Parser

- [ ] Recognize `<DATE …>--<DATE …>` in `TIMESTAMP_RE` (or a sibling regex driven from the same parser entry point) and emit a single `OrgTimestamp` with `endDate` set
- [ ] Carry the repeater from the opening endpoint; require the closing endpoint's repeater (if present) to match

### Agenda generation

- [ ] Treat a multi-day occurrence as one entry that occupies every day in `[date, endDate]` clamped to the visible window
- [ ] Carry `dayIndex` / `dayCount` onto each generated `AgendaItem` so the renderer can tag continuation days

### Render

- [ ] All-day multi-day spans render on each day in the all-day band, title shown on every day
- [ ] Timed multi-day spans show start time on the first day and end time on the last day; middle days show title only
- [ ] Small `n/N` badge on continuation days (e.g. `2/5`)

### Exceptions

- [ ] `cancelled` suppresses the whole span on that base occurrence
- [ ] `shift ±N{m,h,d}` shifts both endpoints by the same delta; duration preserved
- [ ] `reschedule YYYY-MM-DD [HH:MM[-HH:MM]]` moves the start; preserve span length; explicit times apply to the first day only
- [ ] `EXCEPTION-NOTE` renders once on the first day of the span

### Source edit / edit panel

- [ ] Add an "End date" field next to the date picker, shown only when toggled on
- [ ] Round-trip writes through `<…>--<…>`; clearing the end date emits a single timestamp instead of an empty range
- [ ] DONE-toggle advances both endpoints together using the existing repeater semantics

### Tests

- [ ] Parser: with/without times, repeater on both endpoints, mismatched repeater rejected, `endDate < date` rejected
- [ ] Recurrence: weekly multi-day event expands one occurrence per spanned day across the visible window
- [ ] Exceptions: shift / reschedule / cancel applied to a multi-day occurrence preserve span semantics
- [ ] Render: continuation-day badge, time only on first and last days
- [ ] Source edit: round-trip, DONE advances both endpoints

### Open questions

- [ ] Should overdue / upcoming-deadline use the start date, end date, or both?
- [ ] Multi-day SCHEDULED vs DEADLINE: does either need different display treatment?
- [ ] Optional Elisp integration: any extra work beyond what plain Org agenda already does for `--` ranges?
