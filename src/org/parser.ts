/**
 * Line-by-line Org file parser.
 *
 * Detects Org constructs (headings, planning lines, timestamps, body text)
 * and assembles OrgEntry objects. All timestamp parsing is delegated to
 * timestamp.ts — this module never interprets timestamp internals.
 *
 * Produces a flat OrgEntry[] — no tree structure. Heading level is
 * preserved as metadata on each entry.
 *
 * ── Body representation ──────────────────────────────────────────────
 *
 * Body text is stored as a single string. Multiple lines are joined
 * with "\n". Leading whitespace on each line is trimmed (trimStart).
 * An entry with no body text has body === "".
 *
 * ── Timestamp capture rules ──────────────────────────────────────────
 *
 * Active timestamps are captured in three contexts:
 *   1. Inline in headings — extracted from the title text, added to
 *      entry.timestamps, and removed from entry.title.
 *   2. Timestamp-only body lines — lines whose content is nothing but
 *      one or more active timestamps (and whitespace). These are added
 *      to entry.timestamps and NOT included in body text.
 *   3. Mixed prose + timestamp — a body line that contains both prose
 *      and an active timestamp is treated as body text in v1. The
 *      timestamp is NOT extracted into entry.timestamps.
 *
 * ── Skipped constructs ───────────────────────────────────────────────
 *
 * The following are intentionally ignored (not preserved as body text):
 *   - File-level keywords (#+ lines): #+title, #+startup, etc.
 *     These are Org metadata, not entry content. Ignored both at
 *     file level and if they appear inside an entry.
 *   - Comment lines (# followed by a space): Org comments are
 *     author-facing notes, not entry content.
 *   - Drawers: any :UPPERCASENAME:...:END: block is skipped entirely.
 *     This covers :PROPERTIES:, :LOGBOOK:, and any other drawer.
 *     We skip all uppercase-named drawers rather than enumerating
 *     specific ones, because Org allows user-defined drawers and we
 *     want to avoid treating drawer syntax as body text.
 */

import type {
  CheckboxItem,
  OrgEntry,
  OrgPlanning,
  Priority,
  RecurrenceException,
  RecurrenceOverride,
  TodoState,
} from "./model.ts";
import type { OrgTimestamp } from "./timestamp.ts";
import { parseTimestamps, TIMESTAMP_RE } from "./timestamp.ts";

// ── Regexes ──────────────────────────────────────────────────────────

/** Matches a heading line. Groups: 1=stars, 2=TODO/DONE keyword (optional), 3=title+tags remainder */
const HEADING_RE = /^(\*+)\s+((?:TODO|DONE)\s+)?(.+)$/;

/** Matches tags at the end of a heading title. Group 1 = full tag string including colons. */
const TAGS_RE = /\s+(:[\p{L}a-zA-Z0-9_@]+(?::[\p{L}a-zA-Z0-9_@]+)*:)\s*$/u;

