import type { RecurrenceException, RecurrenceOverride } from "./model.ts";

/**
 * Timestamp parsing, normalization, and recurrence expansion.
 *
 * This module is the single owner of all timestamp/date logic.
 * Nothing else in the codebase should parse timestamp strings or
 * do date arithmetic on Org timestamps directly.
 *
 * Responsibility boundary:
 *   - timestamp.ts: parse timestamp text → OrgTimestamp, convert to Date,
 *     expand recurrences within a date range.
 *   - parser.ts: detect Org constructs (headings, planning lines, body),
 *     call into this module for timestamp extraction, assemble OrgEntry.
 *   - agenda/generate.ts: classify OrgEntry timestamps into render
 *     categories and build the week view.
 *
 * Local-time convention:
 *   All Date objects use the runtime's local timezone. Org files do not
 *   encode timezone information, so we treat all dates/times as local.
 *   This is intentional for v1 — no timezone normalization is performed.
 */

// ── Types ────────────────────────────────────────────────────────────

/**
 * A repeater attached to an Org timestamp, e.g. +1w, +1y.
 *
 * Only the cumulate (+) repeater type is supported in v1.
 * The .+ (catch-up) and ++ (restart) types are not parsed.
 */
export interface OrgRepeater {
  readonly value: number;
  readonly unit: "d" | "w" | "m" | "y";
}

/**
 * A parsed Org-mode active timestamp.
 *
 * Components are stored as strings to stay close to the source text.
 * Conversion to JS Date objects happens via the helper functions below
 * (toDate, toEndDate), not at parse time.
 *
 * `raw` preserves the original text exactly as it appeared in the .org
 * file, including angle brackets and day name — useful for debugging.
 */
export interface OrgTimestamp {
  readonly date: string;
  readonly startTime: string | null;
  readonly endTime: string | null;
  readonly repeater: OrgRepeater | null;
  readonly raw: string;
}

// ── Regex ────────────────────────────────────────────────────────────

/**
 * Matches a single active Org timestamp. Exported for use by the parser.
 *
 * Groups:
 *   0 — full match including angle brackets
 *   1 — date "2026-04-07"
 *   2 — start time "15:15" (optional)
 *   3 — end time "16:00" (optional, from range like 15:15-16:00)
 *   4 — repeater "+1w" (optional)
 *
 * Day names (ti., sø., Sat, etc.) are consumed by \S+ but not
 * captured — the date string is authoritative. We use \S+ rather
 * than \w+ because \w does not match non-ASCII characters like ø.
 */
export const TIMESTAMP_RE =
  /<(\d{4}-\d{2}-\d{2})\s+\S+\s*(?:(\d{2}:\d{2})(?:-(\d{2}:\d{2}))?)?\s*(\+\d+[dwmy])?\s*>/g;

// ── Parsing ──────────────────────────────────────────────────────────

function parseRepeater(raw: string): OrgRepeater | null {
  const value = parseInt(raw.slice(1, -1), 10);
  if (!Number.isFinite(value) || value <= 0) return null;
  const unit = raw.slice(-1) as OrgRepeater["unit"];
  return { value, unit };
}

/**
 * Build an OrgTimestamp from a RegExp match produced by TIMESTAMP_RE.
 * Exposed so the parser can drive its own regex control flow if needed.
 */
export function timestampFromMatch(match: RegExpMatchArray): OrgTimestamp {
  const repeater = match[4] ? parseRepeater(match[4]) : null;
  return {
    date: match[1],
    startTime: match[2] ?? null,
    endTime: match[3] ?? null,
    repeater,
    raw: match[0],
  };
}

/**
 * Parse all active timestamps found in a string.
 * Returns an empty array if none are found.
 *
 * Works on any input — a full line, a heading, a body block.
 * The parser calls this where needed.
 */
export function parseTimestamps(text: string): OrgTimestamp[] {
  const results: OrgTimestamp[] = [];
  const re = new RegExp(TIMESTAMP_RE.source, TIMESTAMP_RE.flags);
  let match: RegExpExecArray | null;
  while ((match = re.exec(text)) !== null) {
    results.push(timestampFromMatch(match));
  }
  return results;
}

// ── Date conversion helpers ──────────────────────────────────────────

/**
 * Convert an OrgTimestamp to a local Date.
 * If the timestamp has a start time, the Date reflects that time.
 * If date-only, the Date is set to midnight (00:00:00) local time.
 */
