/**
 * Dynamic tag color management.
 *
 * Auto-assigns colors from a palette to tags as they appear,
 * persists assignments in localStorage so they stay consistent.
 */

const STORAGE_KEY = "mediant-tag-colors";

/** Default palette — visually distinct, works on both light and dark backgrounds. */
const PALETTE = [
  "#3b82f6", // blue
  "#8b5cf6", // violet
  "#22c55e", // green
  "#d97706", // amber
  "#14b8a6", // teal
  "#65a30d", // lime
  "#ef4444", // red
  "#ec4899", // pink
  "#f97316", // orange
  "#06b6d4", // cyan
  "#a855f7", // purple
  "#84cc16", // yellow-green
];

const DEFAULT_COLOR = "#9ca3af";

let colorMap: Record<string, string> | null = null;

function load(): Record<string, string> {
  if (colorMap !== null) return colorMap;
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    colorMap = stored ? JSON.parse(stored) : {};
  } catch {
    colorMap = {};
  }
  return colorMap!;
}

function save(): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(colorMap));
}

/** Get the color for a tag, auto-assigning from the palette if new. */
export function getTagColor(tag: string): string {
  const map = load();
  if (map[tag]) return map[tag];

  // Assign next unused palette color (cycle if exhausted)
  const usedColors = new Set(Object.values(map));
  const available = PALETTE.find((c) => !usedColors.has(c));
  const color = available ?? PALETTE[Object.keys(map).length % PALETTE.length];

  map[tag] = color;
  save();
  return color;
}

/** Set a custom color for a tag. */
export function setTagColor(tag: string, color: string): void {
  const map = load();
  map[tag] = color;
  save();
}

/** Default fallback color. */
export const TAG_DEFAULT_COLOR = DEFAULT_COLOR;