/** Matches a priority cookie at the start of a heading remainder. Group 1 = letter. */
const PRIORITY_RE = /^\[#([A-C])\]\s*/;

/** Matches a line that begins with a planning keyword. */
const PLANNING_LINE_RE = /^\s*(?:SCHEDULED|DEADLINE):/;

/**
 * Matches each "SCHEDULED: <ts>" / "DEADLINE: <ts>" pair on a planning line.
 * Org writes both on the same line, space-separated, so a single line may
 * contribute multiple planning entries.
 */
const PLANNING_PAIR_RE = /(SCHEDULED|DEADLINE):\s*(<[^>]*>)/g;

/** Matches lines that are entirely a drawer boundary. Group 1 = drawer name. */
const DRAWER_OPEN_RE = /^\s*:([A-Z_]+):\s*$/;
const DRAWER_CLOSE_RE = /^\s*:END:\s*$/;

/** Per-occurrence override property: `:EXCEPTION-YYYY-MM-DD: <value>`. */
const EXCEPTION_KEY_RE = /^\s*:EXCEPTION-(\d{4}-\d{2}-\d{2}):\s*(.*?)\s*$/;

/** Per-occurrence note property: `:EXCEPTION-NOTE-YYYY-MM-DD: <text>`. */
const EXCEPTION_NOTE_KEY_RE = /^\s*:EXCEPTION-NOTE-(\d{4}-\d{2}-\d{2}):\s*(.*?)\s*$/;

/** Series end property: `:SERIES-UNTIL: YYYY-MM-DD` (exclusive). */
const SERIES_UNTIL_KEY_RE = /^\s*:SERIES-UNTIL:\s*(\d{4}-\d{2}-\d{2})\s*$/;

/** Override grammars (matched against the trimmed value after the property key). */
const OVERRIDE_CANCELLED_RE = /^cancelled$/;
const OVERRIDE_SHIFT_RE = /^shift\s+([+-]\d+)([mhd])$/;
const OVERRIDE_RESCHEDULE_RE =
  /^reschedule\s+(\d{4}-\d{2}-\d{2})(?:\s+(\d{2}:\d{2})(?:-(\d{2}:\d{2}))?)?$/;

/** File-level keyword lines (#+title:, #+startup:, etc.) */
const KEYWORD_RE = /^\s*#\+/;

/** Comment lines */
const COMMENT_RE = /^\s*#\s/;

/** Matches a checkbox list item. Groups: 1=checked marker (" " or "X"), 2=text */
const CHECKBOX_RE = /^\s*-\s+\[([ X])\]\s+(.+)/;

/** Matches a progress cookie in a heading. Groups: 1=done, 2=total (fractional) or 1=percent (percentage) */
const PROGRESS_FRAC_RE = /\[(\d+)\/(\d+)\]/;
const PROGRESS_PCT_RE = /\[(\d+)%\]/;

// ── Parser ───────────────────────────────────────────────────────────

/**
 * Parse an Org file into a flat list of entries.
 *
 * Lines before the first heading (file keywords, blank lines) are ignored.
 * Drawer contents (:PROPERTIES:...:END:, :LOGBOOK:...:END:) are skipped.
 * Unknown constructs are treated as body text.
 */
export function parseOrg(source: string): OrgEntry[] {
  const lines = source.split("\n");
  const entries: OrgEntry[] = [];

  let current: MutableEntry | null = null;
  let acceptPlanning = false;
  // null = not in a drawer; otherwise the drawer's uppercase name (e.g. "PROPERTIES", "LOGBOOK").
  let drawerKind: string | null = null;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const lineNumber = i + 1; // 1-based

    // Inside a drawer: either close it, or (for PROPERTIES) pluck exception keys.
    // All other drawer contents are skipped as today.
    if (drawerKind !== null) {
      if (DRAWER_CLOSE_RE.test(line)) {
        drawerKind = null;
        continue;
      }
      if (drawerKind === "PROPERTIES" && current) {
        absorbPropertyLine(line, current);
      }
      continue;
    }

    // Check for drawer open (only within an entry)
    if (current) {
      const drawerOpen = line.match(DRAWER_OPEN_RE);
      if (drawerOpen) {
        drawerKind = drawerOpen[1];
        acceptPlanning = false;
        continue;
      }
    }

    // Heading line — starts a new entry
    const headingMatch = line.match(HEADING_RE);
    if (headingMatch) {
      if (current) {
        entries.push(finalizeEntry(current));
      }
      current = parseHeading(headingMatch, lineNumber);
      acceptPlanning = true;
      continue;
    }

    // No current entry — skip file-level lines
    if (!current) {
      continue;
    }

    // Planning line (SCHEDULED/DEADLINE) — only accepted immediately after heading.
    // Org writes both keywords on the same line, space-separated:
    //   "DEADLINE: <ts1> SCHEDULED: <ts2>"
    // so iterate every "KIND: <ts>" pair on the line.
    if (acceptPlanning && PLANNING_LINE_RE.test(line)) {
      for (const pm of line.matchAll(PLANNING_PAIR_RE)) {
        const kind = pm[1].toLowerCase() as OrgPlanning["kind"];
        const timestamps = parseTimestamps(pm[2]);
        if (timestamps.length > 0) {
          current.planning.push({ kind, timestamp: timestamps[0] });
        }
      }
      continue;
    }

    // Once we see a non-planning line, stop accepting planning
    acceptPlanning = false;

    // Skip file-level keywords and comments that appear mid-file
    if (KEYWORD_RE.test(line) || COMMENT_RE.test(line)) {
      continue;
    }

    // Blank line — terminates body accumulation
    if (line.trim() === "") {
      continue;
    }

    // Check if the line is a checkbox item
    const checkboxMatch = line.match(CHECKBOX_RE);
    if (checkboxMatch) {
      current.checkboxItems.push({
        text: checkboxMatch[2],
        checked: checkboxMatch[1] === "X",
      });
      continue;
    }

    // Check if the line is solely an active timestamp
    const lineTimestamps = parseTimestamps(line);
    if (lineTimestamps.length > 0 && isTimestampOnlyLine(line)) {
      for (const ts of lineTimestamps) {
        current.timestamps.push(ts);
      }
      continue;
    }

    // Body text — any remaining non-blank line
    if (current.body.length > 0) {
      current.body += "\n";
    }
    current.body += line.trimStart();
  }

  // Finalize last entry
  if (current) {
    entries.push(finalizeEntry(current));
  }

  return entries;
}