export function toDate(ts: OrgTimestamp): Date {
  if (ts.startTime) {
    const [h, m] = ts.startTime.split(":").map(Number);
    const [y, mo, d] = ts.date.split("-").map(Number);
    return new Date(y, mo - 1, d, h, m, 0, 0);
  }
  const [y, mo, d] = ts.date.split("-").map(Number);
  return new Date(y, mo - 1, d, 0, 0, 0, 0);
}

/**
 * Convert end time to a local Date on the same day, or null if no end time.
 */
export function toEndDate(ts: OrgTimestamp): Date | null {
  if (!ts.endTime) return null;
  const [h, m] = ts.endTime.split(":").map(Number);
  const [y, mo, d] = ts.date.split("-").map(Number);
  return new Date(y, mo - 1, d, h, m, 0, 0);
}

/** True if the timestamp has no time component (date-only). */
export function isDateOnly(ts: OrgTimestamp): boolean {
  return ts.startTime === null;
}

/** True if the timestamp has a start time. */
export function isTimed(ts: OrgTimestamp): boolean {
  return ts.startTime !== null;
}

// ── Recurrence expansion ─────────────────────────────────────────────

/**
 * Recurrence semantics (v1, cumulate repeater only):
 *
 *   +Nd  — every N days from the base date
 *   +Nw  — every N*7 days from the base date
 *   +Nm  — same day-of-month, every N months from the base date.
 *          If the target month has fewer days, clamp to that month's
 *          last valid day (e.g., Jan 31 + 1m → Feb 28 in non-leap years).
 *   +Ny  — same month-and-day, every N years from the base date.
 *          Leap day (Feb 29) + 1y in a non-leap year → Mar 1.
 *
 * Only the simple cumulate (+) repeater is supported.
 * The .+ (catch-up) and ++ (restart) types are not recognized.
 */

/**
 * Generate all occurrence dates of a (possibly repeating) timestamp
 * that fall within [rangeStart, rangeEnd] inclusive.
 *
 * Non-repeating timestamps are checked for inclusion as-is.
 * Never generates dates outside the given range.
 *
 * Returned dates are local-time Date objects matching the timestamp's
 * time (or midnight for date-only timestamps).
 *
 * `seriesUntil` (exclusive `YYYY-MM-DD`) truncates repeating series:
 * an occurrence whose base date falls on or after this date is not
 * generated. Non-repeating timestamps ignore `seriesUntil` (inert).
 */
export function expandRecurrences(
  ts: OrgTimestamp,
  rangeStart: Date,
  rangeEnd: Date,
  seriesUntil: string | null = null,
): Date[] {
  const baseDate = toDate(ts);

  if (!ts.repeater) {
    if (baseDate >= rangeStart && baseDate <= rangeEnd) {
      return [baseDate];
    }
    return [];
  }

  const results: Date[] = [];
  const { value, unit } = ts.repeater;
  const untilDate = seriesUntil !== null ? parseYMDWithTime(seriesUntil, null) : null;

  // Repeaters generate occurrences forward from the base date only.
  // Walk forward from base, skip until rangeStart, stop after rangeEnd.
  let candidate = new Date(baseDate);

  // Fast-forward: skip occurrences before rangeStart
  while (candidate < rangeStart) {
    if (untilDate !== null && candidate >= untilDate) return results;
    candidate = stepDate(candidate, value, unit);
  }

  // Collect occurrences within the range
  while (candidate <= rangeEnd) {
    if (untilDate !== null && candidate >= untilDate) break;
    results.push(new Date(candidate));
    candidate = stepDate(candidate, value, unit);
  }

  return results;
}

function addMonthsClamped(date: Date, months: number): Date {
  const result = new Date(date);
  const originalDay = result.getDate();
  result.setDate(1);
  result.setMonth(result.getMonth() + months);
  const lastDay = new Date(result.getFullYear(), result.getMonth() + 1, 0).getDate();
  result.setDate(Math.min(originalDay, lastDay));
  return result;
}

export function stepDate(
  date: Date,
  step: number,
  unit: OrgRepeater["unit"],
): Date {
  const result = new Date(date);
  switch (unit) {
    case "d":
      result.setDate(result.getDate() + step);
      break;
    case "w":
      result.setDate(result.getDate() + step * 7);
      break;
    case "m":
      return addMonthsClamped(result, step);
    case "y":
      result.setFullYear(result.getFullYear() + step);
      break;
  }
  return result;
}

// ── Per-occurrence exceptions ────────────────────────────────────────

