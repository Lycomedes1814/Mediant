import type { OrgTimestamp } from "./timestamp.ts";

export type TodoState = "TODO" | "DONE" | null;

/**
 * A SCHEDULED or DEADLINE planning entry attached to a heading.
 */
export interface OrgPlanning {
  readonly kind: "scheduled" | "deadline";
  readonly timestamp: OrgTimestamp;
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
  readonly title: string;
  readonly tags: readonly string[];
  readonly planning: readonly OrgPlanning[];
  readonly timestamps: readonly OrgTimestamp[];
  readonly body: string;
  readonly sourceLineNumber: number;
}
