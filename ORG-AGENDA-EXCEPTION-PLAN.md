# Plan: Org Agenda Support for Mediant Recurrence Exception Properties

## Goal

Make Emacs Org agenda understand Mediant's recurrence exception properties closely enough that the same `.org` file gives a consistent agenda in Mediant and Org agenda.

The target properties are:

- `:EXCEPTION-YYYY-MM-DD: cancelled`
- `:EXCEPTION-YYYY-MM-DD: shift +45m`
- `:EXCEPTION-YYYY-MM-DD: shift -1h`
- `:EXCEPTION-YYYY-MM-DD: reschedule YYYY-MM-DD`
- `:EXCEPTION-YYYY-MM-DD: reschedule YYYY-MM-DD HH:MM`
- `:EXCEPTION-YYYY-MM-DD: reschedule YYYY-MM-DD HH:MM-HH:MM`
- `:EXCEPTION-NOTE-YYYY-MM-DD: text`
- `:SERIES-UNTIL: YYYY-MM-DD`

The important semantic constraint is that exception keys are based on the unshifted base slot. A recurring item whose base occurrence is `2026-05-11` and is moved to `2026-05-12` must remain keyed as `:EXCEPTION-2026-05-11:`.

## Scope

Implement this as an Emacs Lisp integration layer for Org agenda, not as a change to the Org file format.

The first usable version should:

- Hide cancelled occurrences from Org agenda.
- Move shifted and rescheduled occurrences to their final displayed date/time.
- Show exception notes in agenda entries.
- Stop repeating series at `:SERIES-UNTIL:` using the same exclusive, base-slot semantics as Mediant.
- Leave ordinary Org behavior untouched for entries without these properties.
- Treat exceptions on non-repeating entries as inert.

Out of scope for the first version:

- Editing exception properties from Org agenda.
- A full UI for "this occurrence" edits in Emacs.
- Reimplementing all of Mediant's rendering chips, tag colors, or panel workflows.
- Supporting non-Mediant recurrence grammars beyond Org's existing repeaters.

## Design Direction

Prefer an Org agenda filter/transform package over patching Org internals directly.

The integration should be packaged as a small Emacs Lisp file, for example `mediant-org-agenda.el`, that users can load after Org:

```elisp
(require 'mediant-org-agenda)
(mediant-org-agenda-mode 1)
```

Use Org's existing agenda generation as the base, then adjust agenda lines using marker metadata and heading properties. This keeps the implementation easier to disable and reduces the risk of breaking unrelated Org behavior.

## Data Model

Mirror Mediant's model in Emacs Lisp:

- A parsed exception map keyed by base date string.
- Each exception may have:
  - `override`: nil, `cancelled`, `shift`, or `reschedule`
  - `note`: nil or a string
- `SERIES-UNTIL` is nil or an ISO date string.

Suggested internal shape:

```elisp
(:exceptions
 (("2026-05-04" . (:override (:kind shift :amount 45 :unit minute)
                  :note "Bring mat"))
  ("2026-05-11" . (:override (:kind reschedule
                            :date "2026-05-12"
                            :time "18:00"))))
 :series-until "2026-06-01")
```

Parsing should be strict in the same way Mediant is strict:

- Invalid override values are ignored.
- Notes with empty text are ignored.
- Invalid dates are ignored.
- Unknown property keys are ignored.

## Agenda Integration Strategy

### Phase 1: Read and Parse Properties

Create parser functions:

- `mediant-org-agenda-read-exceptions`
- `mediant-org-agenda-parse-exception-key`
- `mediant-org-agenda-parse-exception-value`
- `mediant-org-agenda-read-series-until`

Use Org property APIs where possible:

- `org-entry-properties`
- `org-entry-get`
- marker position from agenda item metadata

Do not parse arbitrary drawer text manually unless Org property APIs cannot preserve the needed key/value shape.

Acceptance criteria:

- Properties from `:PROPERTIES:` are discovered.
- Properties from other drawers are ignored.
- Override and note properties for the same date are merged.
- Invalid override values do not remove a valid note for the same base date.

### Phase 2: Identify Base Occurrence Dates

Org agenda lines need to be mapped back to the unshifted recurrence slot that produced them.

Implementation options:

1. Prefer agenda text properties or marker metadata if Org exposes the original timestamp/repeater occurrence date.
2. If Org does not expose the base occurrence cleanly, calculate candidate base slots from the heading timestamp and the agenda date range.

The second option needs a bounded recurrence expander in Elisp that matches Mediant's base recurrence behavior for `+Nd`, `+Nw`, `+Nm`, and `+Ny`.

Acceptance criteria:

- A weekly repeating timestamp on `2026-05-04` produces base keys `2026-05-04`, `2026-05-11`, etc.
- Month and leap-year behavior matches Org enough for agenda display, and then gets explicit tests against Mediant's documented behavior.
- Non-repeating timestamps do not apply exceptions.

### Phase 3: Apply `SERIES-UNTIL`

Filter agenda lines whose base slot is at or after `SERIES-UNTIL`.

Rules:

- `SERIES-UNTIL` is exclusive.
- It is evaluated against base slots, not the final moved date.
- A base slot before the cutoff may still be rescheduled to a date after the cutoff.
- On a non-repeating entry, `SERIES-UNTIL` is inert.

Acceptance criteria:

- A series with `:SERIES-UNTIL: 2026-06-01` does not show the `2026-06-01` base occurrence.
- A `2026-05-25` base occurrence rescheduled to `2026-06-02` still appears on `2026-06-02`.
- A `2026-06-01` base occurrence rescheduled backward is ignored because the base slot no longer exists.

### Phase 4: Apply Cancel, Shift, and Reschedule

For each agenda occurrence:

- `cancelled`: remove the agenda line.
- `shift +N/-N`: move the agenda line by the signed duration while preserving interval length.
- `reschedule DATE`: move to the target date, preserving original time if present.
- `reschedule DATE TIME`: move to the target date/time.
- `reschedule DATE START-END`: move to the target date and explicit interval.

There are two possible implementation approaches:

1. Post-process agenda lines after generation.
2. Generate synthetic agenda entries for moved occurrences and suppress the original line.

Use synthetic entries if post-processing cannot move an item across agenda days reliably. Cross-day moves are required behavior.

Acceptance criteria:

- A shifted occurrence that crosses midnight appears on the final day.
- A rescheduled occurrence outside the original agenda day appears on the target day if the target day is in the agenda range.
- The original base occurrence is suppressed for shifted/rescheduled cases.
- Sorting remains consistent with Org agenda's time ordering.

### Phase 5: Show Exception Notes

Display `EXCEPTION-NOTE` text on the affected occurrence.

Options:

- Append a compact suffix to the agenda line.
- Add a second indented note line immediately after the occurrence.
- Add a text property/face so notes can be themed.

Start with a second indented line because it mirrors Mediant's separate instance note and does not overload the title.

Acceptance criteria:

- A note-only exception appears on the base occurrence.
- A shifted/rescheduled occurrence carries its note to the final occurrence.
- A cancelled occurrence with a note is still hidden in v1, unless an explicit debug option is enabled.

### Phase 6: User Options

Add customization variables:

- `mediant-org-agenda-enable-exceptions`
- `mediant-org-agenda-enable-series-until`
- `mediant-org-agenda-show-notes`
- `mediant-org-agenda-note-prefix`
- `mediant-org-agenda-debug`

Defaults should make the agenda match Mediant:

```elisp
(setq mediant-org-agenda-enable-exceptions t)
(setq mediant-org-agenda-enable-series-until t)
(setq mediant-org-agenda-show-notes t)
```

## Test Plan

Use Emacs batch tests with ERT.

Core parser tests:

- Parses `cancelled`.
- Parses positive and negative shifts in minutes, hours, and days.
- Parses reschedule date-only, date+time, and date+range.
- Drops invalid override values.
- Keeps valid notes even if the paired override is invalid.
- Ignores empty notes.
- Ignores properties outside `:PROPERTIES:`.

Agenda behavior tests:

- Cancelled weekly occurrence is absent.
- Shifted occurrence moves within the same day.
- Shifted occurrence moves across midnight in both directions.
- Rescheduled occurrence moves to another day in the agenda window.
- Rescheduled occurrence outside the window is absent from the current view.
- Note-only exception renders a note.
- Shift/reschedule plus note renders the note on the moved occurrence.
- `SERIES-UNTIL` cuts off the exact cutoff date.
- Base slot before `SERIES-UNTIL` can move after the cutoff.
- Exceptions on non-repeating entries are inert.

Interop tests:

- Entries without Mediant properties behave exactly like plain Org agenda.
- DONE/TODO filtering remains Org-controlled.
- Multiple timestamps on one heading do not cross-apply exceptions incorrectly.

## Implementation Milestones

1. Create `mediant-org-agenda.el` with a minor mode and no-op hooks.
2. Add strict property parsing and ERT tests.
3. Implement bounded base-slot expansion for Org repeaters used by Mediant.
4. Implement `SERIES-UNTIL` filtering.
5. Implement cancelled occurrence filtering.
6. Implement same-day shifts/reschedules.
7. Implement cross-day synthetic entries for moved occurrences.
8. Implement note rendering.
9. Add user options and debug logging.
10. Document installation and limitations.

## Risks and Open Questions

- Org agenda internals may not expose enough occurrence metadata to identify base slots without duplicating recurrence expansion.
- Moving an item across days may require synthetic agenda entries rather than mutating generated lines.
- Org's own repeater semantics for `.+` and `++` are completion semantics, not agenda expansion semantics. Mediant currently does not support those in parser syntax except source editing advances existing repeaters when toggling done. The first org-agenda integration should explicitly scope support to Mediant's rendered recurrence behavior.
- Multiple active timestamps on one heading share Mediant's `SERIES-UNTIL`; Org agenda may render them independently. The implementation must keep the base timestamp associated with the correct agenda line.
- Notes on cancelled occurrences are intentionally allowed in Mediant's data model, but hidden in normal agenda display. Decide whether a debug option should surface them.

## Documentation Updates

When implementation starts, update:

- `README.md` with Emacs setup instructions.
- `ORG-SYNTAX.md` interop section to replace "Emacs ignores this" with the new optional integration behavior.
- `AGENTS.md` with the new file, tests, and invariants.

## Done Criteria

The feature is complete when:

- Loading the Emacs Lisp package makes Org agenda respect Mediant recurrence exception properties for the supported grammar.
- Behavior matches Mediant for cancellation, shift, reschedule, notes, and `SERIES-UNTIL`.
- Tests cover parser, recurrence matching, agenda filtering, moved synthetic entries, and notes.
- Existing Org agenda behavior is unchanged when the minor mode is disabled or when entries have no Mediant properties.
