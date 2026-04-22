import { describe, it, expect } from "vitest";
import {
  parseTimestamps,
  toDate,
  toEndDate,
  isDateOnly,
  isTimed,
  stepDate,
  expandRecurrences,
  expandOccurrences,
} from "../timestamp.ts";
import type { RecurrenceException } from "../model.ts";

// ── Parsing ──────────────────────────────────────────────────────────

describe("parseTimestamps", () => {
  it("parses a date-only timestamp", () => {
    const results = parseTimestamps("<2026-04-05 sø.>");
    expect(results).toHaveLength(1);
    expect(results[0]).toEqual({
      date: "2026-04-05",
      startTime: null,
      endTime: null,
      repeater: null,
      raw: "<2026-04-05 sø.>",
    });
  });

  it("parses a timestamp with start time only", () => {
    const results = parseTimestamps("<2026-04-14 ti. 12:00>");
    expect(results).toHaveLength(1);
    expect(results[0].date).toBe("2026-04-14");
    expect(results[0].startTime).toBe("12:00");
    expect(results[0].endTime).toBeNull();
  });

  it("parses a timestamp with time range", () => {
    const results = parseTimestamps("<2026-04-07 ti. 15:15-16:00>");
    expect(results).toHaveLength(1);
    expect(results[0].startTime).toBe("15:15");
    expect(results[0].endTime).toBe("16:00");
  });

  it("parses a weekly repeater", () => {
    const results = parseTimestamps("<2026-04-07 ti. 13:15-14:00 +1w>");
    expect(results).toHaveLength(1);
    expect(results[0].repeater).toEqual({ mark: "+", value: 1, unit: "w" });
  });

  it("parses a yearly repeater", () => {
    const results = parseTimestamps("<2026-04-06 ma. +1y>");
    expect(results).toHaveLength(1);
    expect(results[0].repeater).toEqual({ mark: "+", value: 1, unit: "y" });
    expect(results[0].startTime).toBeNull();
  });

  it("parses a daily repeater", () => {
    const results = parseTimestamps("<2026-04-06 ma. 09:00 +1d>");
    expect(results).toHaveLength(1);
    expect(results[0].repeater).toEqual({ mark: "+", value: 1, unit: "d" });
  });

  it("parses a monthly repeater", () => {
    const results = parseTimestamps("<2026-04-06 ma. +1m>");
    expect(results).toHaveLength(1);
    expect(results[0].repeater).toEqual({ mark: "+", value: 1, unit: "m" });
  });

  it("parses a multi-value repeater", () => {
    const results = parseTimestamps("<2026-04-06 ma. +2w>");
    expect(results).toHaveLength(1);
    expect(results[0].repeater).toEqual({ mark: "+", value: 2, unit: "w" });
  });

  it("parses a catch-up repeater", () => {
    const results = parseTimestamps("<2026-04-06 ma. .+2w>");
    expect(results).toHaveLength(1);
    expect(results[0].repeater).toEqual({ mark: ".+", value: 2, unit: "w" });
  });

  it("parses a restart repeater", () => {
    const results = parseTimestamps("<2026-04-06 ma. ++1m>");
    expect(results).toHaveLength(1);
    expect(results[0].repeater).toEqual({ mark: "++", value: 1, unit: "m" });
  });

  it("ignores zero-value repeaters", () => {
    const results = parseTimestamps("<2026-04-06 ma. +0d>");
    expect(results).toHaveLength(1);
    expect(results[0].repeater).toBeNull();
  });

  it("handles Norwegian weekday names", () => {
    for (const day of ["ma.", "ti.", "on.", "to.", "fr.", "lø.", "sø."]) {
      const results = parseTimestamps(`<2026-04-07 ${day}>`);
      expect(results).toHaveLength(1);
      expect(results[0].date).toBe("2026-04-07");
    }
  });

  it("handles English weekday names", () => {
    for (const day of ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]) {
      const results = parseTimestamps(`<2026-04-07 ${day}>`);
      expect(results).toHaveLength(1);
      expect(results[0].date).toBe("2026-04-07");
    }
  });

  it("finds multiple timestamps in one string", () => {
    const text =
      "SCHEDULED: <2026-04-14 ti. 12:00> DEADLINE: <2026-05-05 ti.>";
    const results = parseTimestamps(text);
    expect(results).toHaveLength(2);
    expect(results[0].date).toBe("2026-04-14");
    expect(results[1].date).toBe("2026-05-05");
  });

  it("returns empty array for text with no timestamps", () => {
    expect(parseTimestamps("Just some text")).toEqual([]);
    expect(parseTimestamps("")).toEqual([]);
  });

  it("preserves raw text exactly", () => {
    const raw = "<2026-04-07 ti. 15:15-16:00 +1w>";
    const results = parseTimestamps(raw);
    expect(results[0].raw).toBe(raw);
  });

  it("ignores inactive (square-bracket) timestamps", () => {
    const results = parseTimestamps("[2026-04-07 ti. 15:15]");
    expect(results).toHaveLength(0);
  });
});

