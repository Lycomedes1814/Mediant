# Org Syntax Reference

Detailed account of how Mediant handles Org-mode syntax. Three categories:

1. **Supported** — parsed and used in the agenda
2. **Gracefully ignored** — recognized but silently skipped, will not cause errors
3. **Unsupported** — not recognized; may cause unexpected behavior if present

---

## Supported

### Headings

```org
* Top-level heading
** Second-level heading
*** Third-level (any depth)
```

- Stars at line start followed by a space.
- Heading level is preserved as `level` on the entry.
- Content after the stars is the title (minus tags and TODO state).

### TODO state

```org
** TODO Buy groceries
** DONE Finished task
```

- `TODO` and `DONE` are recognized as state keywords. They must appear immediately after the stars+space.
- Other keywords (WAITING, NEXT, CANCELLED, etc.) are treated as part of the heading title.
- DONE items are parsed fully. In the v1 agenda, they are rendered as dimmed grey in the agenda view.

### Priority cookies

```org
** TODO [#A] Important task
** [#B] Plain heading without TODO
```

- `[#A]`, `[#B]`, `[#C]` immediately after the TODO state (or at the start of the heading remainder if no TODO keyword).
- Parsed into `priority` on the entry (`"A" | "B" | "C" | null`) and stripped from the title.
- Rendered in the agenda as a small colored badge (A = red, B = amber, C = blue) prefixed to the item title.
- Only the letters `A`, `B`, and `C` are recognized. Other letters (e.g. `[#D]`) are treated as part of the title.

### Tags

```org
** Heading text :tag1:
** Heading text :tag1:tag2:tag3:
```

- Colon-delimited at end of heading line.
- Parsed into a string array: `["tag1", "tag2", "tag3"]`.
- Tag inheritance (parent heading tags propagating to children) is **not** supported.

### Active timestamps

```org
<2026-04-07 ti.>
<2026-04-07 ti. 15:15>
<2026-04-07 ti. 15:15-16:00>
<2026-04-07 Sat 12:00>
```

- Angle-bracket delimited.
- Date in `YYYY-MM-DD` format (required).
- Day name after date (any language, with or without trailing dot) — **consumed but ignored**. The date string is authoritative.
- Optional start time in `HH:MM` format.
- Optional end time as `-HH:MM` (time range on the same day).
- Can appear as a standalone line in the entry body, or inline.

### Repeaters

```org
<2026-04-07 ti. 15:15-16:00 +1w>
<2026-04-06 ma. +1y>
<2026-04-08 on. 18:00-21:00 +1w>
```

- Appended inside the timestamp before the closing `>`.
- Format: `+Nunit` where N is a positive integer and unit is one of:
  - `d` — daily
  - `w` — weekly
  - `m` — monthly
  - `y` — yearly
- Only the `+` (cumulate) repeater type is supported. `.+` and `++` repeater types are **not** supported.

### SCHEDULED

```org
SCHEDULED: <2026-04-14 ti. 12:00>
```

- Must appear on the line(s) immediately following a heading.
- The keyword `SCHEDULED:` followed by a space and an active timestamp.
- Produces a planning entry with `kind: "scheduled"`.

### DEADLINE

```org
DEADLINE: <2026-05-05 ti.>
```

- Same rules as SCHEDULED.
- Produces a planning entry with `kind: "deadline"`.

### Checkbox lists

```org
** TODO Grocery list [2/3]
- [X] Milk
- [X] Bread
- [ ] Eggs
```

- Lines matching `- [ ] text` or `- [X] text` inside an entry are parsed as checkbox items.
- Parsed into `checkboxItems` on the entry (array of `{ text, checked }`), not included in body text.
- Indented checkbox items are supported.
- Rendered in the agenda as a mini checklist under the item.
- In the edit panel, checkboxes are interactive toggles that update the Org source.

### Progress cookies

```org
** TODO Task [2/3]
** TODO Task [66%]
```

- `[N/M]` (fractional) or `[N%]` (percentage) after the priority cookie (or heading start).
- Parsed into `progress` on the entry (`{ done, total }` or `null`). For percentage form, stored as `{ done: N, total: 100 }`.
- Stripped from the title.
- Rendered as a small badge next to the title (green when complete, gray otherwise).
- Toggling a checkbox in the edit panel recalculates the progress cookie in the source.

### Body text

```org
** Tur til månen :friluft:
<2026-04-12 Sun 14:00>
Oppmøte Dragvoll.
```

- Any non-blank lines under a heading that aren't planning lines or standalone timestamps.
- Preserved as a string. Shown in the UI as expandable notes.
- A blank line terminates body accumulation.

### Recurrence exceptions

Two property-drawer key families let an entry with a repeating timestamp deviate from the base series on a single occurrence. Both are keyed by the *unshifted* base occurrence date (`YYYY-MM-DD`) so the mapping stays stable even after a reschedule.

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

- `:EXCEPTION-YYYY-MM-DD: <override>` — the behaviour override for a single occurrence. At most one per date. Override grammar (exact match; anything else is dropped silently):
  - `cancelled` — occurrence is skipped entirely.
  - `shift <[+-]N><m|h|d>` — shift the whole interval by a signed duration (`shift +45m`, `shift -1h`, `shift +1d`). If the shift crosses midnight, the occurrence's final calendar day moves with it; `:EXCEPTION-<date>:` still keys off the unshifted slot.
  - `reschedule YYYY-MM-DD` — move to a new date, preserving base start/end.
  - `reschedule YYYY-MM-DD HH:MM` — new date + new start; base duration preserved when base has an end time; otherwise no end time.
  - `reschedule YYYY-MM-DD HH:MM-HH:MM` — new date + explicit range.