// ── Helpers ──────────────────────────────────────────────────────────

/** Mutable working state while building an entry. */
interface MutableEntry {
  level: number;
  todo: TodoState;
  priority: Priority;
  title: string;
  tags: string[];
  planning: OrgPlanning[];
  timestamps: OrgTimestamp[];
  checkboxItems: CheckboxItem[];
  progress: { done: number; total: number } | null;
  body: string;
  sourceLineNumber: number;
  exceptions: Map<string, MutableException>;
  seriesUntil: string | null;
}

/** Mutable exception accumulator — override and note may arrive in either order. */
interface MutableException {
  override: RecurrenceOverride | null;
  note: string | null;
}

function parseHeading(match: RegExpMatchArray, lineNumber: number): MutableEntry {
  const level = match[1].length;
  const todoRaw = match[2]?.trim() ?? null;
  const todo: TodoState = todoRaw === "TODO" || todoRaw === "DONE" ? todoRaw : null;

  let remainder = match[3];

  // Extract priority cookie ([#A]/[#B]/[#C]) at the start of the remainder
  let priority: Priority = null;
  const priorityMatch = remainder.match(PRIORITY_RE);
  if (priorityMatch) {
    priority = priorityMatch[1] as Priority;
    remainder = remainder.slice(priorityMatch[0].length);
  }

  // Extract tags from the end of the title
  const tags: string[] = [];
  const tagsMatch = remainder.match(TAGS_RE);
  if (tagsMatch) {
    const tagString = tagsMatch[1];
    // Split ":tag1:tag2:" → ["tag1", "tag2"]
    for (const t of tagString.split(":")) {
      if (t.length > 0) {
        tags.push(t);
      }
    }
    remainder = remainder.slice(0, -tagsMatch[0].length);
  }

  // Extract progress cookie ([2/3] or [66%]) from the remainder
  let progress: { done: number; total: number } | null = null;
  const fracMatch = remainder.match(PROGRESS_FRAC_RE);
  if (fracMatch) {
    progress = { done: Number(fracMatch[1]), total: Number(fracMatch[2]) };
    remainder = remainder.replace(fracMatch[0], "").replace(/\s{2,}/g, " ").trim();
  } else {
    const pctMatch = remainder.match(PROGRESS_PCT_RE);
    if (pctMatch) {
      progress = { done: Number(pctMatch[1]), total: 100 };
      remainder = remainder.replace(pctMatch[0], "").replace(/\s{2,}/g, " ").trim();
    }
  }

  // Extract any inline timestamps from the title
  const inlineTimestamps = parseTimestamps(remainder);
  const title = remainder.replace(new RegExp(TIMESTAMP_RE.source, "g"), "").trim();

  return {
    level,
    todo,
    priority,
    title,
    tags,
    planning: [],
    timestamps: inlineTimestamps,
    checkboxItems: [],
    progress,
    body: "",
    sourceLineNumber: lineNumber,
    exceptions: new Map(),
    seriesUntil: null,
  };
}

/**
 * Check if a line consists solely of active timestamp(s) and whitespace.
 * Strip all timestamp matches and see if only whitespace remains.
 */
function isTimestampOnlyLine(line: string): boolean {
  const stripped = line.replace(new RegExp(TIMESTAMP_RE.source, "g"), "");
  return stripped.trim() === "";
}