// ── Helpers ──────────────────────────────────────────────────────────

describe("isDateOnly / isTimed", () => {
  it("date-only timestamp", () => {
    const ts = parseTimestamps("<2026-04-05 sø.>")[0];
    expect(isDateOnly(ts)).toBe(true);
    expect(isTimed(ts)).toBe(false);
  });

  it("timed timestamp with range", () => {
    const ts = parseTimestamps("<2026-04-07 ti. 15:15-16:00>")[0];
    expect(isDateOnly(ts)).toBe(false);
    expect(isTimed(ts)).toBe(true);
  });

  it("timed timestamp without range", () => {
    const ts = parseTimestamps("<2026-04-14 ti. 12:00>")[0];
    expect(isDateOnly(ts)).toBe(false);
    expect(isTimed(ts)).toBe(true);
  });
});

describe("toDate", () => {
  it("converts date-only to midnight local time", () => {
    const ts = parseTimestamps("<2026-04-05 sø.>")[0];
    const d = toDate(ts);
    expect(d.getFullYear()).toBe(2026);
    expect(d.getMonth()).toBe(3); // April = 3
    expect(d.getDate()).toBe(5);
    expect(d.getHours()).toBe(0);
    expect(d.getMinutes()).toBe(0);
  });

  it("converts timed timestamp to correct local time", () => {
    const ts = parseTimestamps("<2026-04-07 ti. 15:15>")[0];
    const d = toDate(ts);
    expect(d.getHours()).toBe(15);
    expect(d.getMinutes()).toBe(15);
  });

  it("converts time range start correctly", () => {
    const ts = parseTimestamps("<2026-04-07 ti. 18:30-20:00>")[0];
    const d = toDate(ts);
    expect(d.getHours()).toBe(18);
    expect(d.getMinutes()).toBe(30);
  });
});

describe("toEndDate", () => {
  it("returns end date for time range", () => {
    const ts = parseTimestamps("<2026-04-07 ti. 15:15-16:00>")[0];
    const end = toEndDate(ts);
    expect(end).not.toBeNull();
    expect(end!.getHours()).toBe(16);
    expect(end!.getMinutes()).toBe(0);
  });

  it("returns null when no end time", () => {
    const ts = parseTimestamps("<2026-04-07 ti. 15:15>")[0];
    expect(toEndDate(ts)).toBeNull();
  });

  it("returns null for date-only", () => {
    const ts = parseTimestamps("<2026-04-05 sø.>")[0];
    expect(toEndDate(ts)).toBeNull();
  });
});

// ── Recurrence expansion ─────────────────────────────────────────────

