# TODO

## General
- [ ] Multilingual support
- [ ] Month view
- [x] Toggle hiding empty days (useful with filters)
- [ ] Mobile notifications
- [x] Quick-capture popup for task capture
- [ ] ICS import/export
- [ ] Subscribe to ICS URLs
- [ ] Serve ICS endpoint
- [ ] Time-grid view
- [ ] Toggle inline display/editing of subtasks

## Quick-capture popup

Goal: provide a low-friction way to fire off tasks immediately, without forcing the user to classify, schedule, tag, or edit full Org details in the moment. Captured items should become undated someday tasks that can be organized later.

### Product shape

- [x] Add a fixed overlay opened by the `q` keyboard shortcut
- [x] Keep the interaction to one input line with placeholder text `Quick task capture`
- [x] Enter captures the current input as a someday task and clears the field
- [x] Default every capture to an undated `TODO` heading so it appears in Someday until organized
- [x] Preserve fast repeated entry: after a successful capture, clear the field and keep the popup open
- [x] Escape exits the overlay
- [x] Clicking outside the input field exits the overlay
- [x] Avoid date parsing, tags, priorities, and checklist editing in the first version; the edit panel remains the organizing surface

### Org storage

- [x] Append captures under a dedicated top-level `* Tasks` heading
- [x] Create `* Tasks` at the end of the source if it does not already exist
- [x] Store each captured task as a child heading: `** TODO <captured text>`
- [x] Preserve existing source content and heading order; only append to the Tasks subtree
- [x] In server mode, write through `persistSource()` with existing version conflict handling
- [x] In static mode, write through the existing localStorage-backed source path

### UI design

- [x] Overlay should be fixed and visually minimal, with focus placed directly in the input
- [x] Do not show title text, command buttons, destination text, or other controls in the first version
- [x] Show a brief inline error if the source cannot be saved, without losing typed text
- [x] After capture, clear the input and keep focus in the field for the next task
- [x] Do not add another large form; users who need scheduling or tags should capture first, then organize via the existing edit flow

### Implementation

- [x] Add source-edit helper to find or create the Tasks heading and append child TODO entries
- [x] Add focused tests for creating Tasks, appending to existing Tasks, preserving following headings, and escaping heading text safely
- [x] Add overlay state and `q` keyboard shortcut handling in `main.ts`
- [x] Add CSS for the compact fixed overlay
- [x] Add render/main integration tests for opening, capturing, repeated capture, and exit behavior

### Open decisions

- [ ] Decide whether captured text should accept lightweight prefixes later, e.g. `#tag`, `!A`, or `tomorrow`

## This and future operations

Goal: support the Google Calendar-style third option for repeating items: apply a delete or edit from the selected occurrence onward, while keeping earlier occurrences intact.

### Decisions still open

- [x] Confirm the storage model: split into two headings and store an exclusive `:SERIES-UNTIL:` date on the original heading
- [x] Document the final encoding in `ORG-SYNTAX.md`

### Implementation

- [x] Parser: read `:SERIES-UNTIL:` into `seriesUntil: string | null` on `OrgEntry`
- [x] Expansion: stop generating occurrences on/after `seriesUntil`
- [ ] Persistence helper: add `splitSeries(source, entry, baseDate, { mode: "truncate" | "fork"; patch? })`
- [ ] Edit panel: add a "This and future" section with Delete + Change actions
- [ ] Tests: truncation boundary, fork behavior, exception handling after split, parser round-trip

### Edge cases to lock down

- [ ] Decide semantics when splitting at the very first occurrence
- [ ] Decide whether future exceptions are dropped or migrated when a series is split
