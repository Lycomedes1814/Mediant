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
    localStorage.setItem(
      "mediant-org-source",
      [
        "** TODO Yoga",
        "SCHEDULED: <2026-04-20 Mon 17:00 +1w>",
        "Body line.",
        "",
      ].join("\n"),
    );

    await import("../main.ts");
    await flush();

    await waitFor(() => document.querySelector(".input-load-btn") !== null);
    const loadButton = document.querySelector<HTMLButtonElement>(".input-load-btn");
    expect(loadButton).not.toBeNull();
    loadButton!.click();
    await waitFor(() => document.querySelector(".days-card") !== null);

    const toggle = document.querySelector<HTMLElement>(".item-state.is-toggleable");
    expect(toggle?.textContent).toBe("TODO");
    toggle!.click();
    await flush();
    expect(localStorage.getItem("mediant-org-source")).toContain("** DONE Yoga");

    const title = document.querySelector<HTMLElement>(".item-title[data-base-date='2026-04-20']");
    expect(title).not.toBeNull();
    title!.click();
    await waitFor(() => document.querySelector(".add-panel.is-open") !== null);

    const titleInput = document.querySelector<HTMLInputElement>("#add-title");
    const schedInput = document.querySelector<HTMLInputElement>("#add-sched");
    const saveButton = document.querySelector<HTMLButtonElement>(".add-save-btn");
    expect(titleInput?.value).toBe("Yoga");
    expect(schedInput?.value).toBe("20/04/2026 17:00");
    expect(saveButton?.textContent).toBe("Save");

    titleInput!.value = "Yoga deluxe";
    schedInput!.value = "21/04/2026 18:30";
    saveButton!.click();
    await flush();

    const editedSource = localStorage.getItem("mediant-org-source") ?? "";
    expect(editedSource).toContain("** DONE Yoga deluxe");
    expect(editedSource).toContain("SCHEDULED: <2026-04-21 Tue 18:30 +1w>");
    expect(editedSource).toContain("Body line.");

    const updatedTitle = document.querySelector<HTMLElement>(".item-title[data-base-date='2026-04-21']");
    expect(updatedTitle).not.toBeNull();
    updatedTitle!.click();
    await waitFor(() => document.querySelector(".add-panel.is-open") !== null);

    const occurrenceToggles = document.querySelectorAll<HTMLInputElement>(".occurrence-toggle-checkbox");
    const skipCheckbox = occurrenceToggles[0];
    const endSeriesCheckbox = occurrenceToggles[1];
    const occurrenceLabels = Array.from(document.querySelectorAll<HTMLElement>(".occurrence-toggle-label"))
      .map(label => label.textContent);
    const occurrenceInput = document.querySelector<HTMLInputElement>(".occurrence-input");
    const occurrenceButtons = Array.from(document.querySelectorAll<HTMLButtonElement>(".occurrence-btn"));
    const applyOverrideButton = occurrenceButtons.find(button => button.textContent === "Apply");
    const clearOverrideButton = occurrenceButtons.find(button => button.textContent === "Clear override");
    expect(skipCheckbox).not.toBeUndefined();
    expect(endSeriesCheckbox).not.toBeNull();
    expect(occurrenceInput).not.toBeNull();
    expect(applyOverrideButton).not.toBeUndefined();
    expect(clearOverrideButton).not.toBeUndefined();
    expect(occurrenceLabels).toContain("Stop repeating after this occurrence");
    expect(endSeriesCheckbox?.checked).toBe(false);

    occurrenceInput!.value = "+45m";
    applyOverrideButton!.click();
    await flush();

    let sourceWithShift = localStorage.getItem("mediant-org-source") ?? "";
    expect(sourceWithShift).toContain(":EXCEPTION-2026-04-21: shift +45m");

    clearOverrideButton!.click();
    await flush();

    sourceWithShift = localStorage.getItem("mediant-org-source") ?? "";
    expect(sourceWithShift).not.toContain(":EXCEPTION-2026-04-21: shift +45m");

    occurrenceInput!.value = "29/04/2026 18:00";
    applyOverrideButton!.click();
    await flush();

    let sourceWithMove = localStorage.getItem("mediant-org-source") ?? "";
    expect(sourceWithMove).toContain(":EXCEPTION-2026-04-21: reschedule 2026-04-29 18:00");

    clearOverrideButton!.click();
    await flush();

    sourceWithMove = localStorage.getItem("mediant-org-source") ?? "";
    expect(sourceWithMove).not.toContain(":EXCEPTION-2026-04-21: reschedule 2026-04-29 18:00");

    occurrenceInput!.value = "18:30-21:15";
    applyOverrideButton!.click();
    await flush();

    const sourceWithSameDayTimeRange = localStorage.getItem("mediant-org-source") ?? "";
    expect(sourceWithSameDayTimeRange).toContain(":EXCEPTION-2026-04-21: reschedule 2026-04-21 18:30-21:15");
    expect(document.querySelector<HTMLElement>(".occurrence-state")?.textContent).toBe("Moved to 18:30–21:15");

    clearOverrideButton!.click();
    await flush();

    endSeriesCheckbox!.checked = true;
    endSeriesCheckbox!.dispatchEvent(new Event("change", { bubbles: true }));
    await flush();

    let sourceWithSeriesEnd = localStorage.getItem("mediant-org-source") ?? "";
    expect(sourceWithSeriesEnd).toContain(":SERIES-UNTIL: 2026-04-28");

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
    expect(sourceWithSkip).toContain(":EXCEPTION-2026-04-21: cancelled");

    skipCheckbox.checked = false;
    skipCheckbox.dispatchEvent(new Event("change", { bubbles: true }));
    await flush();

    sourceWithSkip = localStorage.getItem("mediant-org-source") ?? "";
    expect(sourceWithSkip).not.toContain(":EXCEPTION-2026-04-21: cancelled");

    skipCheckbox.checked = true;
    skipCheckbox.dispatchEvent(new Event("change", { bubbles: true }));
    await flush();

    const finalSource = localStorage.getItem("mediant-org-source") ?? "";
    expect(finalSource).toContain(":PROPERTIES:\n:EXCEPTION-2026-04-21: cancelled\n:END:");
    const skippedTitle = document.querySelector<HTMLElement>(".item-title[data-base-date='2026-04-21']");
    expect(skippedTitle).not.toBeNull();
    expect(skippedTitle?.textContent).toContain("Yoga deluxe");
    const skippedRow = skippedTitle?.closest(".item-skipped");
    expect(skippedRow).not.toBeNull();
    const skippedChip = skippedTitle?.querySelector<HTMLElement>(".item-override-chip.override-cancelled");
    expect(skippedChip?.textContent).toBe("skipped");
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
