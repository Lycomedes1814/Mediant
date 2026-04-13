/**
 * DOM rendering: AgendaWeek + DeadlineItem[] → HTML.
 *
 * Reads from the agenda data model, writes to the DOM.
 * No parsing or date logic here — that belongs to earlier stages.
 */

import type { AgendaWeek, AgendaDay, AgendaItem, DeadlineItem, OverdueItem, SomedayItem } from "../agenda/model.ts";
import { getTagColor, TAG_DEFAULT_COLOR } from "./tagColors.ts";

const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const MONTH_NAMES = ["January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December"];

// ── Public API ───────────────────────────────────────────────────────

export function renderAgenda(
  container: HTMLElement,
  week: AgendaWeek,
  deadlines: DeadlineItem[],
  overdue: OverdueItem[],
  someday: SomedayItem[],
  today: Date,
): void {
  container.innerHTML = "";

  // Header
  const startDate = week[0].date;
  const endDate = week[6].date;
  container.appendChild(renderHeader(startDate, endDate));

  // Overdue section (before deadlines — most urgent)
  if (overdue.length > 0) {
    container.appendChild(renderOverdue(overdue));
  }

  // Deadlines section
  if (deadlines.length > 0) {
    container.appendChild(renderDeadlines(deadlines));
  }

  // Day cards
  for (let i = 0; i < 7; i++) {
    container.appendChild(renderDay(week[i], i, today));
  }

  // Someday section
  if (someday.length > 0) {
    container.appendChild(renderSomeday(someday));
  }
}

// ── Header ───────────────────────────────────────────────────────────

function renderHeader(startDate: Date, endDate: Date): HTMLElement {
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

  const tagsBtn = el("button", "tags-editor-btn");
  tagsBtn.setAttribute("aria-label", "Edit tag colors");
  tagsBtn.textContent = "Tags";
  tagsBtn.dataset.action = "tags";

  const themeBtn = el("button", "theme-toggle");
  themeBtn.setAttribute("aria-label", "Toggle dark mode");
  themeBtn.textContent = document.documentElement.dataset.theme === "dark" ? "\u2600" : "\u263E";
  themeBtn.addEventListener("click", () => {
    const isDark = document.documentElement.dataset.theme === "dark";
    if (isDark) {
      delete document.documentElement.dataset.theme;
      localStorage.setItem("theme", "light");
      themeBtn.textContent = "\u263E";
    } else {
      document.documentElement.dataset.theme = "dark";
      localStorage.setItem("theme", "dark");
      themeBtn.textContent = "\u2600";
    }
  });

  const addBtn = el("button", "add-item-btn");
  addBtn.textContent = "+Add";
  addBtn.dataset.action = "add";

  actions.append(todayBtn, tagsBtn, addBtn, themeBtn);
  header.append(nav, actions);
  return header;
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

    const time = el("span", "item-time");
    time.textContent = dl.daysUntil === 0 ? "Due today" : `Due ${dl.daysUntil}d`;

    const state = el("span", "item-state");
    state.textContent = dl.entry.todo ?? "";

    const title = renderTitle(dl.entry);

    row.append(time, state, title, renderTags(dl.entry.tags), renderEditBtn(dl.entry.sourceLineNumber));
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

    const time = el("span", "item-time");
    time.textContent = `${item.daysOverdue}d ago`;

    const kind = el("span", "item-kind");
    kind.textContent = item.kind === "deadline" ? "DEADLINE" : "SCHEDULED";

    const title = renderTitle(item.entry);

    row.append(time, kind, title, renderTags(item.entry.tags), renderEditBtn(item.entry.sourceLineNumber));
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

    const state = el("span", "item-state");
    state.textContent = "TODO";

    const title = renderTitle(item.entry);

    row.append(state, title, renderTags(item.entry.tags), renderEditBtn(item.entry.sourceLineNumber));
    section.appendChild(row);
  }

  return section;
}

// ── Day card ─────────────────────────────────────────────────────────

