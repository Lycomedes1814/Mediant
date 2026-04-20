/**
 * Pure source-text mutation helpers used by the edit panel.
 *
 * These operate on raw Org text and source line numbers so the UI can
 * test its rewrite behavior without going through DOM event handlers.
 */

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
  const newHasPlanning = newBlockLines.some((line) => planningRe.test(line));
  let dropBare = newBlockLines.some((line) => bareRe.test(line));
  const preserved: string[] = [];

  for (let i = startIdx + 1; i < endIdx; i++) {
    const line = lines[i];
    if (newHasPlanning && planningRe.test(line)) continue;
    if (dropBare && bareRe.test(line)) {
      dropBare = false;
      continue;
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
  const next = match[2] === "TODO" ? "DONE" : "TODO";
  lines[idx] = `${match[1]}${next}${match[3] ?? ""}`;
  return lines.join("\n");
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
