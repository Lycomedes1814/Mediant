/**
 * Property-drawer mutation helpers.
 *
 * These operate on raw Org source text (strings) and preserve
 * formatting: existing keys keep their order, other keys in the drawer
 * are untouched, and a freshly created drawer is placed deterministically
 * (immediately after any planning / standalone-timestamp lines that
 * follow the heading, before body text).
 *
 * The helpers live outside the parser on purpose — they're text
 * mutation utilities, not part of parsing. They take an `OrgEntry`
 * only for its `sourceLineNumber`, which locates the heading in the
 * source.
 */

import type { OrgEntry } from "./model.ts";

const HEADING_RE = /^\*+\s+/;
const DRAWER_OPEN_RE = /^\s*:([A-Z_]+):\s*$/;
const DRAWER_CLOSE_RE = /^\s*:END:\s*$/;
const PLANNING_LINE_RE = /^\s*(?:SCHEDULED|DEADLINE|CLOSED):/;
const TIMESTAMP_LINE_RE = /^\s*(?:<[^>]*>\s*)+$/;

/**
 * Insert or update a `:key: value` line in the entry's PROPERTIES
 * drawer. Creates the drawer if absent. Idempotent: repeating with the
 * same (key, value) returns the source unchanged.
 */
export function upsertProperty(
  source: string,
  entry: OrgEntry,
  key: string,
  value: string,
): string {
  const lines = source.split("\n");
  const [start, end] = entryLineRange(lines, entry);
  const drawer = findPropertiesDrawer(lines, start, end);
  const newLine = `:${key}: ${value}`;
  const keyLineRe = new RegExp(`^\\s*:${escapeRegex(key)}:`);

  if (drawer !== null) {
    for (let i = drawer.open + 1; i < drawer.close; i++) {
      if (keyLineRe.test(lines[i])) {
        if (lines[i] === newLine) return source; // idempotent
        lines[i] = newLine;
        return lines.join("\n");
      }
    }
    // Key not present — append before :END:.
    lines.splice(drawer.close, 0, newLine);
    return lines.join("\n");
  }

  // No PROPERTIES drawer yet — create one at the deterministic spot.
  const insertAt = drawerInsertionPoint(lines, start, end);
  lines.splice(insertAt, 0, ":PROPERTIES:", newLine, ":END:");
  return lines.join("\n");
}

/**
 * Remove a `:key:` line from the entry's PROPERTIES drawer. No-op if
 * the key is absent. If removing the key would leave an empty drawer,
 * the whole `:PROPERTIES: … :END:` block is dropped.
 */
export function removeProperty(
  source: string,
  entry: OrgEntry,
  key: string,
): string {
  const lines = source.split("\n");
  const [start, end] = entryLineRange(lines, entry);
  const drawer = findPropertiesDrawer(lines, start, end);
  if (drawer === null) return source;

  const keyLineRe = new RegExp(`^\\s*:${escapeRegex(key)}:`);
  let removeAt = -1;
  for (let i = drawer.open + 1; i < drawer.close; i++) {
    if (keyLineRe.test(lines[i])) {
      removeAt = i;
      break;
    }
  }
  if (removeAt === -1) return source;

  // If this is the only content line, drop the whole drawer.
  if (drawer.close - drawer.open === 2) {
    lines.splice(drawer.open, 3);
  } else {
    lines.splice(removeAt, 1);
  }
  return lines.join("\n");
}

// ── Helpers ──────────────────────────────────────────────────────────

function entryLineRange(lines: string[], entry: OrgEntry): [number, number] {
  const start = entry.sourceLineNumber - 1;
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i++) {
    if (HEADING_RE.test(lines[i])) {
      end = i;
      break;
    }
  }
  return [start, end];
}

function findPropertiesDrawer(
  lines: string[],
  start: number,
  end: number,
): { open: number; close: number } | null {
  for (let i = start + 1; i < end; i++) {
    const openMatch = lines[i].match(DRAWER_OPEN_RE);
    if (!openMatch) continue;
    if (openMatch[1] !== "PROPERTIES") continue;
    for (let j = i + 1; j < end; j++) {
      if (DRAWER_CLOSE_RE.test(lines[j])) {
        return { open: i, close: j };
      }
    }
    return null; // malformed / unterminated drawer
  }
  return null;
}

/**
 * Where to insert a fresh PROPERTIES drawer: after any planning or
 * standalone-timestamp lines directly following the heading, but
 * before body text.
 */
function drawerInsertionPoint(lines: string[], start: number, end: number): number {
  let idx = start + 1;
  while (idx < end) {
    const line = lines[idx];
    if (PLANNING_LINE_RE.test(line) || TIMESTAMP_LINE_RE.test(line)) {
      idx++;
      continue;
    }
    break;
  }
  return idx;
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
