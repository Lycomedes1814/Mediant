/**
 * DOM rendering: AgendaDay[] + DeadlineItem[] → HTML.
 *
 * Reads from the agenda data model, writes to the DOM.
 * No parsing or date logic here — that belongs to earlier stages.
 */

import type { AgendaDay, AgendaItem, DeadlineItem, OverdueItem, SomedayItem } from "../agenda/model.ts";
import { getTagColor, setTagColor, TAG_DEFAULT_COLOR } from "./tagColors.ts";
import { notificationsEnabled, setNotificationsEnabled, requestPermission, clearScheduled, scheduleNotifications } from "./notifications.ts";
import { DAY_NAMES, MONTH_NAMES } from "../dateLabels.ts";

export interface RenderAgendaOptions {
  readonly activeTagFilters?: readonly string[];
  readonly tagColorEditMode?: boolean;
  readonly hideEmptyDays?: boolean;
  readonly hideCompletedAndSkipped?: boolean;
  readonly monthAhead?: boolean;
}

interface ToggleButtonOptions {
  readonly label?: boolean;
}

export function createThemeToggle(options: ToggleButtonOptions = {}): HTMLButtonElement {
  const btn = document.createElement("button");
  btn.className = options.label ? "theme-toggle is-labeled" : "theme-toggle";
  const update = () => {
    const isDark = document.documentElement.dataset.theme === "dark";
    const nextThemeLabel = isDark ? "Light theme" : "Dark theme";
    btn.textContent = options.label ? nextThemeLabel : isDark ? "\u2600" : "\u263E";
    btn.setAttribute("aria-label", options.label ? nextThemeLabel : "Toggle dark mode");
  };
  update();
  btn.addEventListener("click", () => {
    const isDark = document.documentElement.dataset.theme === "dark";
    if (isDark) {
      delete document.documentElement.dataset.theme;
      localStorage.setItem("theme", "light");
    } else {
      document.documentElement.dataset.theme = "dark";
      localStorage.setItem("theme", "dark");
    }
    update();
  });
  return btn;
}

