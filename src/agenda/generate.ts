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

import type { OrgEntry } from "../org/model.ts";
import type { OrgTimestamp } from "../org/timestamp.ts";
import {
  expandRecurrences,
  isDateOnly,
  toDate,
} from "../org/timestamp.ts";
import type { AgendaItem, AgendaDay, AgendaWeek, DeadlineItem, OverdueItem, SomedayItem, RenderCategory } from "./model.ts";

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
      const dueDate = toDate(plan.timestamp);
      const diffMs = dueDate.getTime() - today.getTime();
      const daysUntil = Math.round(diffMs / (1000 * 60 * 60 * 24));
      if (daysUntil < 0) continue;
      results.push({ entry, dueDate, daysUntil, sourceTimestamp: plan.timestamp });
    }
  }

  results.sort((a, b) => a.daysUntil - b.daysUntil);
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
      const dueDate = toDate(plan.timestamp);
      const diffMs = today.getTime() - dueDate.getTime();
      const daysOverdue = Math.round(diffMs / (1000 * 60 * 60 * 24));
      if (daysOverdue <= 0) continue;
      results.push({ entry, dueDate, daysOverdue, kind: plan.kind, sourceTimestamp: plan.timestamp });
    }
  }

  results.sort((a, b) => b.daysOverdue - a.daysOverdue);
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
    if (entry.todo !== "TODO") continue;
    if (entry.timestamps.length > 0) continue;
    if (entry.planning.length > 0) continue;
    results.push({ entry });
  }

  results.sort((a, b) => a.entry.title.localeCompare(b.entry.title));
  return results;
}

// ── Helpers ──────────────────────────────────────────────────────────

/**
 * Expand a timestamp's recurrences into the date range, create
 * AgendaItems, and assign them to the correct day slots.
 */
function collectOccurrences(
  entry: OrgEntry,
  ts: OrgTimestamp,
  category: RenderCategory,
  rangeStart: Date,
  rangeEnd: Date,
  days: AgendaDay[],
): void {
  const occurrences = expandRecurrences(ts, rangeStart, rangeEnd);
  for (const date of occurrences) {
    const dayIndex = dayOffsetIndex(date, rangeStart);
    if (dayIndex < 0 || dayIndex > 6) continue;

    const item: AgendaItem = {
      entry,
      date,
      startTime: ts.startTime,
      endTime: ts.endTime,
      category,
      sourceTimestamp: ts,
    };

    (days[dayIndex].items as AgendaItem[]).push(item);
  }
}

/**
 * Convert a Date to a 0-based offset from the range start date.
 */
function dayOffsetIndex(date: Date, rangeStart: Date): number {
  const dateMs = new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
  const startMs = new Date(rangeStart.getFullYear(), rangeStart.getMonth(), rangeStart.getDate()).getTime();
  return Math.round((dateMs - startMs) / (1000 * 60 * 60 * 24));
}

/** Category sort order: all-day → deadline → timed → scheduled.
 * Deadlines sort before timed events: they are more urgent/actionable. */
const CATEGORY_ORDER: Record<RenderCategory, number> = {
  "all-day": 0,
  "deadline": 1,
  "timed": 2,
  "scheduled": 3,
};

/**
 * Effective sort order for an item. Timed events and scheduled items
 * with a time are interleaved by start time (both get order 2).
 * All-day stays first, then deadlines and untimed scheduled, then timed.
 */
function effectiveOrder(item: AgendaItem): number {
  if (item.category === "all-day") return 0;
  if (item.category === "deadline") return 1;
  if (item.category === "scheduled" && !item.startTime) return 1;
  return 2; // timed, scheduled-with-time
}

/**
 * Sort comparator for AgendaItems within a day.
 *
 * Order:
 *   1. all-day items (alphabetical)
 *   2. deadlines and untimed scheduled (alphabetical)
 *   3. timed events and scheduled-with-time, interleaved by startTime
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
