/**
 * DOM rendering: AgendaWeek + DeadlineItem[] → HTML.
 *
 * Reads from the agenda data model, writes to the DOM.
 * No parsing or date logic here — that belongs to earlier stages.
 */

import type { AgendaWeek, AgendaDay, AgendaItem, DeadlineItem, OverdueItem, SomedayItem } from "../agenda/model.ts";
import { getTagColor, setTagColor, TAG_DEFAULT_COLOR } from "./tagColors.ts";
import { notificationsEnabled, setNotificationsEnabled, requestPermission, clearScheduled, scheduleNotifications } from "./notifications.ts";

export interface RenderAgendaOptions {
  readonly activeTagFilters?: readonly string[];
  readonly tagColorEditMode?: boolean;
}

export function createThemeToggle(): HTMLButtonElement {
  const btn = document.createElement("button");
  btn.className = "theme-toggle";
  btn.setAttribute("aria-label", "Toggle dark mode");
  btn.textContent = document.documentElement.dataset.theme === "dark" ? "\u2600" : "\u263E";
  btn.addEventListener("click", () => {
    const isDark = document.documentElement.dataset.theme === "dark";
    if (isDark) {
      delete document.documentElement.dataset.theme;
      localStorage.setItem("theme", "light");
      btn.textContent = "\u263E";
    } else {
      document.documentElement.dataset.theme = "dark";
      localStorage.setItem("theme", "dark");
      btn.textContent = "\u2600";
    }
  });
  return btn;
}