- `:EXCEPTION-NOTE-YYYY-MM-DD: <text>` — a one-off note attached to the occurrence with the matching base date. Empty text is treated as no note. Independent of any override on the same date, so you can combine e.g. a shift with a note.
- All other property keys inside the drawer are still **gracefully ignored** — only `EXCEPTION-…` and `EXCEPTION-NOTE-…` keys are read. Exception properties inside other drawers (e.g. LOGBOOK) are not parsed.
- Exceptions on a non-repeating timestamp are parsed but **inert**: expansion never runs, so they never apply. Don't rely on this as a way to rewrite a one-off; edit the timestamp instead.

---

## Gracefully ignored

These constructs are recognized and silently skipped. They will not produce entries, cause parse errors, or corrupt adjacent entries.

### File-level keywords

```org
#+title: Org Inbox
#+startup: show2levels
#+author: Name
#+options: toc:nil
```

- Any line starting with `#+` before or between headings.

### Inactive timestamps

```org
[2026-04-07 ti. 15:15-16:00]
```

- Square-bracket timestamps. Recognized by the parser but not added to any entry's timestamps. They do not generate agenda items.

### Timestamp ranges (spanning days)

```org
<2026-04-07 ti.>--<2026-04-09 to.>
```

- Two timestamps connected by `--`. Recognized but **not** supported in v1. The line is treated as body text.

### Property drawers

```org
:PROPERTIES:
:CATEGORY: work
:END:
```

- Everything between `:PROPERTIES:` and `:END:` is skipped **except** `:EXCEPTION-…:` and `:EXCEPTION-NOTE-…:` keys, which are read as per-occurrence exceptions. See the Recurrence exceptions section above.

### Logbook drawers

```org
:LOGBOOK:
CLOCK: [2026-04-07 ti. 10:00]--[2026-04-07 ti. 11:30] =>  1:30
:END:
```

- Everything between `:LOGBOOK:` and `:END:` is skipped.

### Generic drawers

```org
:DRAWERNAME:
...
:END:
```

- Any `:NAME:` ... `:END:` block is skipped.

### CLOSED planning

```org
CLOSED: [2026-04-07 ti. 14:00]
```

- Recognized as a planning keyword but not stored.

### Org links

```org
[[https://example.com][Example]]
[[file:other.org]]
```

- If they appear in body text, the raw text is preserved. No special link handling.

### Inline markup

```org
*bold* /italic/ ~code~ =verbatim= +strikethrough+
```

- Preserved as-is in body text. No rendering of markup in v1.

### Lists (plain)

```org
- Item one
- Item two
  - Nested item
1. Ordered item
```

- Plain list items (without checkbox syntax) are treated as body text. No special list handling.
- Checkbox list items (`- [ ]` / `- [X]`) are **supported** — see the Checkbox lists section above.

### Tables

```org
| Col1 | Col2 |
|------+------|
| a    | b    |
```

- Treated as body text.

### Comments

```org
# This is a comment
#+begin_comment
Block comment
#+end_comment
```

- Lines starting with `# ` are ignored.
- Comment blocks are ignored.

### Source/example blocks

```org
#+begin_src python
print("hello")
#+end_src
```

- Block content treated as body text. No syntax highlighting.

---

## Unsupported (may cause unexpected behavior)

These constructs are **not recognized** by the parser. If present, they may be misinterpreted (e.g., treated as body text when they shouldn't be, or partially parsed incorrectly).

### `.+` and `++` repeater types

```org
<2026-04-07 ti. .+1w>
<2026-04-07 ti. ++1w>
```

- Only `+` repeaters are supported. `.+` and `++` will not be parsed as repeaters — the timestamp will be treated as non-repeating.

### Diary sexp timestamps

```org
<%%(diary-float t 1 2)>
```

- Not recognized. Will be treated as body text.

### Custom TODO keyword sequences

```org
#+TODO: TODO NEXT WAITING | DONE CANCELLED
** NEXT Some task
** WAITING Blocked task
```

- `#+TODO:` keyword definitions are ignored.
- Keywords other than `TODO` and `DONE` (e.g., NEXT, WAITING, CANCELLED) are treated as part of the heading title.
- State transition logging, timestamps on state changes, and workflow logic are not supported.

### Tag inheritance

```org
* Project :work:
** Task one
```

- `Task one` does **not** inherit the `:work:` tag from its parent. Only tags explicitly on the heading line are parsed.

### Column view / custom agenda commands

- Not applicable — this is a standalone viewer, not an Emacs extension.

### Babel / tangling

- Not applicable.

### Archiving (`ARCHIVE` tag, archive files)

- The `ARCHIVE` tag is parsed like any other tag but has no special behavior.
- Archive files (`.org_archive`) are not loaded.

### Effort estimates

```org
:Effort: 1:30
```

- Part of property drawers, which are ignored.

### Habits

```org
:STYLE: habit
```

- Not supported. The property drawer is ignored.
