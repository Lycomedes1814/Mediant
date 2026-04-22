// @vitest-environment happy-dom

import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AgendaItem, AgendaWeek, DeadlineItem, OverdueItem, SomedayItem } from "../../agenda/model.ts";

const notificationsState = {
  enabled: false,
};

const notificationFns = vi.hoisted(() => ({
  clearScheduled: vi.fn(),
  requestPermission: vi.fn(async () => true),
  setNotificationsEnabled: vi.fn((on: boolean) => {
    notificationsState.enabled = on;
  }),
}));

const tagFns = vi.hoisted(() => ({
  setTagColor: vi.fn(),
}));

vi.mock("../notifications.ts", () => ({
  notificationsEnabled: () => notificationsState.enabled,
  setNotificationsEnabled: notificationFns.setNotificationsEnabled,
  requestPermission: notificationFns.requestPermission,
  clearScheduled: notificationFns.clearScheduled,
  scheduleNotifications: vi.fn(),
}));

vi.mock("../tagColors.ts", () => ({
  getTagColor: (tag: string) => {
    if (tag === "work") return "#3366ff";
    if (tag === "music") return "#00aa88";
    return "#999999";
  },
  setTagColor: tagFns.setTagColor,
  TAG_DEFAULT_COLOR: "#999999",
}));

import { createNotificationToggle, createThemeToggle, renderAgenda } from "../render.ts";

