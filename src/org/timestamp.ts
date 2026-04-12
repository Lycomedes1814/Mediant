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

function parseRepeater(raw: string): OrgRepeater {
  const value = parseInt(raw.slice(1, -1), 10);
  const unit = raw.slice(-1) as OrgRepeater["unit"];
  return { value, unit };
}

/**
 * Build an OrgTimestamp from a RegExp match produced by TIMESTAMP_RE.
 * Exposed so the parser can drive its own regex control flow if needed.
 */
export function timestampFromMatch(match: RegExpMatchArray): OrgTimestamp {
  return {
    date: match[1],
    startTime: match[2] ?? null,
    endTime: match[3] ?? null,
    repeater: match[4] ? parseRepeater(match[4]) : null,
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
 *          If the target month has fewer days, JS Date rolls forward
 *          (e.g., Jan 31 + 1m → Mar 3 in non-leap years). This matches
 *          JavaScript's Date.setMonth behavior. We accept this for v1;
 *          a clamping strategy could be added later if needed.
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
 */
export function expandRecurrences(
  ts: OrgTimestamp,
  rangeStart: Date,
  rangeEnd: Date,
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

  // Repeaters generate occurrences forward from the base date only.
  // Walk forward from base, skip until rangeStart, stop after rangeEnd.
  let candidate = new Date(baseDate);

  // Fast-forward: skip occurrences before rangeStart
  while (candidate < rangeStart) {
    candidate = stepDate(candidate, value, unit);
  }

  // Collect occurrences within the range
  while (candidate <= rangeEnd) {
    results.push(new Date(candidate));
    candidate = stepDate(candidate, value, unit);
  }

  return results;
}

function stepDate(
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
      result.setMonth(result.getMonth() + step);
      break;
    case "y":
      result.setFullYear(result.getFullYear() + step);
      break;
  }
  return result;
}