describe("expandRecurrences", () => {
  // Week of April 6–12, 2026 (Mon–Sun)
  const weekStart = new Date(2026, 3, 6, 0, 0, 0);
  const weekEnd = new Date(2026, 3, 12, 23, 59, 59);

  it("non-repeating event inside range returns one date", () => {
    const ts = parseTimestamps("<2026-04-07 ti. 15:15-16:00>")[0];
    const dates = expandRecurrences(ts, weekStart, weekEnd);
    expect(dates).toHaveLength(1);
    expect(dates[0].getDate()).toBe(7);
    expect(dates[0].getHours()).toBe(15);
  });

  it("non-repeating event outside range returns empty", () => {
    const ts = parseTimestamps("<2026-03-01 sø.>")[0];
    expect(expandRecurrences(ts, weekStart, weekEnd)).toHaveLength(0);
  });

  it("non-repeating event after range returns empty", () => {
    const ts = parseTimestamps("<2026-05-01 to. 10:00>")[0];
    expect(expandRecurrences(ts, weekStart, weekEnd)).toHaveLength(0);
  });

  describe("+1w (weekly)", () => {
    it("base date in range appears once", () => {
      const ts = parseTimestamps("<2026-04-07 ti. 13:15-14:00 +1w>")[0];
      const dates = expandRecurrences(ts, weekStart, weekEnd);
      expect(dates).toHaveLength(1);
      expect(dates[0].getDate()).toBe(7);
    });

    it("earlier base date repeats into range", () => {
      // March 3 is a Tuesday, +1w → lands on April 7 (5 weeks later)
      const ts = parseTimestamps("<2026-03-03 ti. 10:00 +1w>")[0];
      const dates = expandRecurrences(ts, weekStart, weekEnd);
      expect(dates).toHaveLength(1);
      expect(dates[0].getDate()).toBe(7);
      expect(dates[0].getMonth()).toBe(3);
    });

    it("generates multiple hits in a wider range", () => {
      const ts = parseTimestamps("<2026-04-06 ma. 18:00-21:00 +1w>")[0];
      const twoWeekEnd = new Date(2026, 3, 19, 23, 59, 59);
      const dates = expandRecurrences(ts, weekStart, twoWeekEnd);
      expect(dates).toHaveLength(2);
      expect(dates[0].getDate()).toBe(6);
      expect(dates[1].getDate()).toBe(13);
    });

    it("base date after range returns empty", () => {
      const ts = parseTimestamps("<2026-05-01 to. 10:00 +1w>")[0];
      expect(expandRecurrences(ts, weekStart, weekEnd)).toHaveLength(0);
    });
  });

  describe("+1y (yearly)", () => {
    it("anniversary in range appears", () => {
      // Birthday on April 6, base year 2025
      const ts = parseTimestamps("<2025-04-06 sø. +1y>")[0];
      const dates = expandRecurrences(ts, weekStart, weekEnd);
      expect(dates).toHaveLength(1);
      expect(dates[0].getFullYear()).toBe(2026);
      expect(dates[0].getMonth()).toBe(3);
      expect(dates[0].getDate()).toBe(6);
    });

    it("anniversary not in range returns empty", () => {
      const ts = parseTimestamps("<2025-01-15 on. +1y>")[0];
      expect(expandRecurrences(ts, weekStart, weekEnd)).toHaveLength(0);
    });
  });

  describe("+1d (daily)", () => {
    it("generates one hit per day in range", () => {
      const ts = parseTimestamps("<2026-04-01 on. 09:00 +1d>")[0];
      const dates = expandRecurrences(ts, weekStart, weekEnd);
      expect(dates).toHaveLength(7); // April 6–12
      expect(dates[0].getDate()).toBe(6);
      expect(dates[6].getDate()).toBe(12);
    });
  });

  describe("+2w (bi-weekly)", () => {
    it("skips alternate weeks", () => {
      // Base: March 23 (Monday), +2w → April 6, April 20, ...
      const ts = parseTimestamps("<2026-03-23 ma. 10:00 +2w>")[0];
      const dates = expandRecurrences(ts, weekStart, weekEnd);
      expect(dates).toHaveLength(1);
      expect(dates[0].getDate()).toBe(6);
    });
  });

  // ── Date arithmetic edge cases ───────────────────────────────────

  describe("month boundary edge cases", () => {
    it("Jan 31 + 1m clamps to Feb 28 and keeps the clamped day thereafter", () => {
      const ts = parseTimestamps("<2026-01-31 lø. +1m>")[0];
      const febStart = new Date(2026, 1, 1, 0, 0, 0);
      const marEnd = new Date(2026, 2, 31, 23, 59, 59);
      const dates = expandRecurrences(ts, febStart, marEnd);
      expect(dates).toHaveLength(2);
      expect(dates[0].getMonth()).toBe(1); // February
      expect(dates[0].getDate()).toBe(28);
      expect(dates[1].getMonth()).toBe(2); // March
      expect(dates[1].getDate()).toBe(28);
    });

    it("March 31 + 1m clamps to April 30", () => {
      const ts = parseTimestamps("<2026-03-31 ti. +1m>")[0];
      const aprilStart = new Date(2026, 3, 1, 0, 0, 0);
      const aprilEnd = new Date(2026, 3, 30, 23, 59, 59);
      const dates = expandRecurrences(ts, aprilStart, aprilEnd);
      expect(dates).toHaveLength(1);
      expect(dates[0].getMonth()).toBe(3); // April
      expect(dates[0].getDate()).toBe(30);
    });
  });

  describe("leap year edge cases", () => {
    it("Feb 29 + 1y in non-leap year rolls to March 1", () => {
      // 2028 is a leap year, 2029 is not
      const ts = parseTimestamps("<2028-02-29 to. +1y>")[0];
      const range2029Start = new Date(2029, 1, 28, 0, 0, 0);
      const range2029End = new Date(2029, 2, 2, 23, 59, 59);
      const dates = expandRecurrences(ts, range2029Start, range2029End);
      expect(dates).toHaveLength(1);
      // Feb 29 + 1y → March 1 in 2029
      expect(dates[0].getMonth()).toBe(2); // March
      expect(dates[0].getDate()).toBe(1);
    });

    it("Feb 28 + 1y stays Feb 28 in all years", () => {
      const ts = parseTimestamps("<2026-02-28 lø. +1y>")[0];
      const range2027 = {
        start: new Date(2027, 1, 1, 0, 0, 0),
        end: new Date(2027, 1, 28, 23, 59, 59),
      };
      const dates = expandRecurrences(ts, range2027.start, range2027.end);
      expect(dates).toHaveLength(1);
      expect(dates[0].getMonth()).toBe(1); // Feb
      expect(dates[0].getDate()).toBe(28);
    });
  });

  describe("boundary precision", () => {
    it("event exactly at rangeStart is included", () => {
      const ts = parseTimestamps("<2026-04-06 ma. 00:00>")[0];
      const dates = expandRecurrences(ts, weekStart, weekEnd);
      expect(dates).toHaveLength(1);
    });

    it("date-only event on rangeEnd date is included", () => {
      const ts = parseTimestamps("<2026-04-12 sø.>")[0];
      const dates = expandRecurrences(ts, weekStart, weekEnd);
      expect(dates).toHaveLength(1);
    });
  });
});

