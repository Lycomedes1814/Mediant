# TODO

## General
- [ ] Multilingual support
- [ ] Month view
- [x] Toggle hiding empty days (useful with filters)
- [ ] Mobile notifications
- [ ] Quick-capture popup for inbox tasks
- [ ] ICS import/export
- [ ] Subscribe to ICS URLs
- [ ] Serve ICS endpoint
- [ ] Time-grid view
- [ ] Toggle inline display/editing of subtasks

## Quick-capture popup

Goal: provide a low-friction way to fire off tasks immediately, without forcing the user to classify, schedule, tag, or edit full Org details in the moment. Captured items should land in a predictable inbox area and be easy to organize later.

### Product shape

- [ ] Add a compact popup opened by keyboard shortcut and toolbar button
- [ ] Keep the primary interaction to one text field and Enter-to-capture
- [ ] Support multiline notes only through an explicit expand affordance, not by default
- [ ] Default every capture to an undated `TODO` heading so it appears in Someday until organized
- [ ] Preserve fast repeated entry: after a successful capture, clear the field and keep the popup open
- [ ] Provide Escape to close, Cmd/Ctrl+Enter to capture and close, and regular Enter to capture
- [ ] Avoid date parsing, tags, priorities, and checklist editing in the first version; the edit panel remains the organizing surface

### Org storage

- [ ] Append captures under a dedicated top-level `* Inbox` heading
- [ ] Create `* Inbox` at the end of the source if it does not already exist
- [ ] Store each captured task as a child heading: `** TODO <captured text>`
- [ ] Preserve existing source content and heading order; only append to the Inbox subtree
- [ ] In server mode, write through `persistSource()` with existing version conflict handling
- [ ] In static mode, write through the existing localStorage-backed source path

### UI design

- [ ] Popup should be modal-light: fixed overlay, centered compact panel on desktop, bottom sheet on narrow screens
- [ ] Use title text `Quick capture`, a single input, and two icon buttons: capture and close
- [ ] Include a subdued destination line such as `Inbox` so users know where the item went
- [ ] Show a brief inline error if the source cannot be saved, without losing typed text
- [ ] After capture, show a short success state in place, then return focus to the input
- [ ] Do not add another large form; users who need scheduling or tags should capture first, then organize via the existing edit flow

### Implementation

- [ ] Add source-edit helper to find or create the Inbox heading and append child TODO entries
- [ ] Add focused tests for creating Inbox, appending to existing Inbox, preserving following headings, and escaping heading text safely
- [ ] Add popup state and keyboard shortcut handling in `main.ts`
- [ ] Add rendering hooks in the agenda toolbar for the quick-capture button
- [ ] Add CSS for the compact popup and mobile bottom-sheet layout
- [ ] Add render/main integration tests for opening, capturing, repeated capture, and save failure

### Open decisions

- [ ] Decide shortcut key; candidate: `q` because `a` already opens the full add-item panel
- [ ] Decide whether Inbox should be hidden from agenda day sections if future versions allow dated quick captures
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
