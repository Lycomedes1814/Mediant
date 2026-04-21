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
    expect(titleInput?.value).toBe("Yoga");
    expect(schedInput?.value).toBe("20/04/2026 17:00");

    titleInput!.value = "Yoga deluxe";
    schedInput!.value = "21/04/2026 18:30";
    document.querySelector<HTMLButtonElement>(".add-save-btn")!.click();
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
    expect(skipCheckbox).not.toBeUndefined();
    expect(endSeriesCheckbox).not.toBeNull();
    expect(endSeriesCheckbox?.checked).toBe(false);
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
    expect(document.querySelector(".item-title[data-base-date='2026-04-21']")).toBeNull();
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
