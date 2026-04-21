/**
 * Agenda generation: transforms OrgEntry[] into a rolling 7-day view.
 *
 * This is where Org semantics get classified into render categories.
 * The parser output (OrgEntry) stays faithful to Org; this module
 * decides what "all-day", "timed", "deadline", and "scheduled" mean
 * for display purposes.
 *
 * Classification rules:
 *   | Source             | Has time? | → Category   |
 *   |--------------------|-----------|--------------|
 *   | Active timestamp   | No        | "all-day"    |
 *   | Active timestamp   | Yes       | "timed"      |
 *   | DEADLINE planning  | Either    | "deadline"   |
 *   | SCHEDULED planning | Either    | "scheduled"  |
 *
 * Recurrence expansion is always bounded to the requested 7-day range.
 * DONE entries are included (the UI renders them as dimmed grey).
 *
 * Range semantics: startDate 00:00:00 through startDate+6 23:59:59, local time.
 */

import type { OrgEntry, RecurrenceOverride } from "../org/model.ts";
import type { OccurrenceInstance, OrgTimestamp } from "../org/timestamp.ts";
import {
  expandOccurrences,
  isDateOnly,
  toDate,
} from "../org/timestamp.ts";
import type { AgendaItem, AgendaItemOverride, AgendaDay, AgendaWeek, DeadlineItem, OverdueItem, SomedayItem, RenderCategory } from "./model.ts";

// ── Public API ───────────────────────────────────────────────────────

/**
 * Generate a 7-day agenda from parsed Org entries.
 *
 * @param entries - parsed OrgEntry[] from the parser
 * @param startDate - first day of the 7-day range
 * @returns AgendaWeek (7 consecutive days starting from startDate), each day with sorted items
 */
export function generateWeek(entries: OrgEntry[], startDate: Date): AgendaWeek {
  const start = new Date(startDate.getFullYear(), startDate.getMonth(), startDate.getDate());
  const end = new Date(start);
  end.setDate(end.getDate() + 6);
  end.setHours(23, 59, 59, 999);

  const days: AgendaDay[] = [];
  for (let i = 0; i < 7; i++) {
    const date = new Date(start);
    date.setDate(date.getDate() + i);
    days.push({ date, items: [] });
  }

  const rangeStart = start;
  const rangeEnd = end;

  for (const entry of entries) {
    // Active timestamps → "all-day" or "timed"
    for (const ts of entry.timestamps) {
      const category: RenderCategory = isDateOnly(ts) ? "all-day" : "timed";
      collectOccurrences(entry, ts, category, rangeStart, rangeEnd, days);
    }

    // Planning lines → "scheduled" or "deadline"
    for (const plan of entry.planning) {
      const category: RenderCategory = plan.kind === "deadline" ? "deadline" : "scheduled";
      collectOccurrences(entry, plan.timestamp, category, rangeStart, rangeEnd, days);
    }
  }

  // Sort items within each day
  for (let i = 0; i < 7; i++) {
    const sorted = [...days[i].items].sort(compareItems);
    days[i] = { date: days[i].date, items: sorted };
  }

  return days as unknown as AgendaWeek;
}

/**
 * Collect all upcoming deadlines from entries, relative to a reference date.
 * Returns deadlines sorted by due date (soonest first).
 * Only includes items where daysUntil >= 0 (today or future).
 */
export function collectDeadlines(entries: OrgEntry[], referenceDate: Date): DeadlineItem[] {
  const today = new Date(referenceDate.getFullYear(), referenceDate.getMonth(), referenceDate.getDate());
  const results: DeadlineItem[] = [];

  for (const entry of entries) {
    for (const plan of entry.planning) {
      if (plan.kind !== "deadline") continue;
      const dueDate = findNextPlanningOccurrence(entry, plan.timestamp, today);
      if (dueDate === null) continue;
      const daysUntil = diffCalendarDays(dueDate, today);
      results.push({ entry, dueDate, daysUntil, sourceTimestamp: plan.timestamp });
    }
  }

  results.sort((a, b) => a.dueDate.getTime() - b.dueDate.getTime());
  return results;
}

/**
 * Collect TODO items that are past their DEADLINE or SCHEDULED date.
 * Returns items sorted by most overdue first (highest daysOverdue).
 * Only includes non-DONE entries where daysOverdue > 0.
 */