/**
 * One concrete occurrence of a (possibly recurring) timestamp, with any
 * per-occurrence exception already applied.
 *
 * `date`, `startTime`, `endTime` are the *final* values after applying
 * any shift/reschedule. `baseDate` and `baseStartMinutes` describe the
 * unshifted slot — used by the agenda renderer to surface the original
 * position and by the edit panel to round-trip back to the right
 * `:EXCEPTION-<date>:` property key.
 *
 * `override` is the override that was applied (`shift` or `reschedule`),
 * or `null` if no override was applied. `cancelled` is filtered out
 * during expansion and never appears here.
 */
export interface OccurrenceInstance {
  readonly date: Date;
  readonly startTime: string | null;
  readonly endTime: string | null;
  readonly baseDate: string;
  readonly baseStartMinutes: number | null;
  readonly override: RecurrenceOverride | null;
  readonly note: string | null;
}

/**
 * How many days outside the requested range we still expand base
 * occurrences for, so that a shift can pull an occurrence from just
 * outside the range into it (or push one just inside it out). Bigger
 * shifts than this remain a corner case; reschedules that move from a
 * far-out base into range are handled separately by iterating the
 * exception map.
 */
const SHIFT_BUFFER_DAYS = 7;

/**
 * Expand a timestamp's occurrences into a date range, applying any
 * per-occurrence exceptions on the way.
 *
 * For non-recurring timestamps, the exception map and `seriesUntil` are
 * both **inert** by design (mirrors the `OrgEntry.exceptions` and
 * `OrgEntry.seriesUntil` invariants): the base timestamp is emitted
 * as-is and both extras are ignored.
 *
 * For recurring timestamps:
 *   - cancelled occurrences are dropped
 *   - shifted occurrences move their start (and end, if present); if the
 *     shift crosses midnight, the final calendar day moves with it but
 *     `baseDate` stays at the original slot
 *   - rescheduled occurrences move to a new date and (optionally) new
 *     time, preserving base duration when only a start time is given
 *   - notes attach to the final occurrence
 *   - reschedules that pull an occurrence from outside the page into the
 *     range are surfaced by iterating the exception map directly
 *   - `seriesUntil` (exclusive) truncates the series — any occurrence
 *     whose base slot is at or after that date is dropped, including
 *     reschedules surfaced by the Step 2 pass
 */
export function expandOccurrences(
  ts: OrgTimestamp,
  exceptions: ReadonlyMap<string, RecurrenceException>,
  rangeStart: Date,
  rangeEnd: Date,
  seriesUntil: string | null = null,
): OccurrenceInstance[] {
  // Non-recurring: inert. Emit the single base occurrence (if any), no overrides.
  if (!ts.repeater) {
    return expandRecurrences(ts, rangeStart, rangeEnd).map((date) =>
      buildOccurrence(ts, date, null, null),
    );
  }

  const results: OccurrenceInstance[] = [];
  const seenBaseKeys = new Set<string>();

  // Step 1: expand base occurrences in a slightly wider window so shifts
  // that tip across the range edge are still considered.
  const wideStart = addDays(rangeStart, -SHIFT_BUFFER_DAYS);
  const wideEnd = addDays(rangeEnd, SHIFT_BUFFER_DAYS);
  for (const baseDate of expandRecurrences(ts, wideStart, wideEnd, seriesUntil)) {
    const baseKey = formatYMD(baseDate);
    seenBaseKeys.add(baseKey);
    const exception = exceptions.get(baseKey) ?? null;
    const occ = applyException(ts, baseDate, baseKey, exception);
    if (occ === null) continue; // cancelled
    if (occ.date < rangeStart || occ.date > rangeEnd) continue;
    results.push(occ);
  }

  // Step 2: pick up reschedules whose base date is outside the wider
  // window but whose target lands inside the requested range. We trust
  // the exception's base key to identify a real slot in the series; if
  // the user wrote a key that doesn't line up with the repeater, we
  // still emit (harmless and cheap). Base slots at or after
  // `seriesUntil` are filtered — the series has ended there, so a
  // reschedule keyed to that slot has nothing to move.
  for (const [baseKey, exception] of exceptions) {
    if (seenBaseKeys.has(baseKey)) continue;
    if (exception.override?.kind !== "reschedule") continue;
    if (seriesUntil !== null && baseKey >= seriesUntil) continue;
    const baseDate = parseYMDWithTime(baseKey, ts.startTime);
    const occ = applyException(ts, baseDate, baseKey, exception);
    if (occ === null) continue;
    if (occ.date < rangeStart || occ.date > rangeEnd) continue;
    results.push(occ);
  }

  return results;
}

