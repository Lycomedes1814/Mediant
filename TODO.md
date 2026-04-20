# TODO

## General
- [ ] Multilingual support
- [ ] Filter by tags
- [ ] Month view
- [ ] Toggle hiding empty days (useful with filters)

## Follow-ups
- [ ] Expose cancelled occurrences' notes somewhere in the series/edit view

## This and future operations

Goal: support the Google Calendar-style third option for repeating items: apply a delete or edit from the selected occurrence onward, while keeping earlier occurrences intact.

### Decisions still open

- [ ] Confirm the storage model: split into two headings and store an exclusive `:SERIES-UNTIL:` date on the original heading
- [ ] Document the final encoding in `ORG-SYNTAX.md`

### Implementation

- [ ] Parser: read `:SERIES-UNTIL:` into `seriesUntil: string | null` on `OrgEntry`
- [ ] Expansion: stop generating occurrences on/after `seriesUntil`
- [ ] Persistence helper: add `splitSeries(source, entry, baseDate, { mode: "truncate" | "fork"; patch? })`
- [ ] Edit panel: add a "This and future" section with Delete + Change actions
- [ ] Tests: truncation boundary, fork behavior, exception handling after split, parser round-trip

### Edge cases to lock down

- [ ] Decide semantics when splitting at the very first occurrence
- [ ] Decide whether future exceptions are dropped or migrated when a series is split