describe("renderAgenda", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
    document.documentElement.removeAttribute("data-theme");
    localStorage.clear();
    notificationsState.enabled = false;
    notificationFns.clearScheduled.mockClear();
    notificationFns.requestPermission.mockClear();
    notificationFns.setNotificationsEnabled.mockClear();
    tagFns.setTagColor.mockClear();
  });

  it("renders overdue, deadlines, days, and someday sections in order", () => {
    const container = document.createElement("div");
    const week = makeWeek([
      [makeItem({ title: "Today event", date: new Date(2026, 3, 20, 14, 0), startTime: "14:00", tags: ["work"] })],
      [],
      [],
      [],
      [],
      [],
      [],
    ]);
    const overdue: OverdueItem[] = [{
      entry: makeEntry({ title: "Late task", todo: "TODO" }),
      dueDate: new Date(2026, 3, 18),
      daysOverdue: 2,
      kind: "deadline",
      sourceTimestamp: makeTimestamp("2026-04-18"),
      baseDate: "2026-04-18",
    }];
    const deadlines: DeadlineItem[] = [{
      entry: makeEntry({ title: "Upcoming", todo: "TODO", priority: "A" }),
      dueDate: new Date(2026, 3, 21),
      daysUntil: 1,
      sourceTimestamp: makeTimestamp("2026-04-21"),
      baseDate: "2026-04-21",
    }];
    const someday: SomedayItem[] = [{
      entry: makeEntry({ title: "Someday", todo: "TODO", tags: ["music"] }),
    }];

    renderAgenda(container, week, deadlines, overdue, someday, new Date(2026, 3, 20, 12, 30));

    const sections = Array.from(container.children).map((el) => (el as HTMLElement).className);
    expect(sections).toEqual([
      "agenda-header",
      "overdue-section",
      "deadlines-section",
      "days-card",
      "someday-section",
    ]);

    expect(container.querySelector(".overdue-header")?.textContent).toBe("Overdue");
    expect(container.querySelector(".deadlines-header")?.textContent).toBe("Upcoming deadlines");
    expect(container.querySelector(".someday-header")?.textContent).toBe("Someday");
    expect(container.querySelector(".overdue-section .item-title")?.getAttribute("data-base-date")).toBe("2026-04-18");
    expect(container.querySelector(".deadlines-section .item-title")?.getAttribute("data-base-date")).toBe("2026-04-21");
  });

  it("inserts the now line before the first item that starts after the current time", () => {
    const container = document.createElement("div");
    const today = new Date(2026, 3, 20, 12, 30);
    const week = makeWeek([
      [
        makeItem({ title: "Morning", date: new Date(2026, 3, 20, 10, 0), startTime: "10:00" }),
        makeItem({ title: "Afternoon", date: new Date(2026, 3, 20, 15, 0), startTime: "15:00" }),
      ],
      [],
      [],
      [],
      [],
      [],
      [],
    ]);

    renderAgenda(container, week, [], [], [], today);

    const timedSection = container.querySelector(".day-block.is-today .timed-section");
    expect(timedSection).not.toBeNull();
    const children = Array.from(timedSection!.children).map((el) => (el as HTMLElement).className);
    expect(children).toEqual(["timed-item", "now-line", "timed-item"]);
    expect(timedSection!.querySelector(".now-time")?.textContent).toBe("12:30");
  });

  it("renders override chips, notes, progress, checkboxes, and edit metadata", () => {
    const container = document.createElement("div");
    const week = makeWeek([
      [
        makeItem({
          title: "Yoga",
          date: new Date(2026, 3, 20, 18, 0),
          startTime: "18:00",
          endTime: "19:00",
          tags: ["music"],
          baseDate: "2026-04-19",
          override: { kind: "reschedule", detail: "from 2026-04-19 17:00-18:00" },
          instanceNote: "Bring water",
          progress: { done: 2, total: 3 },
          checkboxItems: [
            { text: "Shoes", checked: true },
            { text: "Bottle", checked: false },
          ],
          sourceLineNumber: 42,
        }),
      ],
      [],
      [],
      [],
      [],
      [],
      [],
    ]);

    renderAgenda(container, week, [], [], [], new Date(2026, 3, 20, 9, 0));

    const title = container.querySelector(".item-title");
    expect(title?.getAttribute("data-action")).toBe("edit");
    expect(title?.getAttribute("data-line")).toBe("42");
    expect(title?.getAttribute("data-base-date")).toBe("2026-04-19");
    expect(title?.textContent).toContain("Yoga");
    expect(title?.querySelector(".item-progress")?.textContent).toBe("2/3");

    const chip = container.querySelector(".item-override-chip") as HTMLElement | null;
    expect(chip?.textContent).toBe("moved");
    expect(chip?.title).toBe("from 2026-04-19 17:00-18:00");
    const note = container.querySelector(".item-instance-note") as HTMLElement | null;
    expect(note?.textContent).toBe("Bring water");
    expect(note?.classList.contains("note-layout-timed")).toBe(true);
    expect(note?.classList.contains("note-title-col-2")).toBe(true);

    const checkboxes = Array.from(container.querySelectorAll(".checkbox-item"));
    expect(checkboxes).toHaveLength(2);
    expect(checkboxes[0].classList.contains("checkbox-checked")).toBe(true);
    expect(container.querySelector(".tag")?.textContent).toContain("music");
  });

  it("renders skipped occurrences with marker and strikethrough class", () => {
    const container = document.createElement("div");
    const week = makeWeek([
      [
        makeItem({
          title: "Yoga",
          date: new Date(2026, 3, 20, 18, 0),
          startTime: "18:00",
          baseDate: "2026-04-20",
          skipped: true,
          override: { kind: "cancelled", detail: "Skipped occurrence" },
        }),
      ],
      [],
      [],
      [],
      [],
      [],
      [],
    ]);

    renderAgenda(container, week, [], [], [], new Date(2026, 3, 20, 9, 0));

    const row = container.querySelector(".timed-item") as HTMLElement | null;
    expect(row).not.toBeNull();
    expect(row?.classList.contains("item-skipped")).toBe(true);

    const chip = container.querySelector(".item-override-chip") as HTMLElement | null;
    expect(chip?.textContent).toBe("skipped");
    expect(chip?.classList.contains("override-cancelled")).toBe(true);
  });

  it("updates all rendered tag pills when the color picker changes", () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const sharedEntry = makeEntry({ title: "Shared tag", tags: ["work"] });
    const week = makeWeek([
      [makeItem({ entry: sharedEntry, date: new Date(2026, 3, 20, 9, 0), startTime: "09:00", tags: ["work"] })],
      [makeItem({ entry: sharedEntry, date: new Date(2026, 3, 21, 10, 0), startTime: "10:00", tags: ["work"] })],
      [],
      [],
      [],
      [],
      [],
    ]);

    renderAgenda(container, week, [], [], [], new Date(2026, 3, 20, 8, 0));

    const pickers = Array.from(container.querySelectorAll<HTMLInputElement>(".tag-color-picker"));
    expect(pickers.length).toBeGreaterThan(1);
    const tagsBefore = Array.from(container.querySelectorAll<HTMLElement>(".tag[data-tag='work']"));
    const beforeValues = tagsBefore.map((tag) => tag.style.background);
    pickers[0].value = "#123456";
    pickers[0].dispatchEvent(new Event("input", { bubbles: true }));

    expect(tagFns.setTagColor).toHaveBeenCalledWith("work", "#123456");
    const tags = Array.from(container.querySelectorAll<HTMLElement>(".tag[data-tag='work']"));
    const afterValues = tags.map((tag) => tag.style.background);
    expect(new Set(afterValues).size).toBe(1);
    expect(afterValues[0]).not.toBe(beforeValues[0]);
  });
});