function applyException(
  ts: OrgTimestamp,
  baseDate: Date,
  baseKey: string,
  exception: RecurrenceException | null,
): OccurrenceInstance | null {
  const baseStartMinutes = ts.startTime !== null ? hhmmToMinutes(ts.startTime) : null;

  if (exception === null) {
    return buildOccurrence(ts, baseDate, null, null, baseKey, baseStartMinutes);
  }

  const { override, note } = exception;

  if (override?.kind === "cancelled") return null;

  if (override?.kind === "shift") {
    const shiftedStart = new Date(baseDate.getTime() + override.offsetMinutes * 60_000);
    const finalStartTime = ts.startTime !== null ? formatHHMM(shiftedStart) : null;
    let finalEndTime: string | null = null;
    if (ts.startTime !== null && ts.endTime !== null) {
      let durationMin =
        hhmmToMinutes(ts.endTime) - hhmmToMinutes(ts.startTime);
      if (durationMin < 0) durationMin += 1440; // wrap: end was next-day
      const shiftedEnd = new Date(shiftedStart.getTime() + durationMin * 60_000);
      finalEndTime = formatHHMM(shiftedEnd);
    }
    return {
      date: shiftedStart,
      startTime: finalStartTime,
      endTime: finalEndTime,
      baseDate: baseKey,
      baseStartMinutes,
      override,
      note,
    };
  }

  if (override?.kind === "reschedule") {
    let finalStartTime: string | null = ts.startTime;
    let finalEndTime: string | null = ts.endTime;
    if (override.startTime !== null) {
      finalStartTime = override.startTime;
      if (override.endTime !== null) {
        finalEndTime = override.endTime;
      } else if (ts.startTime !== null && ts.endTime !== null) {
        // Preserve base duration, with same wrap-around handling as shift.
        let durationMin = hhmmToMinutes(ts.endTime) - hhmmToMinutes(ts.startTime);
        if (durationMin < 0) durationMin += 1440;
        const newStartMin = hhmmToMinutes(override.startTime);
        const newEndMin = (newStartMin + durationMin) % 1440;
        finalEndTime = minutesToHHMM(newEndMin);
      } else {
        finalEndTime = null;
      }
    }
    const finalDate = parseYMDWithTime(override.date, finalStartTime);
    return {
      date: finalDate,
      startTime: finalStartTime,
      endTime: finalEndTime,
      baseDate: baseKey,
      baseStartMinutes,
      override,
      note,
    };
  }

  // No override but possibly a note.
  return buildOccurrence(ts, baseDate, null, note, baseKey, baseStartMinutes);
}

function buildOccurrence(
  ts: OrgTimestamp,
  date: Date,
  override: RecurrenceOverride | null,
  note: string | null,
  baseKey?: string,
  baseStartMinutes?: number | null,
): OccurrenceInstance {
  return {
    date,
    startTime: ts.startTime,
    endTime: ts.endTime,
    baseDate: baseKey ?? formatYMD(date),
    baseStartMinutes:
      baseStartMinutes !== undefined
        ? baseStartMinutes
        : ts.startTime !== null
          ? hhmmToMinutes(ts.startTime)
          : null,
    override,
    note,
  };
}

// ── Small date/time helpers used by exception application ────────────

function addDays(date: Date, days: number): Date {
  const result = new Date(date);
  result.setDate(result.getDate() + days);
  return result;
}

function formatYMD(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function formatHHMM(date: Date): string {
  const h = String(date.getHours()).padStart(2, "0");
  const m = String(date.getMinutes()).padStart(2, "0");
  return `${h}:${m}`;
}

function hhmmToMinutes(s: string): number {
  const [h, m] = s.split(":").map(Number);
  return h * 60 + m;
}

function minutesToHHMM(minutes: number): string {
  const h = String(Math.floor(minutes / 60)).padStart(2, "0");
  const m = String(minutes % 60).padStart(2, "0");
  return `${h}:${m}`;
}

function parseYMDWithTime(ymd: string, time: string | null): Date {
  const [y, mo, d] = ymd.split("-").map(Number);
  if (time === null) return new Date(y, mo - 1, d, 0, 0, 0, 0);
  const [h, mi] = time.split(":").map(Number);
  return new Date(y, mo - 1, d, h, mi, 0, 0);
}