export function collectOverdueItems(entries: OrgEntry[], referenceDate: Date): OverdueItem[] {
  const today = new Date(referenceDate.getFullYear(), referenceDate.getMonth(), referenceDate.getDate());
  const results: OverdueItem[] = [];

  for (const entry of entries) {
    if (entry.todo !== "TODO") continue;

    for (const plan of entry.planning) {
      const dueDate = findLatestPastPlanningOccurrence(entry, plan.timestamp, today);
      if (dueDate === null) continue;
      const daysOverdue = diffCalendarDays(today, dueDate);
      results.push({ entry, dueDate, daysOverdue, kind: plan.kind, sourceTimestamp: plan.timestamp });
    }
  }

  results.sort((a, b) => {
    const overdueDiff = b.daysOverdue - a.daysOverdue;
    if (overdueDiff !== 0) return overdueDiff;
    return a.dueDate.getTime() - b.dueDate.getTime();
  });
  return results;
}

/**
 * Collect undated TODO items — entries with a TODO state but no timestamps
 * and no planning lines. These appear in the "Someday" section.
 * Sorted alphabetically by title.
 */
export function collectSomedayItems(entries: OrgEntry[]): SomedayItem[] {
  const results: SomedayItem[] = [];

  for (const entry of entries) {
    if (entry.todo !== "TODO" && entry.todo !== "DONE") continue;
    if (entry.timestamps.length > 0) continue;
    if (entry.planning.length > 0) continue;
    results.push({ entry });
  }

  results.sort((a, b) => {
    if (a.entry.todo !== b.entry.todo) return a.entry.todo === "DONE" ? 1 : -1;
    return a.entry.title.localeCompare(b.entry.title);
  });
  return results;
}

// ── Helpers ──────────────────────────────────────────────────────────

/**
 * Expand a timestamp's recurrences into the date range (applying any
 * per-occurrence exceptions), create AgendaItems, and assign them to
 * the correct day slots.
 *
 * Category is derived from the base timestamp and stays stable across
 * occurrences — a rescheduled or shifted occurrence keeps the same
 * render category as its base.
 */
function collectOccurrences(
  entry: OrgEntry,
  ts: OrgTimestamp,
  category: RenderCategory,
  rangeStart: Date,
  rangeEnd: Date,
  days: AgendaDay[],
): void {
  const occurrences = expandOccurrences(
    ts,
    entry.exceptions,
    rangeStart,
    rangeEnd,
    entry.seriesUntil,
  );
  for (const occ of occurrences) {
    const dayIndex = dayOffsetIndex(occ.date, rangeStart);
    if (dayIndex < 0 || dayIndex > 6) continue;
    (days[dayIndex].items as AgendaItem[]).push(buildAgendaItem(entry, ts, category, occ));
  }
}

const PLANNING_SEARCH_INITIAL_DAYS = 366;
const PLANNING_SEARCH_MAX_DAYS = 366 * 20;

function findNextPlanningOccurrence(
  entry: OrgEntry,
  ts: OrgTimestamp,
  today: Date,
): Date | null {
  if (!ts.repeater) {
    const dueDate = toDate(ts);
    return diffCalendarDays(dueDate, today) >= 0 ? dueDate : null;
  }

  let windowDays = PLANNING_SEARCH_INITIAL_DAYS;
  while (windowDays <= PLANNING_SEARCH_MAX_DAYS) {
    const rangeEnd = endOfDay(addDays(today, windowDays - 1));
    const occurrences = expandOccurrences(
      ts,
      entry.exceptions,
      today,
      rangeEnd,
      entry.seriesUntil,
    );
    const visible = occurrences.filter((occ) => occ.override?.kind !== "cancelled");
    if (visible.length > 0) return earliestOccurrence(visible).date;
    windowDays *= 2;
  }

  return null;
}

function findLatestPastPlanningOccurrence(
  entry: OrgEntry,
  ts: OrgTimestamp,
  today: Date,
): Date | null {
  const yesterdayEnd = new Date(today.getTime() - 1);

  if (!ts.repeater) {
    const dueDate = toDate(ts);
    return diffCalendarDays(dueDate, today) < 0 ? dueDate : null;
  }

  let windowDays = PLANNING_SEARCH_INITIAL_DAYS;
  while (windowDays <= PLANNING_SEARCH_MAX_DAYS) {
    const rangeStart = addDays(today, -windowDays);
    const occurrences = expandOccurrences(
      ts,
      entry.exceptions,
      rangeStart,
      yesterdayEnd,
      entry.seriesUntil,
    );
    const visible = occurrences.filter((occ) => occ.override?.kind !== "cancelled");
    if (visible.length > 0) return latestOccurrence(visible).date;
    windowDays *= 2;
  }

  return null;
}

