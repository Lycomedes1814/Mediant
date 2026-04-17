# Feature ideas

## General
- [ ] Multilingual support
- [ ] Filter by tags
- [ ] Month view
- [ ] Toggle hiding empty days (useful with filters)

## Subtasks / checkbox lists
- [ ] **Parser**: recognize checkbox list items (`- [ ]` / `- [X]`) as structured data
  - Add `CheckboxItem` type to `model.ts`: `{ text: string; checked: boolean }`
  - Add `checkboxItems: readonly CheckboxItem[]` field to `OrgEntry`
  - In `parser.ts`, detect lines matching `^\s*-\s+\[([ X])\]\s+(.+)` inside an entry
  - Capture them into `checkboxItems` instead of appending to `body`
  - Preserve ordering from the source file
- [ ] **Parser**: extract progress cookie (`[2/3]` or `[66%]`) from heading title
  - Add `progress: { done: number; total: number } | null` field to `OrgEntry`
  - In `parseHeading()`, match `\[(\d+)/(\d+)\]` or `\[(\d+)%\]` after priority cookie
  - Remove the cookie from `entry.title` (like we do for priority/tags/timestamps)
  - For `[66%]` form, store as `{ done: 66, total: 100 }` (percentage-based)
- [ ] **Agenda**: pass `checkboxItems` and `progress` through to `AgendaItem`
  - These fields flow from `OrgEntry` via the existing `entry` reference — no agenda model changes needed
- [ ] **UI render**: render checkbox items under the item, styled as a mini checklist
  - After the existing body-text block in `renderTimedItem` / similar renderers
  - Each item: small checkbox icon (checked/unchecked) + text label
  - Checked items get `opacity: 0.55` + `line-through` (matching DONE style)
  - Indent slightly from the item title
- [ ] **UI render**: render progress cookie as a badge in the item title
  - Small `[2/3]` badge next to the title, styled like priority badges
  - Color: green when complete, neutral/gray otherwise
  - Use fractional form (`2/3`) regardless of source format
- [ ] **Edit panel**: support viewing/toggling checkbox items
  - Show checkboxes in the edit panel as interactive toggles
  - Toggling updates the Org source (`[ ]` ↔ `[X]`) and recalculates the progress cookie
  - Persist changes via `persistSource()`
- [ ] **Tests**: parser tests for checkbox items and progress cookies
  - Checkbox parsing: basic, mixed checked/unchecked, no checkboxes, nested (ignored)
  - Progress cookie: `[2/3]` form, `[66%]` form, no cookie, cookie without checkboxes
  - Round-trip: parse → edit checkbox → re-serialize produces valid Org
- [ ] **ORG-SYNTAX.md**: update the Lists section to document checkbox support

## Add/edit item UI
- [X] Select from existing tags or add new
- [X] Select priority (none, A, B, C)
- [ ] Multi-timestamp awareness
