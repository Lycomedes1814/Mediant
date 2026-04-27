/**
 * Pure source-text mutation helpers used by the edit panel.
 *
 * These operate on raw Org text and source line numbers so the UI can
 * test its rewrite behavior without going through DOM event handlers.
 */

import { stepDate } from "./timestamp.ts";

const ACTIVE_TIMESTAMP_RE =
  /<(\d{4}-\d{2}-\d{2})\s+(\S+)\s*(?:(\d{2}:\d{2})(?:-(\d{2}:\d{2}))?)?\s*((?:\.\+|\+\+|\+)\d+[dwmy])?\s*>/g;

const EN_DAY_ABBREVS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;
const NO_DAY_ABBREVS = ["sø.", "ma.", "ti.", "on.", "to.", "fr.", "lø."] as const;

/**
 * Replace the block for an entry at `sourceLine` with `newText`, preserving
 * any body text (non-planning, non-bare-timestamp lines) that followed the
 * original heading. The block extends from the heading line up to (but not
 * including) the next heading or EOF.
 */
export function replaceOrgBlockInSource(source: string, sourceLine: number, newText: string): string {
  const lines = source.split("\n");
  const startIdx = sourceLine - 1;
  if (startIdx < 0 || startIdx >= lines.length) return source;

  let endIdx = lines.length;
  for (let i = startIdx + 1; i < lines.length; i++) {
    if (/^\*+\s/.test(lines[i])) {
      endIdx = i;
      break;
    }
  }

  const planningRe = /^\s*(?:SCHEDULED|DEADLINE):\s*</;
  const bareRe = /^\s*<\d{4}-\d{2}-\d{2}/;
  const checkboxRe = /^\s*-\s+\[[ X]\]\s+/;
  const newBlockLines = newText.split("\n");
  const newHasBareTimestamp = newBlockLines.some((line) => bareRe.test(line));
  const shouldDropAllBare = !newHasBareTimestamp;
  let dropReplacementBare = newHasBareTimestamp;
  const preserved: string[] = [];

  for (let i = startIdx + 1; i < endIdx; i++) {
    const line = lines[i];
    if (planningRe.test(line)) continue;
    if (bareRe.test(line)) {
      if (shouldDropAllBare) continue;
      if (dropReplacementBare) {
        dropReplacementBare = false;
        continue;
      }
    }
    if (checkboxRe.test(line)) continue;
    preserved.push(line);
  }

  return [
    ...lines.slice(0, startIdx),
    ...newBlockLines,
    ...preserved,
    ...lines.slice(endIdx),
  ].join("\n");
}

/**
 * Flip TODO↔DONE on the heading line of the entry at `sourceLine`. Edits
 * only the heading, leaving planning lines and body untouched.
 */
export function toggleDoneInSource(source: string, sourceLine: number): string {
  const lines = source.split("\n");
  const idx = sourceLine - 1;
  if (idx < 0 || idx >= lines.length) return source;
  const match = lines[idx].match(/^(\*+\s+)(TODO|DONE)(\b.*)?$/);
  if (!match) return source;

  if (match[2] === "DONE") {
    lines[idx] = `${match[1]}TODO${match[3] ?? ""}`;
    return lines.join("\n");
  }

  let endIdx = lines.length;
  for (let i = idx + 1; i < lines.length; i++) {
    if (/^\*+\s/.test(lines[i])) {
      endIdx = i;
      break;
    }
  }

  const now = new Date();
  let sawRepeater = false;
  for (let i = idx + 1; i < endIdx; i++) {
    const original = lines[i];
    const updated = original.replace(ACTIVE_TIMESTAMP_RE, (...args: string[]) => {
      const full = args[0];
      const repeater = args[5] ?? "";
      if (!repeater) return full;
      sawRepeater = true;
      return shiftRepeatingTimestamp(full, now);
    });
    lines[i] = updated;
  }

  if (!sawRepeater) {
    lines[idx] = `${match[1]}DONE${match[3] ?? ""}`;
  }
  return lines.join("\n");
}

function shiftRepeatingTimestamp(raw: string, now: Date): string {
  const match = raw.match(/^<(\d{4}-\d{2}-\d{2})\s+(\S+)\s*(?:(\d{2}:\d{2})(?:-(\d{2}:\d{2}))?)?\s*((?:\.\+|\+\+|\+)\d+[dwmy])\s*>$/);
  if (!match) return raw;

  const [, date, weekdayToken, startTime, endTime, repeaterRaw] = match;
  const repeater = repeaterRaw.match(/^(\.\+|\+\+|\+)(\d+)([dwmy])$/);
  if (!repeater) return raw;

  const [, mark, rawValue, unit] = repeater;
  const value = Number(rawValue);
  if (!Number.isFinite(value) || value <= 0) return raw;

  const base = parseYMDWithTime(date, startTime ?? null);
  const next = nextRepeaterDate(base, startTime ?? null, mark as ".+" | "++" | "+", value, unit as "d" | "w" | "m" | "y", now);
  const nextDate = formatYMD(next);
  const nextDay = formatWeekdayToken(next, weekdayToken);
  const timePart = startTime
    ? endTime
      ? ` ${formatHHMM(next)}-${shiftEndTime(next, startTime, endTime)}`
      : ` ${formatHHMM(next)}`
    : "";
  return `<${nextDate} ${nextDay}${timePart} ${repeaterRaw}>`;
}

