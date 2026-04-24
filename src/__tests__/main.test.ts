// @vitest-environment happy-dom

import { beforeEach, describe, expect, it, vi } from "vitest";

const notificationMocks = vi.hoisted(() => ({
  scheduleNotifications: vi.fn(),
  clearScheduled: vi.fn(),
  requestPermission: vi.fn(async () => true),
  setNotificationsEnabled: vi.fn(),
}));

vi.mock("../ui/notifications.ts", () => ({
  notificationsEnabled: () => false,
  setNotificationsEnabled: notificationMocks.setNotificationsEnabled,
  requestPermission: notificationMocks.requestPermission,
  clearScheduled: notificationMocks.clearScheduled,
  scheduleNotifications: notificationMocks.scheduleNotifications,
}));

describe("main.ts integration", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.unstubAllGlobals();
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 3, 20, 10, 0, 0));
    document.body.innerHTML = '<div id="agenda"></div>';
    document.documentElement.removeAttribute("data-theme");
    localStorage.clear();
    notificationMocks.scheduleNotifications.mockClear();
    notificationMocks.clearScheduled.mockClear();
    notificationMocks.requestPermission.mockClear();
    notificationMocks.setNotificationsEnabled.mockClear();
    vi.stubGlobal("fetch", vi.fn(async () => {
      throw new Error("offline");
    }));
  });

  it("loads static mode, toggles DONE, edits the series, and saves a recurring occurrence exception", async () => {
    const originalAddEventListener = document.addEventListener.bind(document);
    let keydownHandler: ((e: KeyboardEvent) => void) | null = null;
    document.addEventListener = ((type: string, listener: EventListenerOrEventListenerObject, options?: AddEventListenerOptions | boolean) => {
      if (type === "keydown" && typeof listener === "function") {
        keydownHandler = listener as (e: KeyboardEvent) => void;
      }
      return originalAddEventListener(type, listener, options);
    }) as typeof document.addEventListener;

    localStorage.setItem(
      "mediant-org-source",
      [
        "** TODO Inbox",
        "SCHEDULED: <2026-04-20 Mon>",
        "",
        "** TODO Rent",
        "DEADLINE: <2026-04-01 Wed +1w>",
        "",
        "** TODO Focus block :work:",
        "SCHEDULED: <2026-04-20 Mon 11:00>",
        "",
        "** TODO Yoga :work:health:",
        "SCHEDULED: <2026-04-21 Tue 17:00 .+1w>",
        "Body line.",
        "",
      ].join("\n"),
    );

    await import("../main.ts");
    await flush();
    document.addEventListener = originalAddEventListener;

    await waitFor(() => document.querySelector(".input-load-btn") !== null);
    const loadButton = document.querySelector<HTMLButtonElement>(".input-load-btn");
    expect(loadButton).not.toBeNull();
    loadButton!.click();
    await waitFor(() => document.querySelector(".days-card") !== null);

    expect(document.querySelectorAll(".day-block")).toHaveLength(7);
    const hideEmptyDaysBtn = document.querySelector<HTMLButtonElement>(".hide-empty-days-toggle");
    expect(hideEmptyDaysBtn).not.toBeNull();
    hideEmptyDaysBtn!.click();
    await flush();
    expect(localStorage.getItem("mediant-hide-empty-days")).toBe("true");
    expect(document.querySelector(".hide-empty-days-toggle")?.classList.contains("is-on")).toBe(true);
    expect(document.querySelectorAll(".day-block").length).toBeLessThan(7);
    expect(document.querySelector(".day-empty")).toBeNull();
    keydownHandler!(makeKeydownEvent("h", document.body));
    await flush();
    expect(localStorage.getItem("mediant-hide-empty-days")).toBe("false");
    expect(document.querySelector(".hide-empty-days-toggle")?.classList.contains("is-on")).toBe(false);
    expect(document.querySelectorAll(".day-block")).toHaveLength(7);

    const workTag = document.querySelector<HTMLElement>(".tag[data-tag='work']");
    expect(workTag).not.toBeNull();
    workTag!.click();
    await flush();
    expect(document.querySelector(".active-tag-filters .tag[data-tag='work']")).not.toBeNull();
    expect(Array.from(document.querySelectorAll<HTMLElement>(".item-title")).some(el => el.textContent?.includes("Inbox"))).toBe(false);
    expect(Array.from(document.querySelectorAll<HTMLElement>(".item-title")).some(el => el.textContent?.includes("Yoga"))).toBe(true);
    expect(Array.from(document.querySelectorAll<HTMLElement>(".item-title")).some(el => el.textContent?.includes("Focus block"))).toBe(true);

    const healthTag = Array.from(document.querySelectorAll<HTMLElement>(".tag[data-tag='health']"))
      .find(el => el.closest(".timed-item, .scheduled-item, .allday-item, .deadline-item, .overdue-item, .someday-item")) ?? null;
    expect(healthTag).not.toBeNull();
    healthTag!.click();
    await flush();
    expect(document.querySelector(".active-tag-filters .tag[data-tag='health']")).not.toBeNull();
    expect(Array.from(document.querySelectorAll<HTMLElement>(".item-title")).some(el => el.textContent?.includes("Yoga"))).toBe(true);
    expect(Array.from(document.querySelectorAll<HTMLElement>(".item-title")).some(el => el.textContent?.includes("Focus block"))).toBe(false);

    keydownHandler!(makeKeydownEvent("x", document.body));
    await flush();
    expect(document.querySelector(".active-tag-filters")).toBeNull();
    expect(Array.from(document.querySelectorAll<HTMLElement>(".item-title")).some(el => el.textContent?.includes("Inbox"))).toBe(true);
    expect(Array.from(document.querySelectorAll<HTMLElement>(".item-title")).some(el => el.textContent?.includes("Focus block"))).toBe(true);

    const workTagAfterClear = document.querySelector<HTMLElement>(".tag[data-tag='work']");
    expect(workTagAfterClear).not.toBeNull();
    workTagAfterClear!.click();
    await flush();
    expect(document.querySelector(".active-tag-filters .tag[data-tag='work']")).not.toBeNull();

    const clearFiltersBtn = document.querySelector<HTMLButtonElement>(".clear-tag-filters");
    expect(clearFiltersBtn).not.toBeNull();
    clearFiltersBtn!.click();
    await flush();
    expect(Array.from(document.querySelectorAll<HTMLElement>(".item-title")).some(el => el.textContent?.includes("Inbox"))).toBe(true);

    const colorModeBtn = document.querySelector<HTMLButtonElement>(".tag-color-mode-toggle");
    expect(colorModeBtn).not.toBeNull();
    colorModeBtn!.click();
    await flush();
    expect(document.querySelector(".tag[data-tag='work']")?.classList.contains("is-color-editable")).toBe(true);
    colorModeBtn!.click();
    await flush();

    const inboxTitle = Array.from(document.querySelectorAll<HTMLElement>(".item-title"))
      .find(el => el.textContent?.includes("Inbox"));
    const toggle = inboxTitle?.closest("div")?.querySelector<HTMLElement>(".item-state.is-toggleable");
    expect(toggle?.textContent).toBe("TODO");
    toggle!.click();
    await flush();
    const toggledSource = localStorage.getItem("mediant-org-source") ?? "";
    expect(toggledSource).toContain("** DONE Inbox");
    expect(toggledSource).toContain("** TODO Yoga");

    expect(document.querySelector<HTMLElement>(".nav-week-date")?.textContent).toBe("20–26 April 2026");
    expect(keydownHandler).not.toBeNull();

    keydownHandler!(makeKeydownEvent("n", document.body));
    await flush();
    expect(document.querySelector<HTMLElement>(".nav-week-date")?.textContent).toBe("27 April – 3 May 2026");

    keydownHandler!(makeKeydownEvent("p", document.body));
    await flush();
    expect(document.querySelector<HTMLElement>(".nav-week-date")?.textContent).toBe("20–26 April 2026");

    keydownHandler!(makeKeydownEvent("n", document.body));
    await flush();
    expect(document.querySelector<HTMLElement>(".nav-week-date")?.textContent).toBe("27 April – 3 May 2026");

    keydownHandler!(makeKeydownEvent("t", document.body));
    await flush();
    expect(document.querySelector<HTMLElement>(".nav-week-date")?.textContent).toBe("20–26 April 2026");

    keydownHandler!(makeKeydownEvent("a", document.body));
    await waitFor(() => document.querySelector(".add-panel.is-open") !== null);
    expect(document.querySelector<HTMLInputElement>("#add-title")?.value).toBe("");

    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    await flush();

    const deadlineTitle = document.querySelector<HTMLElement>(".deadlines-section .item-title[data-base-date='2026-04-22']");
    expect(deadlineTitle).not.toBeNull();
    deadlineTitle!.click();
    await waitFor(() => document.querySelector(".add-panel.is-open") !== null);
    expect(document.querySelector(".add-panel")?.classList.contains("has-occurrence")).toBe(true);
    expect(document.querySelector<HTMLElement>(".occurrence-meta")?.textContent).toContain("Wed 22 Apr 2026");
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    await flush();

    const title = document.querySelector<HTMLElement>(".item-title[data-base-date='2026-04-21']");
    expect(title).not.toBeNull();
    title!.click();
    await waitFor(() => document.querySelector(".add-panel.is-open") !== null);

    const titleInput = document.querySelector<HTMLInputElement>("#add-title");
    const tagInput = document.querySelector<HTMLInputElement>("#add-tags");
    const schedInput = document.querySelector<HTMLInputElement>("#add-sched");
    const schedField = document.querySelector<HTMLInputElement>("#add-sched")?.closest(".add-field");
    const schedPreview = schedField?.querySelector<HTMLElement>(".datetime-preview");
    const schedPickerToggle = schedField?.querySelector<HTMLButtonElement>(".datetime-picker-toggle");
    const schedRepeatSelect = document.querySelector<HTMLSelectElement>("#add-sched-repeat");
    const deadRepeatSelect = document.querySelector<HTMLSelectElement>("#add-dead-repeat");
    const deadInput = document.querySelector<HTMLInputElement>("#add-dead");
    const checkboxSection = document.querySelector<HTMLElement>(".edit-checkboxes");
    expect(titleInput?.value).toBe("Yoga");
    expect(tagInput).not.toBeNull();
    expect(schedInput?.value).toBe("21/04/2026 17:00");
    expect(schedPreview?.textContent).toBe("Tue 21 Apr 2026, 17:00");
    expect(document.querySelector(".add-panel")?.classList.contains("is-editing")).toBe(true);
    expect(schedField?.querySelector<HTMLInputElement>(".datetime-picker-popover input[type='date']")?.value).toBe("2026-04-21");
    expect(schedField?.querySelector<HTMLInputElement>(".datetime-picker-popover input[type='time']")?.value).toBe("17:00");
    expect(schedPickerToggle).not.toBeNull();
    expect(schedRepeatSelect?.value).toBe(".+1w");
    expect(deadRepeatSelect?.value).toBe("");
    expect((schedRepeatSelect?.closest(".add-field") as HTMLElement | null)?.style.display).toBe("");
    expect((deadRepeatSelect?.closest(".add-field") as HTMLElement | null)?.style.display).toBe("none");
    expect(checkboxSection?.style.display).toBe("none");

    tagInput!.focus();
    tagInput!.value = "wo";
    tagInput!.dispatchEvent(new Event("input", { bubbles: true }));
    tagInput!.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }));
    tagInput!.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
    await flush();

    const selectedTags = Array.from(document.querySelectorAll<HTMLElement>(".tag-picker-pill span"))
      .map(el => el.textContent)
      .filter((text): text is string => Boolean(text));
    expect(selectedTags).toContain("work");

    titleInput!.value = "Yoga deluxe";
    schedInput!.value = "2";
    schedInput!.dispatchEvent(new Event("input", { bubbles: true }));
    expect(schedPreview?.textContent).toBe("Sat 2 May 2026");

    deadInput!.value = "5";
    deadInput!.dispatchEvent(new Event("input", { bubbles: true }));
    expect(document.querySelector<HTMLElement>("#add-dead")?.closest(".add-field")?.querySelector(".datetime-preview")?.textContent)
      .toBe("Tue 5 May 2026");
    expect(deadRepeatSelect?.closest(".add-field")).not.toBeNull();
    expect((deadRepeatSelect?.closest(".add-field") as HTMLElement | null)?.style.display).toBe("");

    deadInput!.value = "5/3";
    deadInput!.dispatchEvent(new Event("input", { bubbles: true }));
    expect(document.querySelector<HTMLElement>("#add-dead")?.closest(".add-field")?.querySelector(".datetime-preview")?.textContent)
      .toBe("Fri 5 Mar 2027");

    deadInput!.value = "5/3/28";
    deadInput!.dispatchEvent(new Event("input", { bubbles: true }));
    expect(document.querySelector<HTMLElement>("#add-dead")?.closest(".add-field")?.querySelector(".datetime-preview")?.textContent)
      .toBe("Sun 5 Mar 2028");

    schedInput!.value = "21/";
    schedInput!.dispatchEvent(new Event("input", { bubbles: true }));
    expect(schedPreview?.textContent).toBe("");
    expect(schedPreview?.classList.contains("is-visible")).toBe(false);
    expect((schedRepeatSelect?.closest(".add-field") as HTMLElement | null)?.style.display).toBe("none");

    schedInput!.value = "+341374344";
    schedInput!.dispatchEvent(new Event("input", { bubbles: true }));
    expect(schedPreview?.textContent).toBe("");
    expect(schedPreview?.classList.contains("is-visible")).toBe(false);

    schedInput!.value = "21/04/2026 18:30";
    schedInput!.dispatchEvent(new Event("input", { bubbles: true }));
    expect(schedPreview?.textContent).toBe("Tue 21 Apr 2026, 18:30");
    expect(schedPreview?.classList.contains("is-visible")).toBe(true);
    expect((schedRepeatSelect?.closest(".add-field") as HTMLElement | null)?.style.display).toBe("");

    const schedDatePicker = schedField?.querySelector<HTMLInputElement>(".datetime-picker-popover input[type='date']");
    const schedTimePicker = schedField?.querySelector<HTMLInputElement>(".datetime-picker-popover input[type='time']");
    expect(schedDatePicker).not.toBeNull();
    expect(schedTimePicker).not.toBeNull();
    schedPickerToggle!.click();
    expect(schedField?.querySelector<HTMLElement>(".datetime-picker-popover")?.classList.contains("is-open")).toBe(true);
    schedDatePicker!.value = "2026-04-22";
    schedDatePicker!.dispatchEvent(new Event("input", { bubbles: true }));
    schedTimePicker!.value = "19:15";
    schedTimePicker!.dispatchEvent(new Event("input", { bubbles: true }));
    expect(schedInput!.value).toBe("22/04/2026 19:15");
    expect(schedPreview?.textContent).toBe("Wed 22 Apr 2026, 19:15");
    schedRepeatSelect!.value = "++1w";
    schedRepeatSelect!.dispatchEvent(new Event("change", { bubbles: true }));
    expect(checkboxSection?.style.display).toBe("none");
    schedRepeatSelect!.value = "";
    schedRepeatSelect!.dispatchEvent(new Event("change", { bubbles: true }));
    expect(checkboxSection?.style.display).toBe("");
    schedRepeatSelect!.value = "++1w";
    schedRepeatSelect!.dispatchEvent(new Event("change", { bubbles: true }));
    deadInput!.value = "23/04/2026 08:00";
    deadInput!.dispatchEvent(new Event("input", { bubbles: true }));
    expect((deadRepeatSelect?.closest(".add-field") as HTMLElement | null)?.style.display).toBe("");
    deadRepeatSelect!.value = ".+1m";
    deadRepeatSelect!.dispatchEvent(new Event("change", { bubbles: true }));
    deadInput!.value = "";
    deadInput!.dispatchEvent(new Event("input", { bubbles: true }));
    expect((deadRepeatSelect?.closest(".add-field") as HTMLElement | null)?.style.display).toBe("none");
    deadInput!.value = "23/04/2026 08:00";
    deadInput!.dispatchEvent(new Event("input", { bubbles: true }));
    expect((deadRepeatSelect?.closest(".add-field") as HTMLElement | null)?.style.display).toBe("");
    deadRepeatSelect!.value = ".+1m";
    deadRepeatSelect!.dispatchEvent(new Event("change", { bubbles: true }));
    await flush();

    const editedSource = localStorage.getItem("mediant-org-source") ?? "";
    expect(editedSource).toContain("** TODO Yoga deluxe");
    expect(editedSource).toContain(":work:");
    expect(editedSource).toContain("DEADLINE: <2026-04-23 Thu 08:00 .+1m> SCHEDULED: <2026-04-22 Wed 19:15 ++1w>");
    expect(editedSource).toContain("Body line.");

    const updatedTitle = Array.from(document.querySelectorAll<HTMLElement>(".item-title[data-base-date='2026-04-22']"))
      .find(el => el.textContent?.includes("Yoga deluxe")) ?? null;
    expect(updatedTitle).not.toBeNull();
    updatedTitle!.click();
    await waitFor(() => document.querySelector(".add-panel.is-open") !== null);

    const invalidSchedInput = document.querySelector<HTMLInputElement>("#add-sched");
    const invalidSchedField = document.querySelector<HTMLInputElement>("#add-sched")?.closest(".add-field");
    const invalidSchedPreview = invalidSchedField?.querySelector<HTMLElement>(".datetime-preview");
    const invalidTitleInput = document.querySelector<HTMLInputElement>("#add-title");
    const sourceBeforeInvalidSave = localStorage.getItem("mediant-org-source") ?? "";
    expect(invalidSchedInput).not.toBeNull();
    expect(invalidSchedPreview).not.toBeNull();
    expect(invalidTitleInput).not.toBeNull();

    invalidTitleInput!.value = "Yoga should not save";
    invalidSchedInput!.value = "31/0";
    invalidSchedInput!.dispatchEvent(new Event("input", { bubbles: true }));
    expect(invalidSchedPreview?.textContent).toBe("");
    await flush();

    expect(localStorage.getItem("mediant-org-source")).toBe(sourceBeforeInvalidSave);

    const occurrenceToggles = document.querySelectorAll<HTMLInputElement>(".occurrence-toggle-checkbox");
    const skipCheckbox = occurrenceToggles[0];
    const endSeriesCheckbox = occurrenceToggles[1];
    const occurrenceLabels = Array.from(document.querySelectorAll<HTMLElement>(".occurrence-toggle-label"))
      .map(label => label.textContent);
    const occurrenceInput = document.querySelector<HTMLInputElement>(".occurrence-input");
    const occurrencePreview = document.querySelector<HTMLElement>(".occurrence-preview");
    const occurrenceNote = document.querySelector<HTMLTextAreaElement>(".occurrence-note");
    const occurrenceButtons = Array.from(document.querySelectorAll<HTMLButtonElement>(".occurrence-btn"));
    const clearOverrideButton = occurrenceButtons.find(button => button.textContent === "Clear override");
    expect(skipCheckbox).not.toBeUndefined();
    expect(endSeriesCheckbox).not.toBeNull();
    expect(occurrenceInput).not.toBeNull();
    expect(occurrencePreview).not.toBeNull();
    expect(occurrenceNote).not.toBeNull();
    expect(clearOverrideButton).not.toBeUndefined();
    expect(occurrenceLabels).toContain("Stop repeating after this occurrence");
    expect(endSeriesCheckbox?.checked).toBe(false);

    occurrenceNote!.focus();
    occurrenceNote!.value = "Bring";
    occurrenceNote!.dispatchEvent(new Event("input", { bubbles: true }));
    await flush();
    occurrenceNote!.value += " ";
    occurrenceNote!.dispatchEvent(new Event("input", { bubbles: true }));
    await flush();
    expect(occurrenceNote!.value).toBe("Bring ");
    occurrenceNote!.value += "water";
    occurrenceNote!.dispatchEvent(new Event("input", { bubbles: true }));
    await flush();

    let sourceWithNote = localStorage.getItem("mediant-org-source") ?? "";
    expect(occurrenceNote!.value).toBe("Bring water");
    expect(sourceWithNote).toContain(":EXCEPTION-NOTE-2026-04-22: Bring water");

    occurrenceNote!.value = "";
    occurrenceNote!.dispatchEvent(new Event("input", { bubbles: true }));
    await flush();
    sourceWithNote = localStorage.getItem("mediant-org-source") ?? "";
    expect(sourceWithNote).not.toContain(":EXCEPTION-NOTE-2026-04-22:");

    const sourceBeforeInvalidOverride = localStorage.getItem("mediant-org-source") ?? "";
    occurrenceInput!.value = "+45m";
    occurrenceInput!.dispatchEvent(new Event("input", { bubbles: true }));
    expect(occurrencePreview?.textContent).toBe("");
    await flush();

    expect(localStorage.getItem("mediant-org-source") ?? "").toBe(sourceBeforeInvalidOverride);

    occurrenceInput!.value = "29/04/2026 18:00";
    occurrenceInput!.dispatchEvent(new Event("input", { bubbles: true }));
    expect(occurrencePreview?.textContent).toBe("Wed 29 Apr 2026, 18:00");
    await flush();

    let sourceWithMove = localStorage.getItem("mediant-org-source") ?? "";
    expect(sourceWithMove).toContain(":EXCEPTION-2026-04-22: reschedule 2026-04-29 18:00");

    clearOverrideButton!.click();
    await flush();

    sourceWithMove = localStorage.getItem("mediant-org-source") ?? "";
    expect(sourceWithMove).not.toContain(":EXCEPTION-2026-04-22: reschedule 2026-04-29 18:00");

    occurrenceInput!.value = "18:30-21:15";
    occurrenceInput!.dispatchEvent(new Event("input", { bubbles: true }));
    expect(occurrencePreview?.textContent).toBe("Wed 22 Apr 2026, 18:30-21:15");
    await flush();

    const sourceWithSameDayTimeRange = localStorage.getItem("mediant-org-source") ?? "";
    expect(sourceWithSameDayTimeRange).toContain(":EXCEPTION-2026-04-22: reschedule 2026-04-22 18:30-21:15");
    expect(document.querySelector<HTMLElement>(".occurrence-state")?.textContent).toBe("Moved to 18:30–21:15");

    clearOverrideButton!.click();
    await flush();

    endSeriesCheckbox!.checked = true;
    endSeriesCheckbox!.dispatchEvent(new Event("change", { bubbles: true }));
    await flush();

    let sourceWithSeriesEnd = localStorage.getItem("mediant-org-source") ?? "";
    expect(sourceWithSeriesEnd).toContain(":SERIES-UNTIL: 2026-04-29");

    endSeriesCheckbox!.checked = false;
    endSeriesCheckbox!.dispatchEvent(new Event("change", { bubbles: true }));
    await flush();

    sourceWithSeriesEnd = localStorage.getItem("mediant-org-source") ?? "";
    expect(sourceWithSeriesEnd).not.toContain(":SERIES-UNTIL:");

    expect(skipCheckbox.checked).toBe(false);
    skipCheckbox.checked = true;
    skipCheckbox.dispatchEvent(new Event("change", { bubbles: true }));
    await flush();

    let sourceWithSkip = localStorage.getItem("mediant-org-source") ?? "";
    expect(sourceWithSkip).toContain(":EXCEPTION-2026-04-22: cancelled");

    skipCheckbox.checked = false;
    skipCheckbox.dispatchEvent(new Event("change", { bubbles: true }));
    await flush();

    sourceWithSkip = localStorage.getItem("mediant-org-source") ?? "";
    expect(sourceWithSkip).not.toContain(":EXCEPTION-2026-04-22: cancelled");

    skipCheckbox.checked = true;
    skipCheckbox.dispatchEvent(new Event("change", { bubbles: true }));
    await flush();

    const finalSource = localStorage.getItem("mediant-org-source") ?? "";
    expect(finalSource).toContain(":PROPERTIES:\n:EXCEPTION-2026-04-22: cancelled\n:END:");
    const skippedTitle = Array.from(document.querySelectorAll<HTMLElement>(".item-title[data-base-date='2026-04-22']"))
      .find(el => el.textContent?.includes("Yoga deluxe")) ?? null;
    expect(skippedTitle).not.toBeNull();
    expect(skippedTitle?.textContent).toContain("Yoga deluxe");
    const skippedRow = skippedTitle?.closest(".item-skipped");
    expect(skippedRow).not.toBeNull();
    const skippedChip = skippedTitle?.querySelector<HTMLElement>(".item-override-chip.override-cancelled");
    expect(skippedChip?.textContent).toBe("skipped");

    document.querySelector<HTMLButtonElement>(".add-item-btn")!.click();
    await waitFor(() => document.querySelector(".add-panel.is-open") !== null);

    const typingTitleInput = document.querySelector<HTMLInputElement>("#add-title");
    expect(typingTitleInput).not.toBeNull();
    typingTitleInput!.focus();
    keydownHandler!(makeKeydownEvent("n", typingTitleInput!));
    keydownHandler!(makeKeydownEvent("t", typingTitleInput!));
    keydownHandler!(makeKeydownEvent("a", typingTitleInput!));
    keydownHandler!(makeKeydownEvent("x", typingTitleInput!));
    await flush();
    expect(document.querySelector<HTMLElement>(".nav-week-date")?.textContent).toBe("20–26 April 2026");
    expect(document.querySelector(".add-panel.is-open")).not.toBeNull();
  });

  it("drops queued edit saves after an authoritative server reload", async () => {
    let serverSource = [
      "** TODO Yoga",
      "SCHEDULED: <2026-04-20 Mon 11:00>",
      "",
    ].join("\n");
    let serverVersion = "v1";
    const putCalls: Array<{ body: string; ifMatch: string | null }> = [];
    let resolveFirstPut: (() => void) | null = null;

    const eventSources: Array<{ emit: (data: string) => void }> = [];
    class FakeEventSource {
      onmessage: ((event: { data: string }) => void) | null = null;

      constructor(readonly url: string) {
        eventSources.push(this);
      }

      emit(data: string): void {
        this.onmessage?.({ data });
      }

      close(): void {}
    }

    vi.stubGlobal("EventSource", FakeEventSource as unknown as typeof EventSource);
    vi.stubGlobal("alert", vi.fn());
    vi.stubGlobal("fetch", vi.fn((input: string, init?: RequestInit) => {
      if (input !== "/api/source") throw new Error(`unexpected fetch: ${input}`);
      const method = init?.method ?? "GET";
      if (method === "GET") {
        return Promise.resolve(makeMockResponse(200, serverSource, serverVersion));
      }
      if (method !== "PUT") throw new Error(`unexpected method: ${method}`);

      const headers = (init?.headers ?? {}) as Record<string, string>;
      putCalls.push({
        body: String(init?.body ?? ""),
        ifMatch: headers["If-Match"] ?? null,
      });
      if (putCalls.length === 1) {
        return new Promise((resolve) => {
          resolveFirstPut = () => resolve(makeMockResponse(200, "", "v1a"));
        });
      }
      return Promise.resolve(makeMockResponse(200, "", `v${putCalls.length + 1}`));
    }));

    await import("../main.ts");
    await waitFor(() => document.querySelector(".scheduled-item .item-title") !== null);
    expect(eventSources).toHaveLength(1);

    const title = document.querySelector<HTMLElement>(".scheduled-item .item-title");
    expect(title).not.toBeNull();
    title!.click();
    await waitFor(() => document.querySelector(".add-panel.is-open") !== null);

    const titleInput = document.querySelector<HTMLInputElement>("#add-title");
    expect(titleInput).not.toBeNull();

    titleInput!.value = "Yoga one";
    titleInput!.dispatchEvent(new Event("input", { bubbles: true }));
    await flush();
    expect(putCalls).toHaveLength(1);
    expect(putCalls[0].body).toContain("** TODO Yoga one");
    expect(putCalls[0].ifMatch).toBe("v1");

    titleInput!.value = "Yoga two";
    titleInput!.dispatchEvent(new Event("input", { bubbles: true }));
    await flush();
    expect(putCalls).toHaveLength(1);

    serverSource = [
      "** TODO External edit",
      "SCHEDULED: <2026-04-20 Mon 11:00>",
      "",
    ].join("\n");
    serverVersion = "v2";
    eventSources[0].emit("v2");
    await flush();

    expect(Array.from(document.querySelectorAll<HTMLElement>(".scheduled-item .item-title")).some(
      el => el.textContent?.includes("External edit"),
    )).toBe(true);

    expect(resolveFirstPut).not.toBeNull();
    resolveFirstPut!();
    await flush();

    expect(putCalls).toHaveLength(1);
    const titles = Array.from(document.querySelectorAll<HTMLElement>(".scheduled-item .item-title"))
      .map(el => el.textContent ?? "");
    expect(titles.some(text => text.includes("External edit"))).toBe(true);
    expect(titles.some(text => text.includes("Yoga one"))).toBe(false);
    expect(titles.some(text => text.includes("Yoga two"))).toBe(false);
  });

});

async function waitFor(predicate: () => boolean): Promise<void> {
  for (let i = 0; i < 20; i++) {
    if (predicate()) return;
    await flush();
  }
  throw new Error("condition not met");
}

async function flush(): Promise<void> {
  await Promise.resolve();
  vi.runOnlyPendingTimers();
  await Promise.resolve();
}

function makeKeydownEvent(key: string, target: EventTarget): KeyboardEvent {
  const event = new Event("keydown", { bubbles: true, cancelable: true }) as KeyboardEvent;
  Object.defineProperty(event, "key", { value: key });
  Object.defineProperty(event, "code", { value: `Key${key.toUpperCase()}` });
  Object.defineProperty(event, "target", { value: target });
  Object.defineProperty(event, "preventDefault", { value: vi.fn() });
  return event;
}

function makeMockResponse(status: number, body = "", version: string | null = null) {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: status === 200 ? "OK" : "Error",
    headers: {
      get(name: string): string | null {
        if (name.toLowerCase() === "x-version") return version;
        return null;
      },
    },
    text: async (): Promise<string> => body,
  };
}
