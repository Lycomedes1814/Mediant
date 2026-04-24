// @vitest-environment happy-dom

import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

const originalTz = process.env.TZ;
process.env.TZ = "Europe/Oslo";

afterAll(() => {
  if (originalTz === undefined) {
    delete process.env.TZ;
  } else {
    process.env.TZ = originalTz;
  }
});

describe("scheduleNotifications", () => {
  let notificationMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.resetModules();
    vi.useFakeTimers();
    localStorage.clear();
    localStorage.setItem("mediant-notifications", "on");
    notificationMock = vi.fn();
    notificationMock.permission = "granted";
    vi.stubGlobal("Notification", notificationMock);
  });

  it("treats today as the local calendar day, not the UTC date", async () => {
    vi.setSystemTime(new Date("2026-04-24T22:30:00Z"));
    const { scheduleNotifications } = await import("../notifications.ts");

    scheduleNotifications([
      { title: "Night shift", dateStr: "2026-04-25", startTime: "02:00" },
    ]);

    expect(vi.getTimerCount()).toBe(1);

    vi.advanceTimersByTime(30 * 60 * 1000);
    expect(notificationMock).toHaveBeenCalledWith("Night shift", expect.objectContaining({
      body: "Starts in 1 hour · 02:00",
      tag: "mediant-2026-04-25-02:00-Night shift",
    }));
  });
});