/**
 * Pluck the Mediant-specific property keys out of a PROPERTIES drawer
 * line:
 *
 *   - `:EXCEPTION-<date>:` / `:EXCEPTION-NOTE-<date>:` — merged into
 *     the entry's exception map. Malformed override values are silently
 *     dropped (note for the same date, if any, is preserved). Empty
 *     notes are treated as absent.
 *   - `:SERIES-UNTIL:` — stored as `seriesUntil` (exclusive end date).
 *     Malformed values are silently dropped.
 *
 * All other property keys are ignored, per the documented extension
 * contract. Also runs on entries that have no repeating timestamp —
 * both fields are parsed but never applied in that case, matching the
 * "parsed but inert" invariant documented on `OrgEntry.exceptions` and
 * `OrgEntry.seriesUntil`.
 */
function absorbPropertyLine(line: string, current: MutableEntry): void {
  const noteMatch = line.match(EXCEPTION_NOTE_KEY_RE);
  if (noteMatch) {
    const date = noteMatch[1];
    const text = noteMatch[2].trim();
    if (text.length === 0) return; // empty note → absent
    const ex = current.exceptions.get(date) ?? { override: null, note: null };
    ex.note = text;
    current.exceptions.set(date, ex);
    return;
  }

  const overrideMatch = line.match(EXCEPTION_KEY_RE);
  if (overrideMatch) {
    const override = parseOverride(overrideMatch[2]);
    if (override === null) return; // malformed → drop, keep any existing note
    const date = overrideMatch[1];
    const ex = current.exceptions.get(date) ?? { override: null, note: null };
    ex.override = override;
    current.exceptions.set(date, ex);
    return;
  }

  const seriesUntilMatch = line.match(SERIES_UNTIL_KEY_RE);
  if (seriesUntilMatch && isValidYMD(seriesUntilMatch[1])) {
    current.seriesUntil = seriesUntilMatch[1];
  }
}

/**
 * Parse the value portion of an `:EXCEPTION-<date>:` property into a
 * `RecurrenceOverride`, or return `null` if it doesn't match the
 * supported grammar exactly. Conservative on purpose: unknown variants
 * are dropped rather than half-parsed.
 *
 * Grammar:
 *   cancelled
 *   shift [+-]N(m|h|d)
 *   reschedule YYYY-MM-DD
 *   reschedule YYYY-MM-DD HH:MM
 *   reschedule YYYY-MM-DD HH:MM-HH:MM
 */
export function parseOverride(raw: string): RecurrenceOverride | null {
  const trimmed = raw.trim();

  if (OVERRIDE_CANCELLED_RE.test(trimmed)) {
    return { kind: "cancelled" };
  }

  const shiftMatch = trimmed.match(OVERRIDE_SHIFT_RE);
  if (shiftMatch) {
    const value = parseInt(shiftMatch[1], 10);
    if (!Number.isFinite(value) || value === 0) return null;
    const unit = shiftMatch[2] as "m" | "h" | "d";
    const offsetMinutes = unit === "m" ? value : unit === "h" ? value * 60 : value * 60 * 24;
    return { kind: "shift", offsetMinutes };
  }

  const rescheduleMatch = trimmed.match(OVERRIDE_RESCHEDULE_RE);
  if (rescheduleMatch) {
    const date = rescheduleMatch[1];
    const startTime = rescheduleMatch[2] ?? null;
    const endTime = rescheduleMatch[3] ?? null;
    // Reject obviously invalid time ranges (end ≤ start) — drop the whole
    // override rather than half-parse.
    if (startTime !== null && endTime !== null && endTime <= startTime) return null;
    return { kind: "reschedule", date, startTime, endTime };
  }

  return null;
}

function isValidYMD(raw: string): boolean {
  const match = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return false;

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(year, month - 1, day);

  return date.getFullYear() === year
    && date.getMonth() === month - 1
    && date.getDate() === day;
}

function finalizeEntry(entry: MutableEntry): OrgEntry {
  const exceptions = new Map<string, RecurrenceException>();
  for (const [date, ex] of entry.exceptions) {
    if (ex.override === null && ex.note === null) continue;
    exceptions.set(date, { override: ex.override, note: ex.note });
  }
  return {
    level: entry.level,
    todo: entry.todo,
    priority: entry.priority,
    title: entry.title,
    tags: entry.tags,
    planning: entry.planning,
    timestamps: entry.timestamps,
    checkboxItems: entry.checkboxItems,
    progress: entry.progress,
    body: entry.body,
    sourceLineNumber: entry.sourceLineNumber,
    exceptions,
    seriesUntil: entry.seriesUntil,
  };
}
