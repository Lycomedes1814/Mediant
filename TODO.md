# Feature ideas

## General
- [ ] Multilingual support
- [ ] Filter by tags
- [ ] Month view
- [ ] Toggle hiding empty days (useful with filters)

## Recurring task exceptions

Goal: keep the current `+1d/w/m/y` repeater syntax, but allow per-occurrence deviations (skip a week, shift the time, reschedule to a different date, attach a one-off note). Deviations live in the entry's property drawer, keyed by the base (unshifted) occurrence date, so the base recurrence and the set of overrides are both stored with the heading and survive round-trips.

### Design decisions

- **Shift affects only the one instance** — never cascades forward. The Org repeater remains the authoritative source of the series. "From here onward" is deliberately out of scope; if that need appears later, it gets its own explicit operation.
- **Applies uniformly to SCHEDULED, DEADLINE, and active repeating timestamps.** Engine-level symmetry; the UI may choose to present them differently, but parser/expansion/classification treat them the same.
- **Override and note are separated in the model.** `cancelled`/`shift`/`reschedule` are behaviour; `note` is metadata. A single occurrence can carry both (e.g. shift + note, or cancelled + note). No `;`-separated mini-language — use two property families instead.
- **Base-date identity.** The property key is the *unshifted* base occurrence date. A rescheduled instance still keys off its original slot, so the mapping stays stable no matter how far the user walks forward in time.

### Storage syntax

Two property families in the standard properties drawer. One property per date per family.

```org
** TODO Yoga :health:
SCHEDULED: <2026-04-27 ma. 17:00-18:00 +1w>
:PROPERTIES:
:EXCEPTION-2026-04-27: cancelled
:EXCEPTION-2026-05-04: shift +45m
:EXCEPTION-NOTE-2026-05-04: Bring mat and water
:EXCEPTION-2026-05-11: reschedule 2026-05-12 18:00
:EXCEPTION-NOTE-2026-05-18: Long session today
:END:
```

- `:EXCEPTION-YYYY-MM-DD: <override>` — at most one per date. Override grammar:
  - `cancelled` — occurrence skipped entirely.
  - `shift <[+-]N><m|h|d>` — shift the whole interval (start, and end if present) by a signed duration. Midnight crossing is first-class: if the shifted start/end lands on another calendar day, classification follows the new date.
  - `reschedule YYYY-MM-DD` — move to a new date, preserving base start/end fully.
  - `reschedule YYYY-MM-DD HH:MM` — new date + new start; if base had an end time, preserve base duration; otherwise no end time.
  - `reschedule YYYY-MM-DD HH:MM-HH:MM` — new date + explicit range.
- `:EXCEPTION-NOTE-YYYY-MM-DD: <text>` — one-off note attached to the occurrence with the matching base date. Empty text is treated as no note. Independent of whether an override exists for the same date.
- Malformed values are dropped silently (tolerant-parser principle). Invalid override (e.g. reschedule with a nonsense time range) drops the whole override, not a half-parse.

### Data model

```ts
type RecurrenceOverride =
  | { kind: "cancelled" }
  | { kind: "shift"; offsetMinutes: number }
  | { kind: "reschedule"; date: string; startTime: string | null; endTime: string | null };

type RecurrenceException = {
  override: RecurrenceOverride | null;
  note: string | null;
};
```

Empty/absent exception is `{ override: null, note: null }` (or just absent from the map).

### Tasks

- [X] **Model**: extend `OrgEntry` with a per-entry exception map
  - Add `RecurrenceOverride` and `RecurrenceException` to `src/org/model.ts` as above
  - Add `exceptions: ReadonlyMap<string, RecurrenceException>` on `OrgEntry` (key = base date `YYYY-MM-DD`)
  - Empty map (not `null`) when there are no exceptions, to keep call sites branch-free