describe("stepDate", () => {
  it("clamps monthly steps to the target month's last day", () => {
    const result = stepDate(new Date(2026, 0, 31, 9, 15, 0), 1, "m");
    expect(result.getFullYear()).toBe(2026);
    expect(result.getMonth()).toBe(1); // February
    expect(result.getDate()).toBe(28);
    expect(result.getHours()).toBe(9);
    expect(result.getMinutes()).toBe(15);
  });

  it("preserves the clamped day on subsequent monthly steps", () => {
    const first = stepDate(new Date(2026, 0, 31, 9, 15, 0), 1, "m");
    const second = stepDate(first, 1, "m");
    expect(second.getFullYear()).toBe(2026);
    expect(second.getMonth()).toBe(2); // March
    expect(second.getDate()).toBe(28);
  });
});

// ── expandOccurrences (with per-occurrence exceptions) ──────────────

describe("expandOccurrences", () => {
  // The 7-day window we use for most tests: Mon May 4 → Sun May 10, 2026.
  const may4 = new Date(2026, 4, 4);
  const may10End = new Date(2026, 4, 10, 23, 59, 59, 999);

  function ex(input: Partial<RecurrenceException>): RecurrenceException {
    return { override: input.override ?? null, note: input.note ?? null };
  }

  function emptyMap(): ReadonlyMap<string, RecurrenceException> {
    return new Map();
  }

  it("emits base occurrences when no exceptions apply", () => {
    const ts = parseTimestamps("<2026-05-04 ma. 17:00-18:00 +1w>")[0];
    const occs = expandOccurrences(ts, emptyMap(), may4, may10End);
    expect(occs).toHaveLength(1);
    expect(occs[0].baseDate).toBe("2026-05-04");
    expect(occs[0].startTime).toBe("17:00");
    expect(occs[0].endTime).toBe("18:00");
    expect(occs[0].override).toBeNull();
    expect(occs[0].note).toBeNull();
    expect(occs[0].baseStartMinutes).toBe(17 * 60);
  });

  it("keeps a cancelled occurrence on its base slot and preserves its note", () => {
    const ts = parseTimestamps("<2026-05-04 ma. 17:00 +1w>")[0];
    const exceptions = new Map<string, RecurrenceException>([
      ["2026-05-04", ex({ override: { kind: "cancelled" }, note: "bortreist" })],
    ]);
    const occs = expandOccurrences(ts, exceptions, may4, may10End);
    expect(occs).toHaveLength(1);
    expect(occs[0].baseDate).toBe("2026-05-04");
    expect(occs[0].startTime).toBe("17:00");
    expect(occs[0].override).toEqual({ kind: "cancelled" });
    expect(occs[0].note).toBe("bortreist");
  });

  it("applies a positive shift, preserving duration", () => {
    const ts = parseTimestamps("<2026-05-04 ma. 17:00-18:00 +1w>")[0];
    const exceptions = new Map<string, RecurrenceException>([
      ["2026-05-04", ex({ override: { kind: "shift", offsetMinutes: 45 } })],
    ]);
    const [occ] = expandOccurrences(ts, exceptions, may4, may10End);
    expect(occ.startTime).toBe("17:45");
    expect(occ.endTime).toBe("18:45");
    expect(occ.baseDate).toBe("2026-05-04");
    expect(occ.override).toEqual({ kind: "shift", offsetMinutes: 45 });
  });

  it("applies a negative shift", () => {
    const ts = parseTimestamps("<2026-05-04 ma. 17:00-18:00 +1w>")[0];
    const exceptions = new Map<string, RecurrenceException>([
      ["2026-05-04", ex({ override: { kind: "shift", offsetMinutes: -30 } })],
    ]);
    const [occ] = expandOccurrences(ts, exceptions, may4, may10End);
    expect(occ.startTime).toBe("16:30");
    expect(occ.endTime).toBe("17:30");
  });

  it("shift across midnight forward — final date moves to the next day", () => {
    const ts = parseTimestamps("<2026-05-04 ma. 23:30-00:30 +1w>")[0];
    const exceptions = new Map<string, RecurrenceException>([
      ["2026-05-04", ex({ override: { kind: "shift", offsetMinutes: 45 } })],
    ]);
    const [occ] = expandOccurrences(ts, exceptions, may4, may10End);
    // 23:30 + 45m → 00:15 next day; baseDate stays at the unshifted slot.
    expect(occ.date.getFullYear()).toBe(2026);
    expect(occ.date.getMonth()).toBe(4); // May
    expect(occ.date.getDate()).toBe(5);
    expect(occ.startTime).toBe("00:15");
    // duration was 60 min (00:30 → wraps as next-day), end after shift is 01:15.
    expect(occ.endTime).toBe("01:15");
    expect(occ.baseDate).toBe("2026-05-04");
  });

  it("shift across midnight backward — final date moves to the previous day", () => {
    const ts = parseTimestamps("<2026-05-05 ti. 00:15-01:15 +1w>")[0];
    const exceptions = new Map<string, RecurrenceException>([
      ["2026-05-05", ex({ override: { kind: "shift", offsetMinutes: -45 } })],
    ]);
    const [occ] = expandOccurrences(ts, exceptions, may4, may10End);
    expect(occ.date.getDate()).toBe(4);
    expect(occ.startTime).toBe("23:30");
    expect(occ.endTime).toBe("00:30"); // baseDuration 60m, applied to 23:30 → wraps
    expect(occ.baseDate).toBe("2026-05-05");
  });

  it("reschedule with date only preserves base time and end time", () => {
    const ts = parseTimestamps("<2026-05-11 ma. 17:00-18:00 +1w>")[0];
    const exceptions = new Map<string, RecurrenceException>([
      [
        "2026-05-11",
        ex({
          override: { kind: "reschedule", date: "2026-05-08", startTime: null, endTime: null },
        }),
      ],
    ]);
    const [occ] = expandOccurrences(ts, exceptions, may4, may10End);
    expect(occ.date.getDate()).toBe(8);
    expect(occ.startTime).toBe("17:00");
    expect(occ.endTime).toBe("18:00");
    expect(occ.baseDate).toBe("2026-05-11");
  });

  it("reschedule with new start time preserves base duration when base has end", () => {
    const ts = parseTimestamps("<2026-05-04 ma. 17:00-18:00 +1w>")[0];
    const exceptions = new Map<string, RecurrenceException>([
      [
        "2026-05-04",
        ex({
          override: { kind: "reschedule", date: "2026-05-06", startTime: "19:00", endTime: null },
        }),
      ],
    ]);
    const [occ] = expandOccurrences(ts, exceptions, may4, may10End);
    expect(occ.date.getDate()).toBe(6);
    expect(occ.startTime).toBe("19:00");
    expect(occ.endTime).toBe("20:00"); // 60-min duration preserved
  });

  it("reschedule with new start time and no base end → no end", () => {
    const ts = parseTimestamps("<2026-05-04 ma. 17:00 +1w>")[0];
    const exceptions = new Map<string, RecurrenceException>([
      [
        "2026-05-04",
        ex({
          override: { kind: "reschedule", date: "2026-05-06", startTime: "19:00", endTime: null },
        }),
      ],
    ]);
    const [occ] = expandOccurrences(ts, exceptions, may4, may10End);
    expect(occ.startTime).toBe("19:00");
    expect(occ.endTime).toBeNull();
  });

  it("reschedule with explicit start-end range overrides both", () => {
    const ts = parseTimestamps("<2026-05-04 ma. 17:00-18:00 +1w>")[0];
    const exceptions = new Map<string, RecurrenceException>([
      [
        "2026-05-04",
        ex({
          override: {
            kind: "reschedule",
            date: "2026-05-06",
            startTime: "20:00",
            endTime: "22:00",
          },
        }),
      ],
    ]);
    const [occ] = expandOccurrences(ts, exceptions, may4, may10End);
    expect(occ.startTime).toBe("20:00");
    expect(occ.endTime).toBe("22:00");
  });

  it("drops a reschedule whose final date is outside the requested range", () => {
    const ts = parseTimestamps("<2026-05-04 ma. 17:00 +1w>")[0];
    const exceptions = new Map<string, RecurrenceException>([
      [
        "2026-05-04",
        ex({
          override: { kind: "reschedule", date: "2026-06-10", startTime: null, endTime: null },
        }),
      ],
    ]);
    expect(expandOccurrences(ts, exceptions, may4, may10End)).toHaveLength(0);
  });

  it("emits a reschedule that pulls a far-future occurrence into the page", () => {
    const ts = parseTimestamps("<2026-05-04 ma. 17:00 +1w>")[0];
    // Base 2026-07-20 (way outside the page) gets rescheduled into 2026-05-07.
    const exceptions = new Map<string, RecurrenceException>([
      [
        "2026-07-20",
        ex({
          override: { kind: "reschedule", date: "2026-05-07", startTime: null, endTime: null },
        }),
      ],
    ]);
    const occs = expandOccurrences(ts, exceptions, may4, may10End);
    // The base 2026-05-04 occurrence + the rescheduled one.
    expect(occs).toHaveLength(2);
    const moved = occs.find((o) => o.baseDate === "2026-07-20");
    expect(moved).toBeDefined();
    expect(moved!.date.getDate()).toBe(7);
  });

  it("renders a reschedule onto the same day as another base occurrence (no merge)", () => {
    const ts = parseTimestamps("<2026-05-04 ma. 17:00 +1w>")[0];
    const exceptions = new Map<string, RecurrenceException>([
      // 2026-05-04 reschedules to 2026-05-11 — already a base occurrence next week,
      // but our window is just may4..may10. Use 2026-05-11 base → 2026-05-04 collision.
    ]);
    // Reverse: move next week's 2026-05-11 onto 2026-05-04.
    const ex2 = new Map<string, RecurrenceException>([
      [
        "2026-05-11",
        ex({
          override: { kind: "reschedule", date: "2026-05-04", startTime: null, endTime: null },
        }),
      ],
    ]);
    const occs = expandOccurrences(ts, ex2, may4, may10End);
    // Base 2026-05-04 + rescheduled 2026-05-11 both land on 2026-05-04.
    const onMay4 = occs.filter((o) => o.date.getDate() === 4);
    expect(onMay4).toHaveLength(2);
    expect(occs).toHaveLength(2);
  });

  it("attaches a note to a base occurrence with no override", () => {
    const ts = parseTimestamps("<2026-05-04 ma. 17:00 +1w>")[0];
    const exceptions = new Map<string, RecurrenceException>([
      ["2026-05-04", ex({ note: "Bring water bottle" })],
    ]);
    const [occ] = expandOccurrences(ts, exceptions, may4, may10End);
    expect(occ.note).toBe("Bring water bottle");
    expect(occ.override).toBeNull();
  });

  it("emits override + note together on the shifted occurrence", () => {
    const ts = parseTimestamps("<2026-05-04 ma. 17:00 +1w>")[0];
    const exceptions = new Map<string, RecurrenceException>([
      [
        "2026-05-04",
        ex({
          override: { kind: "shift", offsetMinutes: 60 },
          note: "Longer session today",
        }),
      ],
    ]);
    const [occ] = expandOccurrences(ts, exceptions, may4, may10End);
    expect(occ.startTime).toBe("18:00");
    expect(occ.note).toBe("Longer session today");
    expect(occ.override).toEqual({ kind: "shift", offsetMinutes: 60 });
  });

  it("ignores exceptions on a non-repeating timestamp (parsed but inert)", () => {
    const ts = parseTimestamps("<2026-05-04 ma. 17:00>")[0];
    const exceptions = new Map<string, RecurrenceException>([
      ["2026-05-04", ex({ override: { kind: "cancelled" } })],
    ]);
    const occs = expandOccurrences(ts, exceptions, may4, may10End);
    // Non-recurring → exception map is inert, base occurrence is emitted as-is.
    expect(occs).toHaveLength(1);
    expect(occs[0].override).toBeNull();
  });

  it("collects multiple exceptions across a longer window", () => {
    const ts = parseTimestamps("<2026-05-04 ma. 17:00-18:00 +1w>")[0];
    const longEnd = new Date(2026, 4, 31, 23, 59, 59, 999);
    const exceptions = new Map<string, RecurrenceException>([
      ["2026-05-04", ex({ override: { kind: "cancelled" } })],
      ["2026-05-11", ex({ override: { kind: "shift", offsetMinutes: 45 } })],
      ["2026-05-18", ex({ note: "Husk matte" })],
    ]);
    const occs = expandOccurrences(ts, exceptions, may4, longEnd);
    // Bases: 04, 11, 18, 25. The cancelled one stays visible.
    expect(occs).toHaveLength(4);
    expect(occs.map((o) => o.baseDate)).toEqual([
      "2026-05-04",
      "2026-05-11",
      "2026-05-18",
      "2026-05-25",
    ]);
    expect(occs[0].override).toEqual({ kind: "cancelled" });
    expect(occs[1].startTime).toBe("17:45");
    expect(occs[2].note).toBe("Husk matte");
    expect(occs[3].override).toBeNull();
  });

  it("date-only timestamp: shift by days moves the day, not the time", () => {
    const ts = parseTimestamps("<2026-05-04 ma. +1w>")[0];
    const exceptions = new Map<string, RecurrenceException>([
      ["2026-05-04", ex({ override: { kind: "shift", offsetMinutes: 24 * 60 } })],
    ]);
    const [occ] = expandOccurrences(ts, exceptions, may4, may10End);
    expect(occ.date.getDate()).toBe(5);
    expect(occ.startTime).toBeNull();
    expect(occ.endTime).toBeNull();
  });
});