function renderDay(day: AgendaDay, dayIndex: number, today: Date): HTMLElement {
  const card = el("article", "day-card");

  const isToday = isSameDate(day.date, today);
  if (isToday) card.classList.add("is-today");

  // Header
  const header = el("header", "day-header");
  const label = el("span", "date-label");
  label.textContent = `${DAY_NAMES[day.date.getDay()]} ${day.date.getDate()} ${MONTH_NAMES[day.date.getMonth()]}`;
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
          section.appendChild(renderNowLine());
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

      // Body text
      if (item.entry.body) {
        const body = el("div", "item-body");
        body.textContent = item.entry.body;
        section.appendChild(body);
      }
    }

    // If all items are before now, append the line at the end
    if (!nowLineInserted) {
      section.appendChild(renderNowLine());
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

function renderAllDayItem(item: AgendaItem): HTMLElement {
  const row = el("div", "allday-item");
  if (item.entry.todo === "DONE") row.classList.add("item-done");

  const primaryTag = item.entry.tags[0];
  if (primaryTag) row.style.borderLeftColor = getTagColor(primaryTag);

  const title = renderTitle(item.entry);

  const children: HTMLElement[] = [];
  if (item.entry.todo) {
    row.classList.add("has-state");
    const state = el("span", "item-state");
    state.textContent = item.entry.todo;
    children.push(state);
  }
  children.push(title, renderTags(item.entry.tags), renderEditBtn(item.entry.sourceLineNumber));
  row.append(...children);
  return row;
}

function renderTimedItem(item: AgendaItem): HTMLElement {
  const row = el("div", "timed-item");
  if (item.entry.todo === "DONE") row.classList.add("item-done");

  const primaryTag = item.entry.tags[0];
  if (primaryTag) row.style.borderLeftColor = getTagColor(primaryTag);

  const time = el("span", "item-time");
  time.textContent = formatTimeRange(item.startTime, item.endTime);

  const title = renderTitle(item.entry);

  const children: HTMLElement[] = [time];
  if (item.entry.todo) {
    row.classList.add("has-state");
    const state = el("span", "item-state");
    state.textContent = item.entry.todo;
    children.push(state);
  }
  children.push(title, renderTags(item.entry.tags), renderEditBtn(item.entry.sourceLineNumber));
  row.append(...children);
  return row;
}

function renderScheduledItem(item: AgendaItem): HTMLElement {
  const row = el("div", "scheduled-item");
  if (item.entry.todo === "DONE") row.classList.add("item-done");

  const primaryTag = item.entry.tags[0];
  if (primaryTag) row.style.borderLeftColor = getTagColor(primaryTag);

  const state = el("span", "item-state");
  state.textContent = item.entry.todo ?? "TODO";

  const title = renderTitle(item.entry);

  if (item.startTime) {
    row.classList.add("has-time");
    const time = el("span", "item-time");
    time.textContent = formatTimeRange(item.startTime, item.endTime);
    row.append(time, state, title, renderTags(item.entry.tags), renderEditBtn(item.entry.sourceLineNumber));
  } else {
    row.append(state, title, renderTags(item.entry.tags), renderEditBtn(item.entry.sourceLineNumber));
  }
  return row;
}

function renderDayDeadlineItem(item: AgendaItem): HTMLElement {
  const row = el("div", "day-deadline-item");
  if (item.entry.todo === "DONE") row.classList.add("item-done");

  const primaryTag = item.entry.tags[0];
  if (primaryTag) row.style.borderLeftColor = getTagColor(primaryTag);

  const kind = el("span", "item-kind");
  kind.textContent = "DEADLINE";

  const title = renderTitle(item.entry);

  if (item.startTime) {
    row.classList.add("has-time");
    const time = el("span", "item-time");
    time.textContent = formatTimeRange(item.startTime, item.endTime);
    row.append(time, kind, title, renderTags(item.entry.tags), renderEditBtn(item.entry.sourceLineNumber));
  } else {
    row.append(kind, title, renderTags(item.entry.tags), renderEditBtn(item.entry.sourceLineNumber));
  }
  return row;
}

// ── Edit button ─────────────────────────────────────────────────────

function renderEditBtn(sourceLineNumber: number): HTMLElement {
  const btn = el("button", "item-edit-btn");
  btn.dataset.action = "edit";
  btn.dataset.line = String(sourceLineNumber);
  btn.setAttribute("aria-label", "Edit entry");
  btn.innerHTML = `<svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true"><path d="M12.146.146a.5.5 0 0 1 .708 0l3 3a.5.5 0 0 1 0 .708l-10 10a.5.5 0 0 1-.168.11l-5 2a.5.5 0 0 1-.65-.65l2-5a.5.5 0 0 1 .11-.168l10-10zM11.207 2.5 13.5 4.793 14.793 3.5 12.5 1.207 11.207 2.5zm1.586 3L10.5 3.207 4 9.707V10h.5a.5.5 0 0 1 .5.5v.5h.5a.5.5 0 0 1 .5.5v.5h.293l6.5-6.5zm-9.761 5.175-.106.106-1.528 3.821 3.821-1.528.106-.106A.5.5 0 0 1 5 12.5V12h-.5a.5.5 0 0 1-.5-.5V11h-.5a.5.5 0 0 1-.468-.325z"/></svg>`;
  return btn;
}

// ── Now line ─────────────────────────────────────────────────────────

function renderNowLine(): HTMLElement {
  return el("div", "now-line");
}

// ── Helpers ──────────────────────────────────────────────────────────

function renderTitle(entry: { title: string; priority: "A" | "B" | "C" | null }): HTMLElement {
  const title = el("span", "item-title");
  if (entry.priority) {
    const badge = el("span", `item-priority priority-${entry.priority}`);
    badge.textContent = entry.priority;
    title.appendChild(badge);
    title.appendChild(document.createTextNode(" " + entry.title));
  } else {
    title.textContent = entry.title;
  }
  return title;
}

function renderTags(tags: readonly string[]): HTMLElement {
  const badges = el("span", "tag-badges");
  for (const tag of tags) {
    const span = el("span", "tag");
    span.style.background = getTagColor(tag);
    span.textContent = tag;
    badges.appendChild(span);
  }
  return badges;
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