- [X] **Parser**: read exception properties from property drawers
  - Drawers remain skipped as body, but inside a real `:PROPERTIES: … :END:` block, scan two key shapes:
    - `/^:EXCEPTION-(\d{4}-\d{2}-\d{2}):\s*(.*?)\s*$/` → `override` for that date
    - `/^:EXCEPTION-NOTE-(\d{4}-\d{2}-\d{2}):\s*(.*?)\s*$/` → `note` for that date
  - `parseOverride(raw): RecurrenceOverride | null` accepts exactly: `cancelled`; `shift [+-]\d+(m|h|d)`; `reschedule YYYY-MM-DD`; `reschedule YYYY-MM-DD HH:MM`; `reschedule YYYY-MM-DD HH:MM-HH:MM`. Anything else → `null`.
  - Merge override + note entries for the same date into a single `RecurrenceException`.
  - All other property keys remain ignored; other drawer kinds (LOGBOOK, generic) stay fully skipped.
- [X] **Expansion**: apply exceptions in `expandRecurrences()` (implemented as `expandOccurrences()`)
  - After generating each base occurrence, look up `entry.exceptions.get(baseDate)`
  - `cancelled` → drop the occurrence (even if a note is present; note only surfaces in the edit panel for that slot)
  - `shift` → adjust start and (if present) end by `offsetMinutes`; handle midnight rollover explicitly, including negative shifts that cross backward
  - `reschedule` → replace date and (per rules above) time on the expanded occurrence; if the new date falls outside the requested range, drop it from this page
  - Note (with no cancelled override) attaches to the occurrence at its final date/time
  - Keep `baseDate: string` and `baseStartMinutes: number | null` on the expanded occurrence so agenda/edit can label the original slot and round-trip to the property key
- [X] **Classification**: rescheduled and shifted occurrences keep the original entry's TODO state, tags, priority, and identity, and are classified by their *new* date/time. Collisions with another base occurrence on the same day are allowed — render both, don't merge.
- [X] **Agenda model**: thread exception metadata through as *structured* data, not pre-formatted strings
  - `AgendaItem` gains:
    ```ts
    baseDate: string | null;
    baseStartMinutes: number | null;
    instanceNote: string | null;
    override: { kind: "shift" | "reschedule"; detail: string } | null;
    ```
  - `detail` is raw (e.g. `"+45m"`, `"from 2026-05-11"`) — the renderer composes chip text and tooltip from `kind` + `detail`.
  - `cancelled` never reaches the agenda (filtered during expansion), so no enum value for it here.
- [X] **UI render**: show instance-level overrides unobtrusively
  - Small muted chip next to the time: `shifted` / `moved`, with the `detail` as tooltip/aria-label
  - Instance notes render under the item like a one-line body snippet, styled close to checkbox items but without the checkbox glyph
  - Cancelled occurrences are absent by construction; no render work needed
- [X] **Edit panel**: manage exceptions for a single occurrence
  - Language: **"This occurrence"** and **"Series"** (not "All occurrences")
  - Actions in the "This occurrence" section: Skip / Shift time / Reschedule / Add note / Clear override / Clear note
  - Panel surfaces the base date and current override state ("Skipped" / "Shifted +45m" / "Moved to …") so it's obvious which slot the write keys off
  - Follow-up: expose cancelled occurrences' notes on the series view (they don't render in the agenda, so there's currently no entry point to read/edit them once cancelled)
  - Writes go through the drawer helpers; "Series" edits continue to rewrite the base heading/timestamp as today
- [X] **Persistence helpers**: small drawer utilities in `src/org/` (not inside the parser)
  - `upsertProperty(source, entry, key, value)` and `removeProperty(source, entry, key)` operating on the raw Org text
  - **Preserve existing drawer format**: don't sort keys, don't reformat, only mutate the single targeted line
  - **Deterministic placement** when no drawer exists: insert `:PROPERTIES: … :END:` immediately after the last planning/timestamp line and before body text
  - **Remove empty drawer** when the last property line is cleared
  - Idempotent: writing the same value is a no-op; key order preserved for stable diffs
