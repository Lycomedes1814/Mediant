import type { OrgTimestamp } from "./timestamp.ts";

export type TodoState = "TODO" | "DONE" | null;

export type Priority = "A" | "B" | "C" | null;

/**
 * A single checkbox list item (`- [ ] text` / `- [X] text`).
 */
export interface CheckboxItem {
  readonly text: string;
  readonly checked: boolean;
}

/**
 * A SCHEDULED or DEADLINE planning entry attached to a heading.
 */
export interface OrgPlanning {
  readonly kind: "scheduled" | "deadline";
  readonly timestamp: OrgTimestamp;
}

/**
 * Behaviour override for a single recurrence occurrence.
 * Stored in the entry's property drawer keyed by the base (unshifted)
 * occurrence date. See `RecurrenceException`.
 */
export type RecurrenceOverride =
  | { readonly kind: "cancelled" }
  | { readonly kind: "shift"; readonly offsetMinutes: number }
  | {
      readonly kind: "reschedule";
      readonly date: string;
      readonly startTime: string | null;
      readonly endTime: string | null;
    };

/**
 * A per-occurrence deviation from the base recurrence.
 *
 * `override` is behaviour (cancelled / shift / reschedule).
 * `note` is metadata — independent of any override, so a single
 * occurrence can e.g. be shifted AND carry a note, or be cancelled
 * AND carry a note (the note remains visible in the edit panel even
 * if the occurrence is not rendered).
 */
export interface RecurrenceException {
  readonly override: RecurrenceOverride | null;
  readonly note: string | null;
}

/**
 * A single parsed Org heading with all its associated data.
 *
 * This is the parser's output — it mirrors Org semantics faithfully
 * without any agenda/display classification. Classification into
 * render categories (all-day, timed, deadline, scheduled) happens
 * later in the agenda generation stage.
 *
 * Cardinality:
 *   - planning: zero, one, or multiple entries. A heading may have
 *     both a SCHEDULED and a DEADLINE, or multiples of either.
 *   - timestamps: zero or more active timestamps found in the body
 *     or as standalone lines under the heading.
 *   - body: zero or more lines of free text, joined with newlines.
 *     Empty string if no body text.
 *
 * Debug context:
 *   sourceLineNumber points to the heading's line in the .org file
 *   (1-based). Combined with raw timestamp text on OrgTimestamp, this
 *   provides enough context to trace parser output back to source.
 */
export interface OrgEntry {
  readonly level: number;
  readonly todo: TodoState;
  readonly priority: Priority;
  readonly title: string;
  readonly tags: readonly string[];
  readonly planning: readonly OrgPlanning[];
  readonly timestamps: readonly OrgTimestamp[];
  readonly checkboxItems: readonly CheckboxItem[];
  readonly progress: { readonly done: number; readonly total: number } | null;
  readonly body: string;
  readonly sourceLineNumber: number;
  /**
   * Per-occurrence deviations keyed by base date (YYYY-MM-DD).
   * Always present; an empty map means no exceptions. The map is
   * populated from any `:EXCEPTION-<date>:` / `:EXCEPTION-NOTE-<date>:`
   * properties on the heading, regardless of whether the entry actually
   * has a repeating timestamp — on non-recurring entries the map is
   * **parsed but inert** (expansion never runs, so nothing ever applies).
   * That is intentional; don't "fix" it by applying the map to a single
   * timestamp.
   */
  readonly exceptions: ReadonlyMap<string, RecurrenceException>;
  /**
   * Exclusive end date of the recurring series (`YYYY-MM-DD`), or `null`
   * if the series has no end. Populated from a `:SERIES-UNTIL:` property
   * in the heading's `:PROPERTIES:` drawer.
   *
   * Exclusive: an occurrence whose base date is exactly `seriesUntil` is
   * not generated. This matches the "split into two headings" model —
   * the successor heading may start *on* `seriesUntil` without overlap.
   *
   * Like `exceptions`, this is parsed regardless of whether the entry
   * has a repeater. On non-recurring entries it is **parsed but inert**
   * (expansion never runs).
   */
  readonly seriesUntil: string | null;
}
