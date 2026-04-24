/**
 * Browser notifications for upcoming timed events.
 * Fires 1 hour before each event's start time (today only).
 */

const STORAGE_KEY = "mediant-notifications";
const LEAD_MS = 60 * 60 * 1000; // 1 hour

let activeTimers: ReturnType<typeof setTimeout>[] = [];

function formatLocalDateKey(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

export function notificationsEnabled(): boolean {
  return localStorage.getItem(STORAGE_KEY) === "on";
}

export function setNotificationsEnabled(on: boolean): void {
  localStorage.setItem(STORAGE_KEY, on ? "on" : "off");
}

/**
 * Request notification permission if not yet granted.
 * Returns true if permission is granted.
 */
export async function requestPermission(): Promise<boolean> {
  if (!("Notification" in window)) return false;
  if (Notification.permission === "granted") return true;
  if (Notification.permission === "denied") return false;
  const result = await Notification.requestPermission();
  return result === "granted";
}

/**
 * Cancel all pending notification timers.
 */
export function clearScheduled(): void {
  for (const t of activeTimers) clearTimeout(t);
  activeTimers = [];
}

/**
 * Schedule notifications for timed events happening today.
 * Call this on every render when notifications are enabled.
 *
 * @param items - Array of { title, date (ISO string), startTime (HH:MM) }
 */
export function scheduleNotifications(
  items: readonly { title: string; dateStr: string; startTime: string }[],
): void {
  clearScheduled();

  if (!notificationsEnabled()) return;
  if (Notification.permission !== "granted") return;

  const now = Date.now();
  const todayStr = formatLocalDateKey(new Date());

  for (const item of items) {
    if (item.dateStr !== todayStr) continue;

    const [h, m] = item.startTime.split(":").map(Number);
    const eventTime = new Date();
    eventTime.setHours(h, m, 0, 0);

    const fireAt = eventTime.getTime() - LEAD_MS;
    const delay = fireAt - now;

    // Only schedule if the notification time is in the future
    if (delay > 0) {
      const timer = setTimeout(() => {
        new Notification(item.title, {
          icon: "/icon.svg",
          body: `Starts in 1 hour \u00B7 ${item.startTime}`,
          tag: `mediant-${item.dateStr}-${item.startTime}-${item.title}`,
        });
      }, delay);
      activeTimers.push(timer);
    }
  }
}