function earliestOccurrence(occurrences: readonly OccurrenceInstance[]): OccurrenceInstance {
  let earliest = occurrences[0];
  for (let i = 1; i < occurrences.length; i++) {
    if (occurrences[i].date < earliest.date) earliest = occurrences[i];
  }
  return earliest;
}

function latestOccurrence(occurrences: readonly OccurrenceInstance[]): OccurrenceInstance {
  let latest = occurrences[0];
  for (let i = 1; i < occurrences.length; i++) {
    if (occurrences[i].date > latest.date) latest = occurrences[i];
  }
  return latest;
}

function buildAgendaItem(
  entry: OrgEntry,
  ts: OrgTimestamp,
  category: RenderCategory,
  occ: OccurrenceInstance,
): AgendaItem {
  const hasRepeater = ts.repeater !== null;
  return {
    entry,
    date: occ.date,
    startTime: occ.startTime,
    endTime: occ.endTime,
    category,
    sourceTimestamp: ts,
    baseDate: hasRepeater ? occ.baseDate : null,
    baseStartMinutes: hasRepeater ? occ.baseStartMinutes : null,
    instanceNote: occ.note,
    override: summarizeOverride(occ.override, occ.baseDate),
    skipped: occ.override?.kind === "cancelled",
  };
}

function summarizeOverride(
  override: RecurrenceOverride | null,
  baseDate: string,
): AgendaItemOverride | null {
  if (override === null) return null;
  if (override.kind === "cancelled") {
    return { kind: "cancelled", detail: "Skipped occurrence" };
  }
  if (override.kind === "shift") {
    return { kind: "shift", detail: formatShiftDetail(override.offsetMinutes) };
  }
  return { kind: "reschedule", detail: `from ${baseDate}` };
}

function formatShiftDetail(offsetMinutes: number): string {
  const sign = offsetMinutes >= 0 ? "+" : "-";
  const abs = Math.abs(offsetMinutes);
  if (abs % 1440 === 0) return `${sign}${abs / 1440}d`;
  if (abs % 60 === 0) return `${sign}${abs / 60}h`;
  return `${sign}${abs}m`;
}

/**
 * Convert a Date to a 0-based offset from the range start date.
 */
function dayOffsetIndex(date: Date, rangeStart: Date): number {
  const dateMs = new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
  const startMs = new Date(rangeStart.getFullYear(), rangeStart.getMonth(), rangeStart.getDate()).getTime();
  return Math.round((dateMs - startMs) / (1000 * 60 * 60 * 24));
}

function diffCalendarDays(a: Date, b: Date): number {
  const aMidnight = new Date(a.getFullYear(), a.getMonth(), a.getDate()).getTime();
  const bMidnight = new Date(b.getFullYear(), b.getMonth(), b.getDate()).getTime();
  return Math.round((aMidnight - bMidnight) / (1000 * 60 * 60 * 24));
}

function addDays(date: Date, days: number): Date {
  const result = new Date(date);
  result.setDate(result.getDate() + days);
  return result;
}

function endOfDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate(), 23, 59, 59, 999);
}

/**
 * Effective sort order for an item:
 *   0. all-day
 *   1. untimed deadlines and untimed scheduled (can't be placed on the timeline)
 *   2. anything with a start time — timed events, scheduled-with-time,
 *      and timed deadlines all interleave by startTime
 */
function effectiveOrder(item: AgendaItem): number {
  if (item.category === "all-day") return 0;
  if (!item.startTime) return 1;
  return 2;
}

/**
 * Sort comparator for AgendaItems within a day.
 *
 * Order:
 *   1. all-day items (alphabetical)
 *   2. untimed deadlines and untimed scheduled (alphabetical)
 *   3. everything with a time (timed events, scheduled-with-time,
 *      timed deadlines) interleaved by startTime
 */
function compareItems(a: AgendaItem, b: AgendaItem): number {
  const orderDiff = effectiveOrder(a) - effectiveOrder(b);
  if (orderDiff !== 0) return orderDiff;

  // Within same effective group
  if (a.startTime && b.startTime) {
    const timeDiff = a.startTime.localeCompare(b.startTime);
    if (timeDiff !== 0) return timeDiff;
  } else if (a.startTime && !b.startTime) {
    return -1;
  } else if (!a.startTime && b.startTime) {
    return 1;
  }

  return a.entry.title.localeCompare(b.entry.title);
}
