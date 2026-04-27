# TODO

## General
- [ ] Multilingual support
- [ ] Month view
- [ ] Mobile notifications
- [ ] ICS import/export
- [ ] Subscribe to ICS URLs
- [ ] Serve ICS endpoint
- [ ] Time-grid view
- [ ] Toggle inline display/editing of subtasks

## Quick-capture follow-up

- [ ] Decide whether captured text should accept lightweight prefixes later, e.g. `#tag`, `!A`, or `tomorrow`

## This and future operations

Goal: support the Google Calendar-style third option for repeating items: apply a delete or edit from the selected occurrence onward, while keeping earlier occurrences intact.

### Implementation

- [ ] Persistence helper: add `splitSeries(source, entry, baseDate, { mode: "truncate" | "fork"; patch? })`
- [ ] Edit panel: add a "This and future" section with Delete + Change actions
- [ ] Tests: truncation boundary, fork behavior, exception handling after split, parser round-trip

### Edge cases to lock down

- [ ] Decide semantics when splitting at the very first occurrence
- [ ] Decide whether future exceptions are dropped or migrated when a series is split
