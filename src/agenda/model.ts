import type { OrgEntry } from "../org/model.ts";
import type { OrgTimestamp } from "../org/timestamp.ts";

/**
 * Display categories — determined at agenda generation time,
 * not during parsing. These reflect UI needs, not Org semantics.
 */
export type RenderCategory = "all-day" | "timed" | "deadline" | "scheduled";

/**
 * A single item in the agenda view.
 * Links back to the full OrgEntry for access to title, tags, body, etc.
 */
export interface AgendaItem {
  readonly entry: OrgEntry;
  readonly date: Date;
  readonly startTime: string | null;
  readonly endTime: string | null;
  readonly category: RenderCategory;
  readonly sourceTimestamp: OrgTimestamp;
}

/**
 * All agenda items for a single calendar day.
 */
export interface AgendaDay {
  readonly date: Date;
  readonly items: readonly AgendaItem[];
}

/**
 * An upcoming deadline shown in the global deadlines section.
 * Separate from per-day AgendaItems — deadlines are displayed
 * at the top of the agenda, not inside a specific day card.
 */
export interface DeadlineItem {
  readonly entry: OrgEntry;
  readonly dueDate: Date;
  readonly daysUntil: number;
  readonly sourceTimestamp: OrgTimestamp;
}

/**
 * A TODO item that is past its deadline or scheduled date.
 * Shown in the "Overdue" section at the top of the agenda.
 */
export interface OverdueItem {
  readonly entry: OrgEntry;
  readonly dueDate: Date;
  readonly daysOverdue: number;
  readonly kind: "deadline" | "scheduled";
  readonly sourceTimestamp: OrgTimestamp;
}

/**
 * An undated TODO item shown in the "Someday" section.
 * These are entries with a TODO state but no timestamps or planning lines.
 */
export interface SomedayItem {
  readonly entry: OrgEntry;
}

/**
 * A 7-day view. Always 7 elements: index 0 = start date, index 6 = start date + 6.
 */
export type AgendaWeek = readonly [
  AgendaDay,
  AgendaDay,
  AgendaDay,
  AgendaDay,
  AgendaDay,
  AgendaDay,
  AgendaDay,
];