export function createNotificationToggle(): HTMLButtonElement {
  const btn = document.createElement("button");
  btn.className = "notification-toggle";
  btn.setAttribute("aria-label", "Toggle notifications");
  const bellOutline = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/></svg>`;
  const bellFilled = `<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/></svg>`;
  const update = () => {
    const on = notificationsEnabled();
    btn.innerHTML = on ? bellFilled : bellOutline;
    btn.classList.toggle("is-on", on);
  };
  update();
  btn.addEventListener("click", async () => {
    if (notificationsEnabled()) {
      setNotificationsEnabled(false);
      clearScheduled();
    } else {
      const granted = await requestPermission();
      if (!granted) return;
      setNotificationsEnabled(true);
    }
    update();
    // Re-render to pick up scheduling
    btn.dispatchEvent(new CustomEvent("notification-toggled", { bubbles: true }));
  });
  return btn;
}

const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const MONTH_NAMES = ["January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December"];

// ── Public API ───────────────────────────────────────────────────────

function renderAgendaBase(
  container: HTMLElement,
  week: AgendaWeek,
  deadlines: DeadlineItem[],
  overdue: OverdueItem[],
  someday: SomedayItem[],
  today: Date,
  options: RenderAgendaOptions = {},
): void {
  container.innerHTML = "";

  // Header
  const startDate = week[0].date;
  const endDate = week[6].date;
  container.appendChild(renderHeader(startDate, endDate, options));

  // Overdue section (before deadlines — most urgent)
  if (overdue.length > 0) {
    container.appendChild(renderOverdue(overdue));
  }

  // Deadlines section
  if (deadlines.length > 0) {
    container.appendChild(renderDeadlines(deadlines));
  }

  // Days card (all 7 days in one container, divided by thin rules)
  const daysCard = el("section", "days-card");
  for (let i = 0; i < 7; i++) {
    daysCard.appendChild(renderDay(week[i], i, today));
  }
  container.appendChild(daysCard);

  // Someday section
  if (someday.length > 0) {
    container.appendChild(renderSomeday(someday));
  }
}

// ── Header ───────────────────────────────────────────────────────────

function renderHeader(startDate: Date, endDate: Date, options: RenderAgendaOptions): HTMLElement {
  const header = el("header", "agenda-header");

  const nav = el("nav", "agenda-nav");

  const prevBtn = el("button", "nav-arrow");
  prevBtn.innerHTML = "&larr;";
  prevBtn.setAttribute("aria-label", "Previous 7 days");
  prevBtn.dataset.action = "prev";

  const title = el("span", "nav-title");
  const weekDate = el("span", "nav-week-date");
  weekDate.textContent = formatDateRange(startDate, endDate);
  title.append(weekDate);

  const nextBtn = el("button", "nav-arrow");
  nextBtn.innerHTML = "&rarr;";
  nextBtn.setAttribute("aria-label", "Next 7 days");
  nextBtn.dataset.action = "next";

  nav.append(prevBtn, title, nextBtn);

  const actions = el("div", "agenda-actions");

  const todayBtn = el("button", "agenda-nav-today");
  todayBtn.textContent = "Today";
  todayBtn.dataset.action = "today";

  const addBtn = el("button", "add-item-btn");
  addBtn.textContent = "+Add";
  addBtn.dataset.action = "add";

  const colorModeBtn = el("button", "tag-color-mode-toggle");
  colorModeBtn.textContent = options.tagColorEditMode ? "Color tags: on" : "Color tags";
  colorModeBtn.dataset.action = "toggle-tag-color-mode";
  colorModeBtn.setAttribute("aria-pressed", options.tagColorEditMode ? "true" : "false");
  if (options.tagColorEditMode) colorModeBtn.classList.add("is-on");

  actions.append(todayBtn, addBtn, colorModeBtn, createNotificationToggle(), createThemeToggle());
  header.append(nav, actions);

  if ((options.activeTagFilters?.length ?? 0) > 0) {
    header.appendChild(renderActiveTagFilters(options.activeTagFilters ?? []));
  }
  return header;
}

function renderActiveTagFilters(tags: readonly string[]): HTMLElement {
  const row = el("div", "active-tag-filters");

  const label = el("span", "active-tag-filters-label");
  label.textContent = "Filtering:";
  row.appendChild(label);

  for (const tag of tags) {
    row.appendChild(renderTag(tag, { selected: true }));
  }

  const clearBtn = el("button", "clear-tag-filters");
  clearBtn.textContent = "Clear";
  clearBtn.dataset.action = "clear-tag-filters";
  row.appendChild(clearBtn);
  return row;
}

// ── Deadlines ────────────────────────────────────────────────────────

function renderDeadlines(deadlines: DeadlineItem[]): HTMLElement {
  const section = el("section", "deadlines-section");

  const header = el("header", "deadlines-header");
  header.textContent = "Upcoming deadlines";
  section.appendChild(header);

  for (const dl of deadlines) {
    const row = el("div", "deadline-item");
    if (dl.entry.todo === "DONE") row.classList.add("item-done");

    const meta = el("span", "deadline-meta");
    const time = el("span", "item-time");
    time.textContent = dl.daysUntil === 0 ? "Today" : `In ${dl.daysUntil} days`;
    const state = renderStateBadge(dl.entry);
    meta.append(time, state);
    if (dl.entry.priority) {
      const pri = el("span", `item-priority priority-${dl.entry.priority} deadline-meta-priority`);
      pri.textContent = dl.entry.priority;
      meta.appendChild(pri);
    }

    const title = renderTitle(dl.entry);
    if (dl.baseDate) title.dataset.baseDate = dl.baseDate;

    row.append(title, meta, renderTags(dl.entry.tags, optionsForTags()));
    section.appendChild(row);
  }

  return section;
}

// ── Overdue ─────────────────────────────────────────────────────────

function renderOverdue(items: OverdueItem[]): HTMLElement {
  const section = el("section", "overdue-section");

  const header = el("header", "overdue-header");
  header.textContent = "Overdue";
  section.appendChild(header);

  for (const item of items) {
    const row = el("div", "overdue-item");

    const meta = el("span", "overdue-meta");
    const time = el("span", "item-time");
    time.textContent = `${item.daysOverdue} days overdue`;
    const kind = el("span", "item-kind");
    kind.textContent = item.kind === "deadline" ? "DEADLINE" : "SCHEDULED";
    meta.append(time, kind);

    const title = renderTitle(item.entry);
    if (item.baseDate) title.dataset.baseDate = item.baseDate;

    row.append(title, meta, renderTags(item.entry.tags, optionsForTags()));
    section.appendChild(row);
  }

  return section;
}

// ── Someday ─────────────────────────────────────────────────────────

function renderSomeday(items: SomedayItem[]): HTMLElement {
  const section = el("section", "someday-section");

  const header = el("header", "someday-header");
  header.textContent = "Someday";
  section.appendChild(header);

  for (const item of items) {
    const row = el("div", "someday-item");
    if (item.entry.todo === "DONE") row.classList.add("item-done");

    const state = renderStateBadge(item.entry, "TODO");
    const title = renderTitle(item.entry);

    row.append(state, title, renderTags(item.entry.tags, optionsForTags()));
    section.appendChild(row);
  }

  return section;
}

// ── Day card ─────────────────────────────────────────────────────────

function renderDay(day: AgendaDay, dayIndex: number, today: Date): HTMLElement {
  const card = el("article", "day-block");

  const isToday = isSameDate(day.date, today);
  if (isToday) card.classList.add("is-today");

  // Header
  const header = el("header", "day-header");
  const label = el("span", "date-label");
  let dayText = `${DAY_NAMES[day.date.getDay()]} ${day.date.getDate()} ${MONTH_NAMES[day.date.getMonth()]}`;
  if (day.date.getDay() === 1) {
    dayText += ` (W${getISOWeek(day.date)})`;
  }
  label.textContent = dayText;
  header.appendChild(label);

  if (isToday) {
    header.appendChild(el("span", "today-marker"));
  }

  card.appendChild(header);

  // Separate items by category
  const allDay = day.items.filter((i) => i.category === "all-day");
  const rest = day.items.filter((i) => i.category !== "all-day");

  // All-day section
  if (allDay.length > 0) {
    const section = el("div", "allday-section");
    for (const item of allDay) {
      section.appendChild(renderAllDayItem(item));
    }
    card.appendChild(section);
  }

  // Timed / scheduled section
  if (rest.length > 0) {
    const section = el("div", "timed-section");

    const nowMinutes = isToday
      ? today.getHours() * 60 + today.getMinutes()
      : -1;
    let nowLineInserted = !isToday;

    for (const item of rest) {
      // Insert now line before the first item that starts at or after current time
      if (!nowLineInserted) {
        const itemMinutes = item.startTime ? timeToMinutes(item.startTime) : -1;
        if (itemMinutes >= nowMinutes) {
          section.appendChild(renderNowLine(today));
          nowLineInserted = true;
        }
      }

      if (item.category === "scheduled") {
        section.appendChild(renderScheduledItem(item));
      } else if (item.category === "deadline") {
        section.appendChild(renderDayDeadlineItem(item));
      } else {
        section.appendChild(renderTimedItem(item));
      }

      // Instance note (per-occurrence)
      if (item.instanceNote) {
        section.appendChild(renderInstanceNote(item));
      }

      // Body text
      if (item.entry.body) {
        const body = el("div", "item-body");
        body.textContent = item.entry.body;
        section.appendChild(body);
      }

      // Checkbox items
      if (item.entry.checkboxItems.length > 0) {
        section.appendChild(renderCheckboxItems(item.entry.checkboxItems));
      }
    }

    // If all items are before now, append the line at the end
    if (!nowLineInserted) {
      section.appendChild(renderNowLine(today));
    }

    card.appendChild(section);
  }

  // Empty day
  if (allDay.length === 0 && rest.length === 0) {
    const empty = el("div", "day-empty");
    empty.textContent = "—";
    card.appendChild(empty);
  }

  return card;
}

// ── Item renderers ───────────────────────────────────────────────────

function renderItem(
  item: AgendaItem,
  className: string,
  badge?: HTMLElement | HTMLElement[],
  showTime?: "always" | "optional",
): HTMLElement {
  const row = el("div", className);
  if (item.entry.todo === "DONE") row.classList.add("item-done");
  if (item.skipped) row.classList.add("item-skipped");

  const primaryTag = item.entry.tags[0];
  if (primaryTag) row.style.borderLeftColor = getTagColor(primaryTag);

  const children: HTMLElement[] = [];

  const hasTime = showTime === "always" || (showTime === "optional" && item.startTime);
  if (hasTime) {
    if (showTime === "optional") row.classList.add("has-time");
    const time = el("span", "item-time");
    time.textContent = formatTimeRange(item.startTime, item.endTime);
    children.push(time);
  }

  if (badge) {
    if (Array.isArray(badge)) children.push(...badge);
    else children.push(badge);
  } else if (item.entry.todo) {
    row.classList.add("has-state");
    children.push(renderStateBadge(item.entry));
  }

  const title = renderTitle(item.entry);
  if (item.baseDate) title.dataset.baseDate = item.baseDate;
  if (item.override) {
    title.appendChild(document.createTextNode(" "));
    title.appendChild(renderOverrideChip(item.override));
  }
  children.push(title, renderTags(item.entry.tags, optionsForTags()));
  row.append(...children);
  return row;
}

function renderOverrideChip(
  override: { kind: "cancelled" | "shift" | "reschedule"; detail: string },
): HTMLElement {
  const chipClass = override.kind === "cancelled"
    ? "item-override-chip override-cancelled"
    : "item-override-chip";
  const chip = el("span", chipClass);
  chip.textContent =
    override.kind === "cancelled"
      ? "skipped"
      : "moved";
  chip.title = override.detail;
  chip.setAttribute("aria-label", `${chip.textContent} (${override.detail})`);
  return chip;
}

function renderInstanceNote(item: AgendaItem): HTMLElement {
  const row = el("div", buildInstanceNoteClassName(item));
  const text = el("div", "item-instance-note-text");
  text.textContent = item.instanceNote ?? "";
  row.appendChild(text);
  return row;
}

function buildInstanceNoteClassName(item: AgendaItem): string {
  const classes = ["item-instance-note"];
  if (item.category === "timed") {
    classes.push("note-layout-timed");
    classes.push(item.entry.todo ? "note-title-col-3" : "note-title-col-2");
    return classes.join(" ");
  }
  if (item.category === "scheduled") {
    classes.push(item.startTime ? "note-layout-with-time" : "note-layout-compact");
    classes.push(item.startTime ? "note-title-col-3" : "note-title-col-2");
    return classes.join(" ");
  }
  if (item.category === "deadline") {
    classes.push(item.startTime ? "note-layout-with-time" : "note-layout-compact");
    classes.push(item.startTime ? "note-title-col-3" : "note-title-col-2");
    return classes.join(" ");
  }
  classes.push("note-layout-compact", "note-title-col-2");
  return classes.join(" ");
}

function renderAllDayItem(item: AgendaItem): HTMLElement {
  return renderItem(item, "allday-item");
}

function renderTimedItem(item: AgendaItem): HTMLElement {
  return renderItem(item, "timed-item", undefined, "always");
}

function renderScheduledItem(item: AgendaItem): HTMLElement {
  return renderItem(item, "scheduled-item", renderStateBadge(item.entry, "TODO"), "optional");
}

function renderDayDeadlineItem(item: AgendaItem): HTMLElement {
  const kind = el("span", "item-kind");
  kind.textContent = "DEADLINE";
  return renderItem(item, "day-deadline-item", [kind, renderStateBadge(item.entry, "TODO")], "optional");
}

// ── State badge ─────────────────────────────────────────────────────

function renderStateBadge(
  entry: { todo: "TODO" | "DONE" | null; sourceLineNumber: number },
  fallback?: string,
): HTMLElement {
  const state = el("span", "item-state");
  state.textContent = entry.todo ?? fallback ?? "";
  if (entry.todo) {
    state.classList.add("is-toggleable");
    state.dataset.action = "toggle-done";
    state.dataset.line = String(entry.sourceLineNumber);
    state.setAttribute("role", "button");
    state.setAttribute("tabindex", "0");
    state.setAttribute("aria-label", entry.todo === "TODO" ? "Mark done" : "Mark not done");
  }
  return state;
}

// ── Now line ─────────────────────────────────────────────────────────

function renderNowLine(today: Date): HTMLElement {
  const row = el("div", "now-line");

  const time = el("span", "now-time");
  const hh = String(today.getHours()).padStart(2, "0");
  const mm = String(today.getMinutes()).padStart(2, "0");
  time.textContent = hh + ":" + mm;

  const label = el("span", "now-label");
  label.textContent = "\u25C4 now";

  const rule = el("span", "now-rule");

  row.append(time, label, rule);
  return row;
}

// ── Helpers ──────────────────────────────────────────────────────────

function renderTitle(entry: { title: string; priority: "A" | "B" | "C" | null; progress?: { done: number; total: number } | null; sourceLineNumber: number }): HTMLElement {
  const title = el("span", "item-title");
  title.dataset.action = "edit";
  title.dataset.line = String(entry.sourceLineNumber);
  title.setAttribute("role", "button");
  title.setAttribute("tabindex", "0");
  if (entry.priority) {
    const badge = el("span", `item-priority priority-${entry.priority}`);
    badge.textContent = entry.priority;
    title.appendChild(badge);
    title.appendChild(document.createTextNode(" "));
  }
  title.appendChild(document.createTextNode(entry.title));
  if (entry.progress) {
    title.appendChild(document.createTextNode(" "));
    const badge = el("span", "item-progress");
    badge.textContent = `${entry.progress.done}/${entry.progress.total}`;
    if (entry.progress.done === entry.progress.total && entry.progress.total > 0) {
      badge.classList.add("progress-complete");
    }
    title.appendChild(badge);
  }
  return title;
}

function renderCheckboxItems(items: readonly { text: string; checked: boolean }[]): HTMLElement {
  const list = el("div", "checkbox-list");
  for (const item of items) {
    const row = el("div", "checkbox-item");
    if (item.checked) row.classList.add("checkbox-checked");
    const icon = el("span", "checkbox-icon");
    icon.textContent = item.checked ? "\u2611" : "\u2610";
    const label = el("span", "checkbox-label");
    label.textContent = item.text;
    row.append(icon, label);
    list.appendChild(row);
  }
  return list;
}

function optionsForTags(): Pick<RenderAgendaOptions, "activeTagFilters" | "tagColorEditMode"> {
  return currentRenderOptions;
}

let currentRenderOptions: Pick<RenderAgendaOptions, "activeTagFilters" | "tagColorEditMode"> = {};

function renderTags(tags: readonly string[], options: Pick<RenderAgendaOptions, "activeTagFilters" | "tagColorEditMode">): HTMLElement {
  const badges = el("span", "tag-badges");
  for (const tag of tags) {
    badges.appendChild(renderTag(tag, {
      selected: (options.activeTagFilters ?? []).includes(tag),
      colorEditMode: options.tagColorEditMode ?? false,
    }));
  }
  return badges;
}

function renderTag(
  tag: string,
  options: { selected?: boolean; colorEditMode?: boolean } = {},
): HTMLElement {
  const span = el("span", "tag");
  span.dataset.tag = tag;
  span.dataset.action = "toggle-tag-filter";
  span.style.background = getTagColor(tag);
  span.textContent = tag;
  span.setAttribute("role", "button");
  span.setAttribute("tabindex", "0");
  span.setAttribute("aria-pressed", options.selected ? "true" : "false");
  span.setAttribute("aria-label", options.selected ? `Remove tag filter ${tag}` : `Filter by tag ${tag}`);
  if (options.selected) span.classList.add("is-selected");
  if (options.colorEditMode) span.classList.add("is-color-editable");

  const picker = document.createElement("input");
  picker.type = "color";
  picker.className = "tag-color-picker";
  picker.value = getTagColor(tag);

  picker.addEventListener("click", (e) => {
    e.stopPropagation();
  });

  picker.addEventListener("input", () => {
    setTagColor(tag, picker.value);
    document.querySelectorAll<HTMLElement>(`.tag[data-tag="${tag}"]`).forEach((el) => {
      el.style.background = picker.value;
    });
  });

  span.appendChild(picker);
  return span;
}

export function renderAgenda(
  container: HTMLElement,
  week: AgendaWeek,
  deadlines: DeadlineItem[],
  overdue: OverdueItem[],
  someday: SomedayItem[],
  today: Date,
  options: RenderAgendaOptions = {},
): void {
  currentRenderOptions = {
    activeTagFilters: options.activeTagFilters ?? [],
    tagColorEditMode: options.tagColorEditMode ?? false,
  };
  renderAgendaBase(container, week, deadlines, overdue, someday, today, options);
  currentRenderOptions = {};
}

export function openTagColorPicker(tagEl: HTMLElement): void {
  const picker = tagEl.querySelector<HTMLInputElement>(".tag-color-picker");
  picker?.click();
}

function formatTimeRange(start: string | null, end: string | null): string {
  if (!start) return "";
  if (!end) return start;
  return `${start}–${end}`;
}

function timeToMinutes(time: string): number {
  const [h, m] = time.split(":").map(Number);
  return h * 60 + m;
}

function getISOWeek(d: Date): number {
  const tmp = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  tmp.setDate(tmp.getDate() + 3 - ((tmp.getDay() + 6) % 7));
  const jan4 = new Date(tmp.getFullYear(), 0, 4);
  return 1 + Math.round(((tmp.getTime() - jan4.getTime()) / 86400000 - 3 + ((jan4.getDay() + 6) % 7)) / 7);
}

function isSameDate(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear()
    && a.getMonth() === b.getMonth()
    && a.getDate() === b.getDate();
}

function formatDateRange(start: Date, end: Date): string {
  const sameMonth = start.getMonth() === end.getMonth();
  const sameYear = start.getFullYear() === end.getFullYear();
  if (sameMonth && sameYear) {
    return `${start.getDate()}–${end.getDate()} ${MONTH_NAMES[start.getMonth()]} ${start.getFullYear()}`;
  }
  if (sameYear) {
    return `${start.getDate()} ${MONTH_NAMES[start.getMonth()]} – ${end.getDate()} ${MONTH_NAMES[end.getMonth()]} ${start.getFullYear()}`;
  }
  return `${start.getDate()} ${MONTH_NAMES[start.getMonth()]} ${start.getFullYear()} – ${end.getDate()} ${MONTH_NAMES[end.getMonth()]} ${end.getFullYear()}`;
}

function el(tag: string, className?: string): HTMLElement {
  const e = document.createElement(tag);
  if (className) e.className = className;
  return e;
}
