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

/**
 * Flip the checked state of the `index`th checkbox within the entry block at
 * `parentSourceLine`. Updates any `[N/M]` or `[N%]` progress cookie on the
 * heading to match the new counts. No-op if the entry or checkbox isn't found.
 */
export function toggleCheckboxInSource(source: string, parentSourceLine: number, index: number): string {
  const lines = source.split("\n");
  const startIdx = parentSourceLine - 1;
  if (startIdx < 0 || startIdx >= lines.length) return source;
  if (!/^\*+\s/.test(lines[startIdx])) return source;

  let endIdx = lines.length;
  for (let i = startIdx + 1; i < lines.length; i++) {
    if (/^\*+\s/.test(lines[i])) {
      endIdx = i;
      break;
    }
  }

  const checkboxRe = /^(\s*-\s+\[)([ X])(\]\s+.+)$/;
  let count = 0;
  let targetIdx = -1;
  for (let i = startIdx + 1; i < endIdx; i++) {
    if (checkboxRe.test(lines[i])) {
      if (count === index) {
        targetIdx = i;
        break;
      }
      count += 1;
    }
  }
  if (targetIdx === -1) return source;

  lines[targetIdx] = lines[targetIdx].replace(
    checkboxRe,
    (_match, before: string, mark: string, after: string) =>
      `${before}${mark === "X" ? " " : "X"}${after}`,
  );

  let done = 0;
  let total = 0;
  for (let i = startIdx + 1; i < endIdx; i++) {
    const m = lines[i].match(checkboxRe);
    if (m) {
      total += 1;
      if (m[2] === "X") done += 1;
    }
  }

  lines[startIdx] = updateProgressCookie(lines[startIdx], done, total);
  return lines.join("\n");
}

function updateProgressCookie(heading: string, done: number, total: number): string {
  const fracRe = /\[\d*\/\d*\]/;
  if (fracRe.test(heading)) {
    return heading.replace(fracRe, `[${done}/${total}]`);
  }
  const pctRe = /\[\d*%\]/;
  if (pctRe.test(heading)) {
    const pct = total === 0 ? 0 : Math.round((done / total) * 100);
    return heading.replace(pctRe, `[${pct}%]`);
  }
  return heading;
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

export function appendOrgTextUnderHeading(source: string, heading: "Tasks" | "Events", orgText: string): string {
  const normalized = normalizeOrgTextLevel(orgText, 2);
  if (!normalized.trim()) return source;
  return appendChildUnderTopLevelHeading(source, heading, normalized);
}

export function appendAgendaItemToSource(source: string, orgText: string): string {
  const heading = /^\*+\s+(?:TODO|DONE)\b/.test(orgText) ? "Tasks" : "Events";
  return appendOrgTextUnderHeading(source, heading, orgText);
}

export function appendQuickCaptureToTasks(source: string, rawText: string): string {
  const headingText = sanitizeQuickCaptureHeading(rawText);
  if (!headingText) return source;

  const taskLine = `** TODO ${headingText}`;
  return appendChildUnderTopLevelHeading(source, "Tasks", taskLine);
}

function appendChildUnderTopLevelHeading(source: string, heading: string, childText: string): string {
  const lines = source.split("\n");
  const headingLine = `* ${heading}`;
  const headingIdx = lines.findIndex(line => line === headingLine);

  if (headingIdx < 0) {
    const base = source.trimEnd();
    const prefix = base ? `${base}\n` : "";
    return `${prefix}${headingLine}\n${childText}\n`;
  }

  let insertIdx = lines.length;
  for (let i = headingIdx + 1; i < lines.length; i++) {
    if (/^\*\s/.test(lines[i])) {
      insertIdx = i;
      break;
    }
  }

  const before = lines.slice(0, insertIdx);
  while (before.length > headingIdx + 1 && before[before.length - 1] === "") before.pop();
  const after = lines.slice(insertIdx);
  const updated = [...before, childText, ...after].join("\n");
  return updated.endsWith("\n") ? updated : `${updated}\n`;
}

function normalizeOrgTextLevel(orgText: string, level: number): string {
  const lines = orgText.trimEnd().split("\n");
  if (lines.length === 0) return "";
  const match = lines[0].match(/^(\*+)(\s+.*)$/);
  if (!match) return orgText.trimEnd();
  lines[0] = `${"*".repeat(level)}${match[2]}`;
  return lines.join("\n");
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