export function createNotificationToggle(options: ToggleButtonOptions = {}): HTMLButtonElement {
  const btn = document.createElement("button");
  btn.className = options.label ? "notification-toggle is-labeled" : "notification-toggle";
  const bellOutline = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/></svg>`;
  const bellFilled = `<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/></svg>`;
  const update = () => {
    const on = notificationsEnabled();
    const nextNotificationLabel = on ? "Disable notifications" : "Enable notifications";
    if (options.label) {
      btn.textContent = nextNotificationLabel;
    } else {
      btn.innerHTML = on ? bellFilled : bellOutline;
    }
    btn.setAttribute("aria-label", options.label ? nextNotificationLabel : "Toggle notifications");
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

// ── Public API ───────────────────────────────────────────────────────

function renderAgendaBase(
  container: HTMLElement,
  week: readonly AgendaDay[],
  deadlines: DeadlineItem[],
  overdue: OverdueItem[],
  someday: SomedayItem[],
  today: Date,
  options: RenderAgendaOptions = {},
): void {
  checkboxListIdCounter = 0;
  checkboxListsById.clear();
  renderedCheckboxListKeys = new Set();
  container.innerHTML = "";

  if (week.length === 0) return;

  // Header
  const startDate = week[0].date;
  const endDate = week[week.length - 1].date;
  container.appendChild(renderHeader(startDate, endDate, options));

  const hideCompleted = options.hideCompletedAndSkipped ?? false;

  // Overdue section (before deadlines — most urgent)
  if (overdue.length > 0) {
    container.appendChild(renderOverdue(overdue));
  }

  // Deadlines section
  if (deadlines.length > 0) {
    container.appendChild(renderDeadlines(deadlines));
  }

  // Days card (the visible date range in one container, divided by thin rules)
  const daysCard = el("section", "days-card");
  const filteredWeek: AgendaDay[] = hideCompleted
    ? week.map(day => ({
        date: day.date,
        items: day.items.filter(item => item.entry.todo !== "DONE" && !item.skipped),
      }))
    : [...week];
  const visibleDays = options.hideEmptyDays
    ? filteredWeek.filter(day => day.items.length > 0)
    : filteredWeek;
  if (visibleDays.length > 0) {
    for (const day of visibleDays) {
      daysCard.appendChild(renderDay(day, today));
    }
    container.appendChild(daysCard);
  }

  // Someday section
  const visibleSomeday = hideCompleted
    ? someday.filter(item => item.entry.todo !== "DONE")
    : someday;
  if (visibleSomeday.length > 0) {
    container.appendChild(renderSomeday(visibleSomeday));
  }

  for (const key of checkboxListCollapseState.keys()) {
    if (!renderedCheckboxListKeys.has(key)) checkboxListCollapseState.delete(key);
  }
}

// ── Header ───────────────────────────────────────────────────────────

function renderHeader(startDate: Date, endDate: Date, options: RenderAgendaOptions): HTMLElement {
  const header = el("header", "agenda-header");

  const nav = el("nav", "agenda-nav");

  const prevBtn = el("button", "nav-arrow");
  prevBtn.innerHTML = "&larr;";
  prevBtn.setAttribute("aria-label", options.monthAhead ? "Previous 30 days" : "Previous 7 days");
  prevBtn.dataset.action = "prev";

  const title = el("span", "nav-title");
  const weekDate = el("span", "nav-week-date");
  weekDate.textContent = formatDateRange(startDate, endDate);
  title.append(weekDate);

  const nextBtn = el("button", "nav-arrow");
  nextBtn.innerHTML = "&rarr;";
  nextBtn.setAttribute("aria-label", options.monthAhead ? "Next 30 days" : "Next 7 days");
  nextBtn.dataset.action = "next";

  const todayBtn = el("button", "agenda-nav-today");
  todayBtn.textContent = "Today";
  todayBtn.dataset.action = "today";
  todayBtn.setAttribute("aria-label", "Today");

  nav.append(prevBtn, title, nextBtn);

  const actions = el("div", "agenda-actions");
  const primaryActions = el("div", "agenda-primary-actions");

  const addBtn = el("button", "add-item-btn");
  addBtn.textContent = "+Add";
  addBtn.dataset.action = "add";
  addBtn.setAttribute("aria-label", "Add item");

  primaryActions.append(addBtn);
  actions.append(primaryActions, renderSettingsMenu(options));
  header.append(nav, todayBtn, actions);

  if ((options.activeTagFilters?.length ?? 0) > 0) {
    header.appendChild(renderActiveTagFilters(options.activeTagFilters ?? []));
  }
  return header;
}

function createColorModeToggle(options: RenderAgendaOptions): HTMLButtonElement {
  const colorModeBtn = el("button", "tag-color-mode-toggle");
  colorModeBtn.textContent = options.tagColorEditMode ? "Click tag to filter" : "Click tag to change color";
  colorModeBtn.dataset.action = "toggle-tag-color-mode";
  colorModeBtn.setAttribute("aria-label", options.tagColorEditMode ? "Click tag to filter" : "Click tag to change color");
  colorModeBtn.setAttribute("aria-pressed", options.tagColorEditMode ? "true" : "false");
  if (options.tagColorEditMode) colorModeBtn.classList.add("is-on");
  return colorModeBtn;
}

function createHideEmptyDaysToggle(options: RenderAgendaOptions): HTMLButtonElement {
  const hideEmptyDaysBtn = el("button", "hide-empty-days-toggle");
  hideEmptyDaysBtn.textContent = options.hideEmptyDays ? "Show empty days" : "Hide empty days";
  hideEmptyDaysBtn.dataset.action = "toggle-hide-empty-days";
  hideEmptyDaysBtn.setAttribute("aria-label", options.hideEmptyDays ? "Show empty days" : "Hide empty days");
  hideEmptyDaysBtn.setAttribute("aria-pressed", options.hideEmptyDays ? "true" : "false");
  if (options.hideEmptyDays) hideEmptyDaysBtn.classList.add("is-on");
  return hideEmptyDaysBtn;
}

function createHideCompletedToggle(options: RenderAgendaOptions): HTMLButtonElement {
  const btn = el("button", "hide-completed-toggle");
  const label = options.hideCompletedAndSkipped ? "Show completed & skipped" : "Hide completed & skipped";
  btn.textContent = label;
  btn.dataset.action = "toggle-hide-completed";
  btn.setAttribute("aria-label", label);
  btn.setAttribute("aria-pressed", options.hideCompletedAndSkipped ? "true" : "false");
  if (options.hideCompletedAndSkipped) btn.classList.add("is-on");
  return btn;
}

function createMonthAheadToggle(options: RenderAgendaOptions): HTMLButtonElement {
  const btn = el("button", "month-ahead-toggle");
  const label = options.monthAhead ? "Show 7 days" : "Show 30 days";
  btn.textContent = label;
  btn.dataset.action = "toggle-month-ahead";
  btn.setAttribute("aria-label", label);
  btn.setAttribute("aria-pressed", options.monthAhead ? "true" : "false");
  if (options.monthAhead) btn.classList.add("is-on");
  return btn;
}

function renderSettingsMenu(options: RenderAgendaOptions): HTMLElement {
  const menu = document.createElement("details");
  menu.className = "agenda-settings-menu";

  const summary = el("summary", "agenda-settings-summary");
  summary.textContent = "Settings";
  summary.setAttribute("aria-label", "Settings");
  menu.appendChild(summary);

  const panel = el("div", "agenda-settings-panel");
  panel.append(
    createColorModeToggle(options),
    createHideEmptyDaysToggle(options),
    createHideCompletedToggle(options),
    createMonthAheadToggle(options),
    createNotificationToggle({ label: true }),
    createThemeToggle({ label: true }),
  );
  menu.appendChild(panel);

  panel.querySelectorAll("button").forEach((button) => {
    button.addEventListener("click", () => {
      menu.open = false;
    });
  });

  return menu;
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

  for (const dl of deadlines) {
    const row = el("div", "deadline-item");
    if (dl.instanceNote) row.classList.add("has-instance-note");
    row.classList.add(getDeadlineUrgencyClass(dl.daysUntil));
    if (dl.entry.todo === "DONE") row.classList.add("item-done");
    if (dl.entry.checkboxItems.length > 0) row.classList.add("has-checkbox-list");
    applyPrimaryTagFringe(row, dl.entry.tags, "compact");

    const meta = el("span", "deadline-meta");
    const time = el("span", "item-time");
    time.textContent = formatDeadlineDueText(dl.daysUntil);
    meta.append(time);

    const checkboxListId = dl.entry.checkboxItems.length > 0 ? nextCheckboxListId() : null;
    const checkboxListKey = checkboxListId
      ? `deadline:${dl.entry.sourceLineNumber}:${dl.baseDate ?? formatDateKey(dl.dueDate)}`
      : null;
    const title = renderTitle(dl.entry);
    if (dl.baseDate) title.dataset.baseDate = dl.baseDate;
    if (checkboxListId && checkboxListKey) appendCheckboxToggle(title, checkboxListId, checkboxListKey);

    const main = el("span", "deadline-main");
    main.append(renderStateBadge(dl.entry), title);

    row.append(meta, main, renderTags(dl.entry.tags, optionsForTags()));
    section.appendChild(row);
    if (dl.instanceNote) {
      section.appendChild(renderGlobalInstanceNote(dl.instanceNote, "deadline-note"));
    }
    if (dl.entry.checkboxItems.length > 0) {
      section.appendChild(renderCheckboxItems(
        dl.entry.checkboxItems,
        dl.entry.sourceLineNumber,
        "checkbox-list-deadline",
        dl.entry.priority !== null,
        checkboxListId ?? undefined,
        checkboxListKey ?? undefined,
      ));
    }
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
    if (item.instanceNote) row.classList.add("has-instance-note");
    applyPrimaryTagFringe(row, item.entry.tags, "compact");

    const meta = el("span", "overdue-meta");
    const time = el("span", "item-time");
    time.textContent = `-${item.daysOverdue}d`;
    const kind = el("span", "item-kind");
    kind.textContent = item.kind === "deadline" ? "DEADLINE" : "SCHEDULED";
    const state = renderStateBadge(item.entry);
    meta.append(time, kind, state);

    const title = renderTitle(item.entry);
    if (item.baseDate) title.dataset.baseDate = item.baseDate;

    row.append(meta, title, renderTags(item.entry.tags, optionsForTags()));
    section.appendChild(row);
    if (item.instanceNote) {
      section.appendChild(renderGlobalInstanceNote(item.instanceNote, "overdue-note"));
    }
  }

  return section;
}

// ── Someday ─────────────────────────────────────────────────────────

function renderSomeday(items: SomedayItem[]): HTMLElement {
  const section = el("section", "someday-section");

  for (const item of items) {
    const row = el("div", "someday-item");
    if (item.entry.todo === "DONE") row.classList.add("item-done");
    applyPrimaryTagFringe(row, item.entry.tags, "compact");

    const state = renderStateBadge(item.entry, "TODO");
    const checkboxListId = item.entry.checkboxItems.length > 0 ? nextCheckboxListId() : null;
    const checkboxListKey = checkboxListId ? `someday:${item.entry.sourceLineNumber}` : null;
    const title = renderTitle(item.entry);
    if (checkboxListId && checkboxListKey) appendCheckboxToggle(title, checkboxListId, checkboxListKey);

    row.append(state, title, renderTags(item.entry.tags, optionsForTags()));
    section.appendChild(row);
    if (item.entry.checkboxItems.length > 0) {
      section.appendChild(renderCheckboxItems(
        item.entry.checkboxItems,
        item.entry.sourceLineNumber,
        "checkbox-list-someday",
        item.entry.priority !== null,
        checkboxListId ?? undefined,
        checkboxListKey ?? undefined,
      ));
    }
  }

  return section;
}

// ── Day card ─────────────────────────────────────────────────────────

function renderDay(day: AgendaDay, today: Date): HTMLElement {
  const card = el("article", "day-block");

  const isToday = isSameDate(day.date, today);
  if (isToday) card.classList.add("is-today");

  // Header
  const header = el("header", "day-header");
  header.dataset.action = "add-on-date";
  header.dataset.date = formatDateKey(day.date);
  header.tabIndex = 0;
  header.setAttribute("role", "button");
  const label = el("span", "date-label");
  let dayText = `${DAY_NAMES[day.date.getDay()]} ${day.date.getDate()} ${MONTH_NAMES[day.date.getMonth()]}`;
  if (day.date.getDay() === 1) {
    dayText += ` (W${getISOWeek(day.date)})`;
  }
  label.textContent = dayText;
  header.setAttribute("aria-label", `Add event on ${dayText}`);
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
      section.appendChild(renderItemForCategory(item));
      if (item.instanceNote) {
        section.appendChild(renderInstanceNote(item));
      }
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

      const checkboxListId = item.entry.checkboxItems.length > 0 ? nextCheckboxListId() : null;
      const checkboxListKey = checkboxListId ? checkboxKeyForAgendaItem(item) : null;

      section.appendChild(renderItemForCategory(item, checkboxListId, checkboxListKey));

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
        section.appendChild(renderCheckboxItems(
          item.entry.checkboxItems,
          item.entry.sourceLineNumber,
          getCheckboxLayoutClass(item),
          item.entry.priority !== null,
          checkboxListId ?? undefined,
          checkboxListKey ?? undefined,
        ));
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
  showPriority: boolean = true,
  checkboxListId: string | null = null,
  checkboxListKey: string | null = null,
): HTMLElement {
  const row = el("div", className);
  if (item.entry.todo === "DONE") row.classList.add("item-done");
  if (item.skipped) row.classList.add("item-skipped");

  applyPrimaryTagFringe(row, item.entry.tags);

  const children: HTMLElement[] = [];
  const badges = badge ? (Array.isArray(badge) ? badge : [badge]) : [];

  const hasTime = showTime === "always" || (showTime === "optional" && item.startTime);
  if (hasTime) {
    if (showTime === "optional") row.classList.add("has-time");
    const time = el("span", "item-time");
    time.textContent = formatTimeRange(item.startTime, item.endTime);
    children.push(time);
  }

  if (badges.some((el) => el.classList.contains("item-state"))) {
    row.classList.add("has-state");
  }

  if (badge) {
    children.push(...badges);
  } else if (item.entry.todo) {
    row.classList.add("has-state");
    children.push(renderStateBadge(item.entry));
  }

  if (!showPriority && item.entry.priority) {
    row.classList.add("has-priority");
    const pri = el("span", `item-priority priority-${item.entry.priority}`);
    pri.textContent = item.entry.priority;
    children.push(pri);
  }

  const title = renderTitle(item.entry, { showPriority });
  if (item.baseDate) title.dataset.baseDate = item.baseDate;
  if (item.override) {
    title.insertBefore(document.createTextNode(" "), title.firstChild);
    title.insertBefore(renderOverrideChip(item.override, moveDirection(item)), title.firstChild);
  }
  if (checkboxListId && checkboxListKey) appendCheckboxToggle(title, checkboxListId, checkboxListKey);
  children.push(title, renderTags(item.entry.tags, optionsForTags()));
  row.append(...children);
  return row;
}

function renderOverrideChip(
  override: { kind: "cancelled" | "shift" | "reschedule"; detail: string },
  direction: "earlier" | "later",
): HTMLElement {
  if (override.kind === "cancelled") {
    const mark = el("span", "item-skipped-mark");
    mark.textContent = "•";
    mark.title = override.detail;
    mark.setAttribute("aria-label", `Skipped (${override.detail})`);
    return mark;
  }
  const chip = el("span", "item-override-chip");
  chip.textContent = direction === "earlier" ? "← Moved" : "→ Moved";
  chip.title = override.detail;
  chip.setAttribute("aria-label", `${chip.textContent} (${override.detail})`);
  return chip;
}

function moveDirection(item: AgendaItem): "earlier" | "later" {
  if (!item.baseDate) return "later";
  const parts = item.baseDate.split("-").map(Number);
  const baseInstantMs =
    new Date(parts[0], parts[1] - 1, parts[2]).getTime() +
    (item.baseStartMinutes ?? 0) * 60_000;
  return item.date.getTime() < baseInstantMs ? "earlier" : "later";
}

function renderInstanceNote(item: AgendaItem): HTMLElement {
  const row = el("div", buildInstanceNoteClassName(item));
  const text = el("div", "item-instance-note-text");
  text.textContent = item.instanceNote ?? "";
  row.appendChild(text);
  return row;
}

function renderGlobalInstanceNote(note: string, layoutClass: string): HTMLElement {
  const row = el("div", `item-instance-note ${layoutClass}`);
  const text = el("div", "item-instance-note-text");
  text.textContent = note;
  row.appendChild(text);
  return row;
}

function buildInstanceNoteClassName(item: AgendaItem): string {
  const byCategory = {
    "all-day": item.entry.todo
      ? ["note-layout-allday-with-state", "note-title-col-2"]
      : ["note-layout-allday", "note-title-col-1"],
    timed: ["note-layout-timed", item.entry.todo ? "note-title-col-3" : "note-title-col-2"],
    scheduled: item.startTime
      ? ["note-layout-with-time", "note-title-col-3"]
      : ["note-layout-compact", "note-title-col-2"],
    deadline: item.startTime
      ? ["note-layout-with-time", "note-title-col-3"]
      : ["note-layout-compact", "note-title-col-2"],
  } satisfies Record<AgendaItem["category"], string[]>;
  return ["item-instance-note", ...byCategory[item.category]].join(" ");
}

function renderItemForCategory(
  item: AgendaItem,
  checkboxListId: string | null = null,
  checkboxListKey: string | null = null,
): HTMLElement {
  if (item.category === "all-day") return renderItem(item, "allday-item");
  if (item.category === "timed") return renderItem(item, "timed-item", undefined, "always", true, checkboxListId, checkboxListKey);
  if (item.category === "scheduled") {
    return renderItem(item, "scheduled-item", renderStateBadge(item.entry, "TODO"), "optional", true, checkboxListId, checkboxListKey);
  }

  const kind = el("span", "item-kind");
  kind.textContent = "DEADLINE";
  const row = renderItem(item, "day-deadline-item", [kind, renderStateBadge(item.entry, "TODO")], "optional", true, checkboxListId, checkboxListKey);
  if (item.entry.checkboxItems.length > 0) row.classList.add("has-checkbox-list");
  return row;
}

function applyPrimaryTagFringe(row: HTMLElement, tags: readonly string[], mode: "border" | "compact" = "border"): void {
  const primaryTag = tags[0];
  if (!primaryTag) return;

  const color = getTagColor(primaryTag);
  row.classList.add("has-tag-fringe");
  if (mode === "compact") {
    row.style.setProperty("--global-row-fringe-color", color);
    return;
  }
  row.style.setProperty("--tag-fringe-color", color);
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

function renderTitle(
  entry: { title: string; priority: "A" | "B" | "C" | null; progress?: { done: number; total: number } | null; sourceLineNumber: number },
  options: { showPriority?: boolean } = {},
): HTMLElement {
  const title = el("span", "item-title");
  title.dataset.action = "edit";
  title.dataset.line = String(entry.sourceLineNumber);
  title.setAttribute("role", "button");
  title.setAttribute("tabindex", "0");
  if (entry.priority && options.showPriority !== false) {
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

function renderCheckboxItems(
  items: readonly { text: string; checked: boolean }[],
  parentSourceLine: number,
  layoutClass?: string,
  hasPriority: boolean = false,
  listId?: string,
  listKey?: string,
): HTMLElement {
  const list = el("div", "checkbox-list");
  if (listId) {
    list.id = listId;
    checkboxListsById.set(listId, list);
  }
  if (listKey) {
    renderedCheckboxListKeys.add(listKey);
    if (isCheckboxListCollapsed(listKey)) list.classList.add("is-collapsed");
  }
  if (layoutClass) list.classList.add(layoutClass);
  if (hasPriority) list.classList.add("checkbox-list-has-priority");

  const rows = el("div", "checkbox-list-items");
  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    const row = el("div", "checkbox-item");
    if (item.checked) row.classList.add("checkbox-checked");
    row.dataset.action = "toggle-checkbox";
    row.dataset.line = String(parentSourceLine);
    row.dataset.checkboxIndex = String(i);
    row.setAttribute("role", "button");
    row.setAttribute("tabindex", "0");
    row.setAttribute("aria-label", item.checked ? "Mark not done" : "Mark done");
    const icon = el("span", "checkbox-icon");
    icon.setAttribute("aria-hidden", "true");
    const label = el("span", "checkbox-label");
    label.textContent = item.text;
    row.append(icon, label);
    rows.appendChild(row);
  }
  list.appendChild(rows);
  return list;
}

let checkboxListIdCounter = 0;
const checkboxListsById = new Map<string, HTMLElement>();
const checkboxListCollapseState = new Map<string, boolean>();
let renderedCheckboxListKeys = new Set<string>();

function nextCheckboxListId(): string {
  checkboxListIdCounter += 1;
  return `checklist-${checkboxListIdCounter}`;
}

function checkboxKeyForAgendaItem(item: AgendaItem): string {
  return [
    "day",
    formatDateKey(item.date),
    item.category,
    item.entry.sourceLineNumber,
    item.baseDate ?? formatDateKey(item.date),
    item.startTime ?? "",
  ].join(":");
}

function isCheckboxListCollapsed(listKey: string): boolean {
  return checkboxListCollapseState.get(listKey) ?? true;
}

function appendCheckboxToggle(title: HTMLElement, listId: string, listKey: string): void {
  const initiallyCollapsed = isCheckboxListCollapsed(listKey);
  title.appendChild(document.createTextNode(" "));
  const toggle = document.createElement("button");
  toggle.className = "checkbox-list-toggle-inline";
  toggle.type = "button";
  toggle.textContent = initiallyCollapsed ? ">" : "<";
  toggle.setAttribute("aria-label", initiallyCollapsed ? "Show checklist" : "Hide checklist");
  toggle.setAttribute("aria-expanded", initiallyCollapsed ? "false" : "true");
  toggle.setAttribute("aria-controls", listId);
  toggle.addEventListener("click", (event) => {
    event.stopPropagation();
    const list = checkboxListsById.get(listId) ?? document.getElementById(listId);
    if (!list) return;
    const collapsed = list.classList.toggle("is-collapsed");
    checkboxListCollapseState.set(listKey, collapsed);
    toggle.textContent = collapsed ? ">" : "<";
    toggle.setAttribute("aria-label", collapsed ? "Show checklist" : "Hide checklist");
    toggle.setAttribute("aria-expanded", collapsed ? "false" : "true");
    toggle.blur();
  });
  title.appendChild(toggle);
}

function getCheckboxLayoutClass(item: AgendaItem): string {
  if (item.category === "deadline") {
    return item.startTime ? "checkbox-list-day-deadline-time" : "checkbox-list-day-deadline";
  }
  if (item.category === "scheduled") {
    return item.startTime ? "checkbox-list-scheduled-time" : "checkbox-list-scheduled";
  }
  return item.entry.todo ? "checkbox-list-timed-state" : "checkbox-list-timed";
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
  span.style.setProperty("--tag-color", getTagColor(tag));
  span.textContent = tag;
  span.setAttribute("role", "button");
  span.setAttribute("tabindex", "0");
  span.setAttribute("aria-pressed", options.selected ? "true" : "false");
  span.setAttribute(
    "aria-label",
    options.colorEditMode
      ? `Change color for tag ${tag}`
      : options.selected
        ? `Remove tag filter ${tag}`
        : `Filter by tag ${tag}`,
  );
  if (options.selected) span.classList.add("is-selected");
  if (options.colorEditMode) span.classList.add("is-color-editable");

  if (options.colorEditMode) {
    const icon = el("span", "tag-color-edit-icon");
    icon.textContent = "🖌";
    icon.setAttribute("aria-hidden", "true");
    span.appendChild(icon);
  }

  const picker = document.createElement("input");
  picker.type = "color";
  picker.className = "tag-color-picker";
  picker.value = getTagColor(tag);

  picker.addEventListener("click", (e) => {
    e.stopPropagation();
  });

  picker.addEventListener("input", () => {
    setTagColor(tag, picker.value);
    document.querySelectorAll<HTMLElement>(".tag[data-tag]").forEach((el) => {
      if (el.dataset.tag === tag) el.style.setProperty("--tag-color", picker.value);
    });
  });

  span.appendChild(picker);
  return span;
}

export function renderAgenda(
  container: HTMLElement,
  week: readonly AgendaDay[],
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

function formatDeadlineDueText(daysUntil: number): string {
  if (daysUntil === 0) return "Today";
  return `${daysUntil}d`;
}

function getDeadlineUrgencyClass(daysUntil: number): string {
  if (daysUntil <= 3) return "deadline-urgency-critical";
  if (daysUntil <= 7) return "deadline-urgency-warning";
  if (daysUntil <= 14) return "deadline-urgency-caution";
  return "deadline-urgency-calm";
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

function formatDateKey(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className?: string): HTMLElementTagNameMap[K];
function el(tag: string, className?: string): HTMLElement;
function el(tag: string, className?: string): HTMLElement {
  const e = document.createElement(tag);
  if (className) e.className = className;
  return e;
}
