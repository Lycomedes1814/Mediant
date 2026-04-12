import { describe, it, expect } from "vitest";
import {
  parseTimestamps,
  toDate,
  toEndDate,
  isDateOnly,
  isTimed,
  expandRecurrences,
} from "../timestamp.ts";

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
    expect(results[0].repeater).toEqual({ value: 1, unit: "w" });
  });

  it("parses a yearly repeater", () => {
    const results = parseTimestamps("<2026-04-06 ma. +1y>");
    expect(results).toHaveLength(1);
    expect(results[0].repeater).toEqual({ value: 1, unit: "y" });
    expect(results[0].startTime).toBeNull();
  });

  it("parses a daily repeater", () => {
    const results = parseTimestamps("<2026-04-06 ma. 09:00 +1d>");
    expect(results).toHaveLength(1);
    expect(results[0].repeater).toEqual({ value: 1, unit: "d" });
  });

  it("parses a monthly repeater", () => {
    const results = parseTimestamps("<2026-04-06 ma. +1m>");
    expect(results).toHaveLength(1);
    expect(results[0].repeater).toEqual({ value: 1, unit: "m" });
  });

  it("parses a multi-value repeater", () => {
    const results = parseTimestamps("<2026-04-06 ma. +2w>");
    expect(results).toHaveLength(1);
    expect(results[0].repeater).toEqual({ value: 2, unit: "w" });
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
    it("Jan 31 + 1m rolls to March 3 (JS Date behavior)", () => {
      // Jan 31 + 1 month → setMonth(1) on day 31 → March 3 (Feb has 28 days in 2026).
      // Then March 3 + 1 month → April 3 (not March 31).
      // So only one occurrence lands in March.
      const ts = parseTimestamps("<2026-01-31 lø. +1m>")[0];
      const marchStart = new Date(2026, 2, 1, 0, 0, 0);
      const marchEnd = new Date(2026, 2, 31, 23, 59, 59);
      const dates = expandRecurrences(ts, marchStart, marchEnd);
      expect(dates).toHaveLength(1);
      expect(dates[0].getDate()).toBe(3);
      expect(dates[0].getMonth()).toBe(2); // March
    });

    it("March 31 + 1m rolls to May 1 (April has 30 days)", () => {
      const ts = parseTimestamps("<2026-03-31 ti. +1m>")[0];
      const aprilStart = new Date(2026, 3, 1, 0, 0, 0);
      const aprilEnd = new Date(2026, 3, 30, 23, 59, 59);
      const dates = expandRecurrences(ts, aprilStart, aprilEnd);
      // March 31 + 1m → April 31 → rolls to May 1, outside April
      expect(dates).toHaveLength(0);
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