- [X] **Tests**: parser, expansion, helpers, round-trip
  - Parser: each override kind, note-only, override + note on same date, malformed override dropped (note preserved), empty note treated as absent, invalid reschedule range dropped, mixed with other property keys, LOGBOOK drawer unaffected
  - Expansion: cancelled within range; shift across midnight (forward and backward); reschedule that lands outside the page; reschedule that collides with another base occurrence (both present); note attaches to the final expanded occurrence; cancelled + note suppresses render
  - Classification: rescheduled item lands on the new day's card with original tags/priority/TODO
  - Helpers: upsert into existing drawer preserves order and other keys; upsert creates drawer in the correct position; remove of last key drops the drawer; repeat upsert is a no-op diff
  - Round-trip: add override via helper → parse → re-expand produces the expected occurrence
- [X] **ORG-SYNTAX.md**: promote property drawers from "gracefully ignored" to partially supported
  - Document the two key families, override grammar, and note semantics
  - Keep the note that all other property keys remain ignored

### Edge cases to lock in

- Rescheduling into the slot of another base occurrence is allowed — render both, never merge.
- Cancelled + note: permitted; note is visible only in the edit panel (since the row isn't rendered).
- Empty note (`:EXCEPTION-NOTE-…:` with nothing after): treat as no note.
- Invalid override value: drop the whole override for that date, keep the note if present.
- Shift that crosses midnight: classification follows the new calendar day; the property key stays at the base date.
- Entry with no repeater: exception properties are **parsed but inert** — `entry.exceptions` is still populated, but expansion never runs, so they never surface. Document this intent in a comment on the parser helper so a future reader doesn't mistake it for a bug and "fix" it by applying the map to the single timestamp.

## Subtasks / checkbox lists
- [X] **Parser**: recognize checkbox list items (`- [ ]` / `- [X]`) as structured data
  - Add `CheckboxItem` type to `model.ts`: `{ text: string; checked: boolean }`
  - Add `checkboxItems: readonly CheckboxItem[]` field to `OrgEntry`
  - In `parser.ts`, detect lines matching `^\s*-\s+\[([ X])\]\s+(.+)` inside an entry
  - Capture them into `checkboxItems` instead of appending to `body`
  - Preserve ordering from the source file
- [X] **Parser**: extract progress cookie (`[2/3]` or `[66%]`) from heading title
  - Add `progress: { done: number; total: number } | null` field to `OrgEntry`
  - In `parseHeading()`, match `\[(\d+)/(\d+)\]` or `\[(\d+)%\]` after priority cookie
  - Remove the cookie from `entry.title` (like we do for priority/tags/timestamps)
  - For `[66%]` form, store as `{ done: 66, total: 100 }` (percentage-based)
- [X] **Agenda**: pass `checkboxItems` and `progress` through to `AgendaItem`
  - These fields flow from `OrgEntry` via the existing `entry` reference — no agenda model changes needed
- [X] **UI render**: render checkbox items under the item, styled as a mini checklist
  - After the existing body-text block in `renderTimedItem` / similar renderers
  - Each item: small checkbox icon (checked/unchecked) + text label
  - Checked items get `opacity: 0.55` + `line-through` (matching DONE style)
  - Indent slightly from the item title
- [X] **UI render**: render progress cookie as a badge in the item title
  - Small `[2/3]` badge next to the title, styled like priority badges
  - Color: green when complete, neutral/gray otherwise
  - Use fractional form (`2/3`) regardless of source format
- [X] **Edit panel**: support viewing/toggling checkbox items
  - Show checkboxes in the edit panel as interactive toggles
  - Toggling updates the Org source (`[ ]` ↔ `[X]`) and recalculates the progress cookie
  - Persist changes via `persistSource()`
- [X] **Tests**: parser tests for checkbox items and progress cookies
  - Checkbox parsing: basic, mixed checked/unchecked, no checkboxes, nested (ignored)
  - Progress cookie: `[2/3]` form, `[66%]` form, no cookie, cookie without checkboxes
  - Round-trip: parse → edit checkbox → re-serialize produces valid Org
- [X] **ORG-SYNTAX.md**: update the Lists section to document checkbox support

## Add/edit item UI
- [X] Select from existing tags or add new
- [X] Select priority (none, A, B, C)
- [X] Multi-timestamp awareness