describe("UI toggles", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
    document.documentElement.removeAttribute("data-theme");
    localStorage.clear();
    notificationsState.enabled = false;
    notificationFns.clearScheduled.mockClear();
    notificationFns.requestPermission.mockClear();
    notificationFns.setNotificationsEnabled.mockClear();
  });

  it("theme toggle updates the document theme and localStorage", () => {
    const toggle = createThemeToggle();
    expect(toggle.textContent).toBe("☾");

    toggle.click();
    expect(document.documentElement.dataset.theme).toBe("dark");
    expect(localStorage.getItem("theme")).toBe("dark");
    expect(toggle.textContent).toBe("☀");

    toggle.click();
    expect(document.documentElement.dataset.theme).toBeUndefined();
    expect(localStorage.getItem("theme")).toBe("light");
    expect(toggle.textContent).toBe("☾");
  });

  it("notification toggle enables notifications, then disables and clears timers", async () => {
    const wrapper = document.createElement("div");
    const events: string[] = [];
    wrapper.addEventListener("notification-toggled", () => events.push("toggled"));

    const toggle = createNotificationToggle();
    wrapper.appendChild(toggle);

    await toggle.click();
    expect(notificationFns.requestPermission).toHaveBeenCalledTimes(1);
    expect(notificationFns.setNotificationsEnabled).toHaveBeenCalledWith(true);
    expect(toggle.classList.contains("is-on")).toBe(true);
    expect(events).toEqual(["toggled"]);

    toggle.click();
    expect(notificationFns.clearScheduled).toHaveBeenCalledTimes(1);
    expect(notificationFns.setNotificationsEnabled).toHaveBeenCalledWith(false);
    expect(toggle.classList.contains("is-on")).toBe(false);
    expect(events).toEqual(["toggled", "toggled"]);
  });
});

function makeWeek(days: AgendaItem[][]): AgendaWeek {
  const start = new Date(2026, 3, 20);
  const makeDay = (index: number) => {
    const date = new Date(start);
    date.setDate(start.getDate() + index);
    return { date, items: days[index] ?? [] };
  };

  return [
    makeDay(0),
    makeDay(1),
    makeDay(2),
    makeDay(3),
    makeDay(4),
    makeDay(5),
    makeDay(6),
  ];
}

function makeItem(overrides: Partial<AgendaItem> & {
  title?: string;
  date: Date;
  entry?: AgendaItem["entry"];
  tags?: string[];
  sourceLineNumber?: number;
  progress?: { done: number; total: number } | null;
  checkboxItems?: { text: string; checked: boolean }[];
}): AgendaItem {
  const entry = overrides.entry ?? makeEntry({
    title: overrides.title ?? "Item",
    tags: overrides.tags ?? [],
    sourceLineNumber: overrides.sourceLineNumber ?? 1,
    progress: overrides.progress ?? null,
    checkboxItems: overrides.checkboxItems ?? [],
  });

  return {
    entry,
    date: overrides.date,
    startTime: overrides.startTime ?? null,
    endTime: overrides.endTime ?? null,
    category: overrides.category ?? "timed",
    sourceTimestamp: overrides.sourceTimestamp ?? makeTimestamp(formatDate(overrides.date)),
    baseDate: overrides.baseDate ?? null,
    baseStartMinutes: overrides.baseStartMinutes ?? null,
    instanceNote: overrides.instanceNote ?? null,
    override: overrides.override ?? null,
    skipped: overrides.skipped ?? false,
  };
}

function makeEntry(overrides: Partial<AgendaItem["entry"]> & { title: string }) {
  const {
    title,
    tags,
    checkboxItems,
    progress,
    body,
    sourceLineNumber,
    seriesUntil,
    ...rest
  } = overrides;

  return {
    level: 2,
    todo: null,
    priority: null,
    title,
    tags: tags ?? [],
    planning: [],
    timestamps: [],
    checkboxItems: checkboxItems ?? [],
    progress: progress ?? null,
    body: body ?? "",
    sourceLineNumber: sourceLineNumber ?? 1,
    exceptions: new Map(),
    seriesUntil: seriesUntil ?? null,
    ...rest,
  };
}

function makeTimestamp(date: string) {
  return {
    date,
    startTime: null,
    endTime: null,
    repeater: null,
    raw: `<${date}>`,
  };
}

function formatDate(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}