function nextRepeaterDate(
  base: Date,
  startTime: string | null,
  mark: ".+" | "++" | "+",
  value: number,
  unit: "d" | "w" | "m" | "y",
  now: Date,
): Date {
  if (mark === "+") return stepDate(base, value, unit);

  if (mark === ".+") {
    const anchor = startTime === null
      ? new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0)
      : new Date(now);
    return stepDate(anchor, value, unit);
  }

  const compare = startTime === null
    ? new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0)
    : new Date(now);
  let candidate = stepDate(base, value, unit);
  while (candidate <= compare) {
    candidate = stepDate(candidate, value, unit);
  }
  return candidate;
}

function shiftEndTime(start: Date, baseStartTime: string, baseEndTime: string): string {
  let durationMin = hhmmToMinutes(baseEndTime) - hhmmToMinutes(baseStartTime);
  if (durationMin < 0) durationMin += 1440;
  const shiftedEnd = new Date(start.getTime() + durationMin * 60_000);
  return formatHHMM(shiftedEnd);
}

function formatWeekdayToken(date: Date, sample: string): string {
  if (NO_DAY_ABBREVS.includes(sample as typeof NO_DAY_ABBREVS[number])) return NO_DAY_ABBREVS[date.getDay()];
  return EN_DAY_ABBREVS[date.getDay()];
}

function parseYMDWithTime(ymd: string, time: string | null): Date {
  const [y, mo, d] = ymd.split("-").map(Number);
  if (time === null) return new Date(y, mo - 1, d, 0, 0, 0, 0);
  const [h, mi] = time.split(":").map(Number);
  return new Date(y, mo - 1, d, h, mi, 0, 0);
}

function formatYMD(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function formatHHMM(date: Date): string {
  return `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}

function hhmmToMinutes(s: string): number {
  const [h, m] = s.split(":").map(Number);
  return h * 60 + m;
}

export function deleteOrgBlockInSource(source: string, sourceLine: number): string {
  const lines = source.split("\n");
  const startIdx = sourceLine - 1;
  if (startIdx < 0 || startIdx >= lines.length) return source;

  let endIdx = lines.length;
  for (let i = startIdx + 1; i < lines.length; i++) {
    if (/^\*+\s/.test(lines[i])) {
      endIdx = i;
      break;
    }
  }

  const before = lines.slice(0, startIdx);
  const after = lines.slice(endIdx);
  if (before.length > 0 && before[before.length - 1] === "" && (after.length === 0 || after[0] === "")) {
    before.pop();
  }

  return [...before, ...after].join("\n");
}

export function appendOrgTextToSource(source: string, orgText: string): string {
  return `${source.trimEnd()}\n${orgText}\n`;
}

export function appendQuickCaptureToInbox(source: string, rawText: string): string {
  const headingText = sanitizeQuickCaptureHeading(rawText);
  if (!headingText) return source;

  const lines = source.split("\n");
  const inboxIdx = lines.findIndex(line => line === "* Inbox");
  const taskLine = `** TODO ${headingText}`;

  if (inboxIdx < 0) {
    const base = source.trimEnd();
    const prefix = base ? `${base}\n` : "";
    return `${prefix}* Inbox\n${taskLine}\n`;
  }

  let insertIdx = lines.length;
  for (let i = inboxIdx + 1; i < lines.length; i++) {
    if (/^\*\s/.test(lines[i])) {
      insertIdx = i;
      break;
    }
  }

  const before = lines.slice(0, insertIdx);
  while (before.length > inboxIdx + 1 && before[before.length - 1] === "") before.pop();
  const after = lines.slice(insertIdx);
  const updated = [...before, taskLine, ...after].join("\n");
  return updated.endsWith("\n") ? updated : `${updated}\n`;
}

function sanitizeQuickCaptureHeading(rawText: string): string {
  return rawText
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^(\[#([A-C])\]\s*)/, "#$2 ")
    .replace(/\[(\d+)\/(\d+)\]/g, "($1/$2)")
    .replace(/\[(\d+)%\]/g, "($1%)")
    .replace(/<([^>]*)>/g, "($1)")
    .replace(/\s+(:[\p{L}a-zA-Z0-9_@]+(?::[\p{L}a-zA-Z0-9_@]+)*:)\s*$/u, (_, tags: string) => ` ${tags.replace(/:/g, ";")}`);
}