// ── seriesUntil (exclusive end date) ────────────────────────────────

describe("seriesUntil truncation", () => {
  // Base series: Mon 2026-05-04, 17:00-18:00, +1w → 04, 11, 18, 25, …
  const may1 = new Date(2026, 4, 1, 0, 0, 0);
  const may31 = new Date(2026, 4, 31, 23, 59, 59, 999);

  function emptyMap(): ReadonlyMap<string, import("../model.ts").RecurrenceException> {
    return new Map();
  }

  function formatLocalYMD(date: Date): string {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
  }

  it("expandRecurrences: occurrence exactly on seriesUntil is excluded", () => {
    const ts = parseTimestamps("<2026-05-04 ma. 17:00 +1w>")[0];
    // Without truncation: 04, 11, 18, 25 land in May.
    const untruncated = expandRecurrences(ts, may1, may31);
    expect(untruncated.map((d) => d.getDate())).toEqual([4, 11, 18, 25]);
    // seriesUntil = 2026-05-18 is exclusive → 18 and 25 dropped.
    const truncated = expandRecurrences(ts, may1, may31, "2026-05-18");
    expect(truncated.map((d) => d.getDate())).toEqual([4, 11]);
  });

  it("expandRecurrences: null seriesUntil is a no-op", () => {
    const ts = parseTimestamps("<2026-05-04 ma. 17:00 +1w>")[0];
    const a = expandRecurrences(ts, may1, may31);
    const b = expandRecurrences(ts, may1, may31, null);
    expect(a.map((d) => d.getTime())).toEqual(b.map((d) => d.getTime()));
  });

  it("expandRecurrences: non-repeating ignores seriesUntil (inert)", () => {
    // Base is inside the range but before seriesUntil — behaves as usual.
    const ts = parseTimestamps("<2026-05-04 ma. 17:00>")[0];
    expect(expandRecurrences(ts, may1, may31, "2026-05-01")).toHaveLength(1);
  });

  it("expandRecurrences: seriesUntil before base returns empty for repeating", () => {
    const ts = parseTimestamps("<2026-05-04 ma. 17:00 +1w>")[0];
    expect(expandRecurrences(ts, may1, may31, "2026-05-04")).toHaveLength(0);
  });

  it("expandOccurrences: threads seriesUntil to drop post-end occurrences", () => {
    const ts = parseTimestamps("<2026-05-04 ma. 17:00 +1w>")[0];
    const occs = expandOccurrences(ts, emptyMap(), may1, may31, "2026-05-18");
    expect(occs.map((o) => o.baseDate)).toEqual(["2026-05-04", "2026-05-11"]);
  });

  it("expandRecurrences: monthly repeaters respect the exclusive end date", () => {
    const ts = parseTimestamps("<2026-01-15 to. 17:00 +1m>")[0];
    const jan1 = new Date(2026, 0, 1, 0, 0, 0);
    const apr30 = new Date(2026, 3, 30, 23, 59, 59, 999);
    const truncated = expandRecurrences(ts, jan1, apr30, "2026-03-15");
    expect(truncated.map(formatLocalYMD)).toEqual([
      "2026-01-15",
      "2026-02-15",
    ]);
  });

  it("expandRecurrences: yearly repeaters respect the exclusive end date", () => {
    const ts = parseTimestamps("<2024-04-06 lø. 09:00 +1y>")[0];
    const jan1 = new Date(2024, 0, 1, 0, 0, 0);
    const dec31 = new Date(2027, 11, 31, 23, 59, 59, 999);
    const truncated = expandRecurrences(ts, jan1, dec31, "2026-04-06");
    expect(truncated.map(formatLocalYMD)).toEqual([
      "2024-04-06",
      "2025-04-06",
    ]);
  });

  it("expandOccurrences: reschedule keyed at/after seriesUntil is filtered", () => {
    const ts = parseTimestamps("<2026-05-04 ma. 17:00 +1w>")[0];
    // Base 2026-06-01 is past the end; its reschedule should NOT materialize
    // even though the target date (05-07) lands inside the range.
    const exceptions = new Map<string, import("../model.ts").RecurrenceException>([
      [
        "2026-06-01",
        {
          override: { kind: "reschedule", date: "2026-05-07", startTime: null, endTime: null },
          note: null,
        },
      ],
    ]);
    const occs = expandOccurrences(ts, exceptions, may1, may31, "2026-05-18");
    expect(occs.map((o) => o.baseDate)).toEqual(["2026-05-04", "2026-05-11"]);
  });

  it("expandOccurrences: reschedule keyed before seriesUntil still materializes", () => {
    const ts = parseTimestamps("<2026-05-04 ma. 17:00 +1w>")[0];
    // Base 2026-05-11 is inside the series; a reschedule moving it to 05-14 still applies.
    const exceptions = new Map<string, import("../model.ts").RecurrenceException>([
      [
        "2026-05-11",
        {
          override: { kind: "reschedule", date: "2026-05-14", startTime: null, endTime: null },
          note: null,
        },
      ],
    ]);
    const occs = expandOccurrences(ts, exceptions, may1, may31, "2026-05-18");
    // 04 base, 11 rescheduled to 14. 18 excluded.
    expect(occs.map((o) => o.baseDate).sort()).toEqual(["2026-05-04", "2026-05-11"]);
    const moved = occs.find((o) => o.baseDate === "2026-05-11");
    expect(moved!.date.getDate()).toBe(14);
  });

  it("expandOccurrences: base slots before seriesUntil can move after the end date", () => {
    const ts = parseTimestamps("<2026-05-04 ma. 17:00 +1w>")[0];
    const exceptions = new Map<string, import("../model.ts").RecurrenceException>([
      [
        "2026-05-11",
        {
          override: { kind: "reschedule", date: "2026-05-20", startTime: "18:30", endTime: null },
          note: null,
        },
      ],
    ]);
    const may18 = new Date(2026, 4, 18, 0, 0, 0);
    const may24 = new Date(2026, 4, 24, 23, 59, 59, 999);
    const occs = expandOccurrences(ts, exceptions, may18, may24, "2026-05-18");
    expect(occs).toHaveLength(1);
    expect(occs[0].baseDate).toBe("2026-05-11");
    expect(formatLocalYMD(occs[0].date)).toBe("2026-05-20");
    expect(occs[0].startTime).toBe("18:30");
  });
});
