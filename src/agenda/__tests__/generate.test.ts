import { describe, it, expect } from "vitest";
import { collectDeadlines, collectOverdueItems, collectSomedayItems, generateWeek } from "../generate.ts";
import { parseOrg } from "../../org/parser.ts";
import type { OrgEntry } from "../../org/model.ts";

// Helper: 7 days starting April 6, 2026 (Monday) through April 12 (Sunday)
const APRIL_6 = new Date(2026, 3, 6); // Monday

/** Build a minimal OrgEntry for testing. */
function entry(overrides: Partial<OrgEntry> & { title: string }): OrgEntry {
  return {
    level: 2,
    todo: null,
    priority: null,
    tags: [],
    planning: [],
    timestamps: [],
    body: "",
    checkboxItems: [],
    progress: null,
    sourceLineNumber: 1,
    exceptions: new Map(),
    seriesUntil: null,
    ...overrides,
  };
}

// ── 7-day structure ─────────────────────────────────────────────────

describe("7-day structure", () => {
  it("always returns 7 days", () => {
    const week = generateWeek([], APRIL_6);
    expect(week).toHaveLength(7);
  });

  it("starts on the given date", () => {
    const week = generateWeek([], APRIL_6);
    expect(week[0].date.getDate()).toBe(6);
    expect(week[0].date.getMonth()).toBe(3); // April
  });

  it("ends 6 days after the start", () => {
    const week = generateWeek([], APRIL_6);
    expect(week[6].date.getDate()).toBe(12);
  });

  it("starts on a Wednesday when given a Wednesday", () => {
    const wed = new Date(2026, 3, 8);
    const week = generateWeek([], wed);
    expect(week[0].date.getDate()).toBe(8);
    expect(week[6].date.getDate()).toBe(14);
  });

  it("empty entries produce empty days", () => {
    const week = generateWeek([], APRIL_6);
    for (const day of week) {
      expect(day.items).toHaveLength(0);
    }
  });
});

// ── Classification ───────────────────────────────────────────────────

describe("classification", () => {
  it("date-only active timestamp → all-day", () => {
    const entries = parseOrg("** Holiday :holiday:\n<2026-04-06 ma.>\n");
    const week = generateWeek(entries, APRIL_6);
    // April 6 = index 0
    expect(week[0].items).toHaveLength(1);
    expect(week[0].items[0].category).toBe("all-day");
  });

  it("timed active timestamp → timed", () => {
    const entries = parseOrg("** Class\n<2026-04-07 ti. 15:15-16:00>\n");
    const week = generateWeek(entries, APRIL_6);
    // April 7 = index 1
    expect(week[1].items).toHaveLength(1);
    expect(week[1].items[0].category).toBe("timed");
    expect(week[1].items[0].startTime).toBe("15:15");
    expect(week[1].items[0].endTime).toBe("16:00");
  });

  it("DEADLINE → deadline", () => {
    const entries = parseOrg("** TODO Task\nDEADLINE: <2026-04-09 to.>\n");
    const week = generateWeek(entries, APRIL_6);
    // April 9 = index 3
    expect(week[3].items).toHaveLength(1);
    expect(week[3].items[0].category).toBe("deadline");
  });

  it("SCHEDULED → scheduled", () => {
    const entries = parseOrg("** TODO Task\nSCHEDULED: <2026-04-10 fr.>\n");
    const week = generateWeek(entries, APRIL_6);
    // April 10 = index 4
    expect(week[4].items).toHaveLength(1);
    expect(week[4].items[0].category).toBe("scheduled");
  });

  it("SCHEDULED with time is still scheduled (not timed)", () => {
    const entries = parseOrg("** TODO Task\nSCHEDULED: <2026-04-10 fr. 12:00>\n");
    const week = generateWeek(entries, APRIL_6);
    expect(week[4].items[0].category).toBe("scheduled");
    expect(week[4].items[0].startTime).toBe("12:00");
  });
});

// ── Recurrence ───────────────────────────────────────────────────────

describe("recurrence", () => {
  it("weekly repeater lands on correct day", () => {
    // Base: Tuesday April 7, +1w → appears on April 7 (index 1)
    const entries = parseOrg("** Class\n<2026-04-07 ti. 13:15-14:00 +1w>\n");
    const week = generateWeek(entries, APRIL_6);
    expect(week[1].items).toHaveLength(1);
    expect(week[1].items[0].date.getDate()).toBe(7);
  });

  it("weekly repeater from earlier base date repeats into range", () => {
    // Base: March 3, +1w → lands on April 7 (Tuesday, index 1)
    const entries = parseOrg("** Class\n<2026-03-03 ti. 10:00 +1w>\n");
    const week = generateWeek(entries, APRIL_6);
    expect(week[1].items).toHaveLength(1);
    expect(week[1].items[0].date.getDate()).toBe(7);
  });

  it("yearly repeater appears when anniversary is in range", () => {
    // Birthday on April 9, base year 2025
    const entries = parseOrg("** Birthday\n<2025-04-09 on. +1y>\n");
    const week = generateWeek(entries, APRIL_6);
    // April 9 = index 3
    expect(week[3].items).toHaveLength(1);
    expect(week[3].items[0].category).toBe("all-day");
  });

  it("yearly repeater outside range produces no items", () => {
    const entries = parseOrg("** Birthday\n<2025-01-15 on. +1y>\n");
    const week = generateWeek(entries, APRIL_6);
    for (const day of week) {
      expect(day.items).toHaveLength(0);
    }
  });

  it("event outside range with no repeater produces no items", () => {
    const entries = parseOrg("** Event\n<2026-05-01 fr. 10:00>\n");
    const week = generateWeek(entries, APRIL_6);
    for (const day of week) {
      expect(day.items).toHaveLength(0);
    }
  });
});

// ── Per-occurrence exceptions ───────────────────────────────────────

describe("exceptions in agenda", () => {
  const APRIL_27 = new Date(2026, 3, 27); // Monday — start of test week

  it("cancelled occurrence stays in the agenda as skipped", () => {
    const entries = parseOrg(
      "** TODO Yoga :health:\n" +
        "SCHEDULED: <2026-04-27 ma. 17:00-18:00 +1w>\n" +
        ":PROPERTIES:\n" +
        ":EXCEPTION-2026-04-27: cancelled\n" +
        ":END:\n",
    );
    const week = generateWeek(entries, APRIL_27);
    expect(week[0].items).toHaveLength(1);
    expect(week[0].items[0].entry.title).toBe("Yoga");
    expect(week[0].items[0].startTime).toBe("17:00");
    expect(week[0].items[0].baseDate).toBe("2026-04-27");
    expect(week[0].items[0].skipped).toBe(true);
    expect(week[0].items[0].override).toEqual({
      kind: "cancelled",
      detail: "Skipped occurrence",
    });
    for (const day of week.slice(1)) expect(day.items).toHaveLength(0);
  });

  it("shifted occurrence keeps the entry's identity and records override metadata", () => {
    const entries = parseOrg(
      "** TODO Yoga :health:\n" +
        "SCHEDULED: <2026-04-27 ma. 17:00-18:00 +1w>\n" +
        ":PROPERTIES:\n" +
        ":EXCEPTION-2026-04-27: shift +45m\n" +
        ":END:\n",
    );
    const week = generateWeek(entries, APRIL_27);
    const items = week[0].items;
    expect(items).toHaveLength(1);
    expect(items[0].startTime).toBe("17:45");
    expect(items[0].endTime).toBe("18:45");
    expect(items[0].entry.title).toBe("Yoga");
    expect(items[0].entry.todo).toBe("TODO");
    expect(items[0].entry.tags).toEqual(["health"]);
    expect(items[0].baseDate).toBe("2026-04-27");
    expect(items[0].override).toEqual({ kind: "shift", detail: "+45m" });
  });

  it("rescheduled occurrence lands on the new day with original date and time detail", () => {
    const entries = parseOrg(
      "** TODO [#B] Yoga :health:\n" +
        "SCHEDULED: <2026-04-27 ma. 17:00-18:00 +1w>\n" +
        ":PROPERTIES:\n" +
        ":EXCEPTION-2026-04-27: reschedule 2026-04-29 18:00\n" +
        ":END:\n",
    );
    const week = generateWeek(entries, APRIL_27);
    expect(week[0].items).toHaveLength(0); // original Monday is empty
    const wed = week[2].items; // Wednesday Apr 29
    expect(wed).toHaveLength(1);
    expect(wed[0].startTime).toBe("18:00");
    expect(wed[0].endTime).toBe("19:00"); // base 60-min duration preserved
    expect(wed[0].entry.priority).toBe("B");
    expect(wed[0].entry.tags).toEqual(["health"]);
    expect(wed[0].baseDate).toBe("2026-04-27");
    expect(wed[0].override).toEqual({ kind: "reschedule", detail: "from 2026-04-27 17:00-18:00" });
  });

  it("same-day reschedule detail omits the repeated date and keeps the original time", () => {
    const entries = parseOrg(
      "** TODO Yoga\n" +
        "SCHEDULED: <2026-04-27 ma. 17:00-18:00 +1w>\n" +
        ":PROPERTIES:\n" +
        ":EXCEPTION-2026-04-27: reschedule 2026-04-27 18:30\n" +
        ":END:\n",
    );
    const week = generateWeek(entries, APRIL_27);
    const items = week[0].items;
    expect(items).toHaveLength(1);
    expect(items[0].startTime).toBe("18:30");
    expect(items[0].endTime).toBe("19:30");
    expect(items[0].override).toEqual({ kind: "reschedule", detail: "from 17:00-18:00" });
  });

  it("collision: a reschedule onto a day with a base occurrence renders both", () => {
    // Start a week earlier so both 2026-04-27 base and 2026-05-04-reschedule-to-04-27 are visible.
    const entries = parseOrg(
      "** Yoga\n" +
        "<2026-04-27 ma. 17:00 +1w>\n" +
        ":PROPERTIES:\n" +
        ":EXCEPTION-2026-05-04: reschedule 2026-04-27\n" +
        ":END:\n",
    );
    const week = generateWeek(entries, APRIL_27);
    const onMonday = week[0].items;
    expect(onMonday).toHaveLength(2);
    const baseDates = onMonday.map((i) => i.baseDate).sort();
    expect(baseDates).toEqual(["2026-04-27", "2026-05-04"]);
  });

  it("note attaches to the final occurrence", () => {
    const entries = parseOrg(
      "** Yoga\n" +
        "<2026-04-27 ma. 17:00 +1w>\n" +
        ":PROPERTIES:\n" +
        ":EXCEPTION-NOTE-2026-04-27: Bring water bottle\n" +
        ":END:\n",
    );
    const week = generateWeek(entries, APRIL_27);
    expect(week[0].items[0].instanceNote).toBe("Bring water bottle");
    expect(week[0].items[0].override).toBeNull();
  });

  it("shift across midnight lands on the next day's card", () => {
    const entries = parseOrg(
      "** Late session\n" +
        "<2026-04-27 ma. 23:30-00:30 +1w>\n" +
        ":PROPERTIES:\n" +
        ":EXCEPTION-2026-04-27: shift +45m\n" +
        ":END:\n",
    );
    const week = generateWeek(entries, APRIL_27);
    expect(week[0].items).toHaveLength(0); // Monday: shifted off
    expect(week[1].items).toHaveLength(1); // Tuesday: new home
    expect(week[1].items[0].startTime).toBe("00:15");
    expect(week[1].items[0].baseDate).toBe("2026-04-27");
  });

  it("one-off (non-recurring) timestamp: exceptions are inert", () => {
    const entries = parseOrg(
      "** Once\n" +
        "<2026-04-27 ma. 17:00>\n" +
        ":PROPERTIES:\n" +
        ":EXCEPTION-2026-04-27: cancelled\n" +
        ":END:\n",
    );
    const week = generateWeek(entries, APRIL_27);
    expect(week[0].items).toHaveLength(1);
    expect(week[0].items[0].startTime).toBe("17:00");
    expect(week[0].items[0].override).toBeNull();
    expect(week[0].items[0].baseDate).toBeNull(); // non-recurring → no base-slot identity
    expect(week[0].items[0].skipped).toBe(false);
  });

  it("shift detail formats hours and days cleanly", () => {
    const entries = parseOrg(
      "** Yoga\n" +
        "<2026-04-27 ma. 17:00 +1w>\n" +
        ":PROPERTIES:\n" +
        ":EXCEPTION-2026-04-27: shift +1h\n" +
        ":EXCEPTION-2026-05-04: shift +1d\n" +
        ":END:\n",
    );
    const week = generateWeek(entries, APRIL_27);
    expect(week[0].items[0].override).toEqual({ kind: "shift", detail: "+1h" });
    // Second base is May 4 — outside the 7-day window. Expand to 14 days.
    const week2 = generateWeek(entries, new Date(2026, 4, 4));
    // shift +1d pulls it to May 5 (index 1).
    expect(week2[1].items[0].override).toEqual({ kind: "shift", detail: "+1d" });
  });
});

// ── :SERIES-UNTIL: in agenda ────────────────────────────────────────

describe(":SERIES-UNTIL: truncation in agenda", () => {
  const APRIL_27 = new Date(2026, 3, 27); // Monday

  it("stops rendering occurrences at or after the exclusive end date", () => {
    // Base Mon Apr 27, +1w → Apr 27, May 4, May 11 would appear without truncation.
    // seriesUntil = 2026-05-04 (exclusive) → only Apr 27 shows.
    const entries = parseOrg(
      "** Yoga\n" +
        "<2026-04-27 ma. 17:00 +1w>\n" +
        ":PROPERTIES:\n" +
        ":SERIES-UNTIL: 2026-05-04\n" +
        ":END:\n",
    );
    const week1 = generateWeek(entries, APRIL_27);
    expect(week1[0].items).toHaveLength(1);
    expect(week1[0].items[0].startTime).toBe("17:00");
    // Next week: May 4 would be the base occurrence, but it sits at seriesUntil → excluded.
    const week2 = generateWeek(entries, new Date(2026, 4, 4));
    for (const day of week2) expect(day.items).toHaveLength(0);
  });

  it("filters reschedules keyed at/after seriesUntil", () => {
    // seriesUntil excludes May 4; a reschedule keyed at May 4 must not materialize,
    // even though its target (Apr 29) is inside the page.
    const entries = parseOrg(
      "** Yoga\n" +
        "<2026-04-27 ma. 17:00 +1w>\n" +
        ":PROPERTIES:\n" +
        ":SERIES-UNTIL: 2026-05-04\n" +
        ":EXCEPTION-2026-05-04: reschedule 2026-04-29 18:00\n" +
        ":END:\n",
    );
    const week = generateWeek(entries, APRIL_27);
    // Only the Apr 27 base should be present — the May 4 base is past seriesUntil.
    const items = week.flatMap((d) => d.items);
    expect(items).toHaveLength(1);
    expect(items[0].baseDate).toBe("2026-04-27");
  });

  it("inert on non-recurring entries", () => {
    const entries = parseOrg(
      "** Once\n" +
        "<2026-04-27 ma. 17:00>\n" +
        ":PROPERTIES:\n" +
        ":SERIES-UNTIL: 2026-04-20\n" +
        ":END:\n",
    );
    const week = generateWeek(entries, APRIL_27);
    expect(week[0].items).toHaveLength(1);
  });

  it("collectDeadlines skips past seriesUntil", () => {
    // Weekly DEADLINE that would otherwise fire on 2026-04-15 — seriesUntil cuts
    // it off before that, so no upcoming deadline is found.
    const entries = parseOrg(
      "** TODO Pay rent\n" +
        "DEADLINE: <2026-04-01 on. +1w>\n" +
        ":PROPERTIES:\n" +
        ":SERIES-UNTIL: 2026-04-08\n" +
        ":END:\n",
    );
    const items = collectDeadlines(entries, new Date(2026, 3, 10, 9, 0));
    expect(items).toHaveLength(0);
  });

  it("collectDeadlines ignores skipped recurring occurrences and finds the next one", () => {
    const entries = parseOrg(
      "** TODO Yoga\n" +
        "DEADLINE: <2026-04-27 ma. 17:00 +1w>\n" +
        ":PROPERTIES:\n" +
        ":EXCEPTION-2026-04-27: cancelled\n" +
        ":END:\n",
    );
    const items = collectDeadlines(entries, new Date(2026, 3, 27, 9, 0));
    expect(items).toHaveLength(1);
    expect(items[0].dueDate.getFullYear()).toBe(2026);
    expect(items[0].dueDate.getMonth()).toBe(4);
    expect(items[0].dueDate.getDate()).toBe(4);
  });

  it("collectOverdueItems ignores occurrences past seriesUntil", () => {
    // Weekly SCHEDULED would produce an overdue on 2026-04-08; seriesUntil cuts
    // the series after Apr 01, so only Apr 01 is a valid past occurrence.
    const entries = parseOrg(
      "** TODO Water plants\n" +
        "SCHEDULED: <2026-04-01 on. +1w>\n" +
        ":PROPERTIES:\n" +
        ":SERIES-UNTIL: 2026-04-08\n" +
        ":END:\n",
    );
    const items = collectOverdueItems(entries, new Date(2026, 3, 10, 12, 0));
    expect(items).toHaveLength(1);
    expect(items[0].dueDate.getDate()).toBe(1);
  });

  it("collectOverdueItems ignores skipped recurring occurrences and finds the latest real one", () => {
    const entries = parseOrg(
      "** TODO Yoga\n" +
        "SCHEDULED: <2026-04-20 ma. 17:00 +1w>\n" +
        ":PROPERTIES:\n" +
        ":EXCEPTION-2026-04-27: cancelled\n" +
        ":END:\n",
    );
    const items = collectOverdueItems(entries, new Date(2026, 4, 2, 12, 0));
    expect(items).toHaveLength(1);
    expect(items[0].dueDate.getFullYear()).toBe(2026);
    expect(items[0].dueDate.getMonth()).toBe(3);
    expect(items[0].dueDate.getDate()).toBe(20);
  });

  it("supports split-series handoff without overlapping base occurrences", () => {
    const entries = parseOrg(
      "** Yoga old\n" +
        "<2026-04-27 ma. 17:00 +1w>\n" +
        ":PROPERTIES:\n" +
        ":SERIES-UNTIL: 2026-05-18\n" +
        ":END:\n" +
        "** Yoga new\n" +
        "<2026-05-18 ma. 17:00 +1w>\n",
    );
    const week = generateWeek(entries, new Date(2026, 4, 18));
    const mondayItems = week[0].items;
    expect(mondayItems).toHaveLength(1);
    expect(mondayItems[0].entry.title).toBe("Yoga new");
    expect(mondayItems[0].baseDate).toBe("2026-05-18");
  });

  it("keeps moved old occurrences after the split while the successor series starts at seriesUntil", () => {
    const entries = parseOrg(
      "** Yoga old\n" +
        "<2026-04-27 ma. 17:00 +1w>\n" +
        ":PROPERTIES:\n" +
        ":SERIES-UNTIL: 2026-05-18\n" +
        ":EXCEPTION-2026-05-11: reschedule 2026-05-20 18:30\n" +
        ":END:\n" +
        "** Yoga new\n" +
        "<2026-05-18 ma. 17:00 +1w>\n",
    );
    const week = generateWeek(entries, new Date(2026, 4, 18));
    const items = week.flatMap((day) => day.items);
    expect(items).toHaveLength(2);
    expect(items.map((item) => item.entry.title)).toEqual(["Yoga new", "Yoga old"]);
    const moved = items.find((item) => item.entry.title === "Yoga old");
    expect(moved?.baseDate).toBe("2026-05-11");
    expect(moved?.startTime).toBe("18:30");
  });
});

// ── Sorting ──────────────────────────────────────────────────────────

describe("sorting", () => {
  it("all-day before deadline/scheduled before timed", () => {
    const org = [
      "** TODO Sched\nSCHEDULED: <2026-04-07 ti.>\n",
      "** TODO Dead\nDEADLINE: <2026-04-07 ti.>\n",
      "** Timed\n<2026-04-07 ti. 10:00>\n",
      "** AllDay\n<2026-04-07 ti.>\n",
    ].join("");
    const entries = parseOrg(org);
    const week = generateWeek(entries, APRIL_6);
    const categories = week[1].items.map((i) => i.category);
    expect(categories).toEqual(["all-day", "deadline", "scheduled", "timed"]);
  });

  it("timed deadlines interleave chronologically with timed events", () => {
    const org = [
      "** TODO Make the pie\nDEADLINE: <2026-04-07 ti. 19:00>\n",
      "** Unicorn gathering\n<2026-04-07 ti. 10:00>\n",
      "** Whale gathering\n<2026-04-07 ti. 13:00>\n",
      "** TODO Bake the pie\nSCHEDULED: <2026-04-07 ti. 15:30>\n",
    ].join("");
    const entries = parseOrg(org);
    const week = generateWeek(entries, APRIL_6);
    const order = week[1].items.map((i) => [i.startTime, i.entry.title]);
    expect(order).toEqual([
      ["10:00", "Unicorn gathering"],
      ["13:00", "Whale gathering"],
      ["15:30", "Bake the pie"],
      ["19:00", "Make the pie"],
    ]);
  });

  it("untimed deadline still sorts before timed events", () => {
    const org = [
      "** TODO Untimed deadline\nDEADLINE: <2026-04-07 ti.>\n",
      "** Timed event\n<2026-04-07 ti. 10:00>\n",
    ].join("");
    const entries = parseOrg(org);
    const week = generateWeek(entries, APRIL_6);
    const titles = week[1].items.map((i) => i.entry.title);
    expect(titles).toEqual(["Untimed deadline", "Timed event"]);
  });

  it("timed items sorted by start time", () => {
    const org = [
      "** Later\n<2026-04-07 ti. 18:30-20:00>\n",
      "** Earlier\n<2026-04-07 ti. 13:15-14:00>\n",
      "** Middle\n<2026-04-07 ti. 15:15-16:00>\n",
    ].join("");
    const entries = parseOrg(org);
    const week = generateWeek(entries, APRIL_6);
    const titles = week[1].items.map((i) => i.entry.title);
    expect(titles).toEqual(["Earlier", "Middle", "Later"]);
  });

  it("all-day items sorted alphabetically", () => {
    const org = [
      "** Zebra\n<2026-04-06 ma.>\n",
      "** Alpha\n<2026-04-06 ma.>\n",
      "** Middle\n<2026-04-06 ma.>\n",
    ].join("");
    const entries = parseOrg(org);
    const week = generateWeek(entries, APRIL_6);
    const titles = week[0].items.map((i) => i.entry.title);
    expect(titles).toEqual(["Alpha", "Middle", "Zebra"]);
  });
});

// ── Entry data preserved ─────────────────────────────────────────────

describe("entry data", () => {
  it("links back to full OrgEntry", () => {
    const entries = parseOrg(
      "** TODO Task :study:\nDEADLINE: <2026-04-09 to.>\n",
    );
    const week = generateWeek(entries, APRIL_6);
    const item = week[3].items[0];
    expect(item.entry.title).toBe("Task");
    expect(item.entry.todo).toBe("TODO");
    expect(item.entry.tags).toEqual(["study"]);
  });

  it("preserves sourceTimestamp for debugging", () => {
    const entries = parseOrg("** Event\n<2026-04-07 ti. 15:15-16:00 +1w>\n");
    const week = generateWeek(entries, APRIL_6);
    const item = week[1].items[0];
    expect(item.sourceTimestamp.raw).toBe("<2026-04-07 ti. 15:15-16:00 +1w>");
  });

  it("DONE entries are included", () => {
    const entries = parseOrg("** DONE Finished\n<2026-04-07 ti. 10:00>\n");
    const week = generateWeek(entries, APRIL_6);
    expect(week[1].items).toHaveLength(1);
    expect(week[1].items[0].entry.todo).toBe("DONE");
  });
});

// ── Entries with no date relevance ───────────────────────────────────

describe("entries without timestamps", () => {
  it("entry with no timestamps or planning produces no items", () => {
    const entries = parseOrg("** TODO Install Syncthing on VPS :tech:\n");
    const week = generateWeek([], APRIL_6);
    for (const day of week) {
      expect(day.items).toHaveLength(0);
    }
  });

  it("top-level headings (section headers) produce no items", () => {
    const entries = parseOrg("* Tasks\n* Events\n");
    const week = generateWeek(entries, APRIL_6);
    for (const day of week) {
      expect(day.items).toHaveLength(0);
    }
  });
});

// ── Full inbox.org integration ───────────────────────────────────────

describe("inbox.org 7 days starting April 6", () => {
  const INBOX = `#+title: Org Inbox
#+startup: show2levels

* Tasks
** TODO Finish project draft :study:
DEADLINE: <2026-05-05 ti.>
** TODO Review course notes :study:
DEADLINE: <2026-05-09 lø.>
** TODO Install Syncthing on VPS :tech:
** TODO Show HN: playlist-to-audiobook :tech:
** TODO Bring a charged laptop to the work session
SCHEDULED: <2026-04-14 ti. 12:00>
* Events
** Easter Sunday :holiday:
<2026-04-05 sø.>
** Easter Monday :holiday:
<2026-04-06 ma.>
** Dance class A :dance:
<2026-04-06 ma. 20:00-21:30 +1w>
** Study session :study:
<2026-04-07 ti. 15:15-16:00>
** Workshop :study:
<2026-04-07 ti. 13:15-14:00 +1w>
** Dance class B :dance:
<2026-04-05 sø. 18:00-21:00 +1w>
** Dance practice :dance:
<2026-04-08 on. 18:00-21:00 +1w>
** Group activity :dance:
<2026-04-05 sø. 14:30-16:00 +1w>
** Exercise class A :dance:
<2026-04-07 ti. 17:00-18:30 +1w>
** Exercise class B :dance:
<2026-04-07 ti. 18:30-20:00 +1w>
** Exercise class C :dance:
<2026-04-07 ti. 20:00-21:30 +1w>
** Annual reminder A :birthday:
<2026-04-06 ma. +1y>
** Annual reminder B :birthday:
<2026-04-09 to. +1y>
** Annual reminder C :birthday:
<2026-04-23 ti. +1y>
** Weekend workshop :dance:
<2026-04-11 Sat 12:00>
** Outdoor activity :outdoors:
<2026-04-12 Sun 14:00>
Meet at the main entrance.
`;

  const entries = parseOrg(INBOX);

  it("Monday April 6 (index 0): holiday + reminder + class", () => {
    const week = generateWeek(entries, APRIL_6);
    const mon = week[0];
    expect(mon.date.getDate()).toBe(6);

    const categories = mon.items.map((i) => i.category);
    const titles = mon.items.map((i) => i.entry.title);

    // All-day items first (Easter Monday, Annual reminder A), then timed (Dance class A)
    expect(categories).toEqual(["all-day", "all-day", "timed"]);
    expect(titles).toContain("Easter Monday");
    expect(titles).toContain("Annual reminder A");
    expect(titles).toContain("Dance class A");
  });

  it("Tuesday April 7 (index 1): dense dance/study schedule", () => {
    const week = generateWeek(entries, APRIL_6);
    const tue = week[1];

    const titles = tue.items.map((i) => i.entry.title);
    expect(titles).toContain("Workshop");
    expect(titles).toContain("Study session");
    expect(titles).toContain("Exercise class A");
    expect(titles).toContain("Exercise class B");
    expect(titles).toContain("Exercise class C");

    // Check time ordering
    const times = tue.items.map((i) => i.startTime);
    expect(times).toEqual(["13:15", "15:15", "17:00", "18:30", "20:00"]);
  });

  it("Wednesday April 8 (index 2): Dance practice", () => {
    const week = generateWeek(entries, APRIL_6);
    const wed = week[2];
    expect(wed.items).toHaveLength(1);
    expect(wed.items[0].entry.title).toBe("Dance practice");
    expect(wed.items[0].startTime).toBe("18:00");
  });

  it("Thursday April 9 (index 3): Annual reminder B", () => {
    const week = generateWeek(entries, APRIL_6);
    const thu = week[3];
    expect(thu.items).toHaveLength(1);
    expect(thu.items[0].entry.title).toBe("Annual reminder B");
    expect(thu.items[0].category).toBe("all-day");
  });

  it("Friday April 10 (index 4): empty", () => {
    const week = generateWeek(entries, APRIL_6);
    expect(week[4].items).toHaveLength(0);
  });

  it("Saturday April 11 (index 5): Weekend workshop", () => {
    const week = generateWeek(entries, APRIL_6);
    const sat = week[5];
    expect(sat.items).toHaveLength(1);
    expect(sat.items[0].entry.title).toBe("Weekend workshop");
    expect(sat.items[0].startTime).toBe("12:00");
  });

  it("Sunday April 12 (index 6): Group activity + class + outdoor activity", () => {
    const week = generateWeek(entries, APRIL_6);
    const sun = week[6];

    const titles = sun.items.map((i) => i.entry.title);
    expect(titles).toContain("Group activity");
    expect(titles).toContain("Dance class B");
    expect(titles).toContain("Outdoor activity");

    // Check time ordering
    const times = sun.items.map((i) => i.startTime);
    expect(times).toEqual(["14:00", "14:30", "18:00"]);
  });

  it("deadlines outside this range produce no items", () => {
    const week = generateWeek(entries, APRIL_6);
    const allItems = week.flatMap((d) => d.items);
    const deadlines = allItems.filter((i) => i.category === "deadline");
    expect(deadlines).toHaveLength(0);
  });

  it("Annual reminder C (April 23) not in this range", () => {
    const week = generateWeek(entries, APRIL_6);
    const allItems = week.flatMap((d) => d.items);
    expect(allItems.find((i) => i.entry.title === "Annual reminder C")).toBeUndefined();
  });

  it("Easter Sunday (April 5) not in this range", () => {
    const week = generateWeek(entries, APRIL_6);
    const allItems = week.flatMap((d) => d.items);
    expect(allItems.find((i) => i.entry.title === "Easter Sunday")).toBeUndefined();
  });
});

// ── Overdue items ───────────────────────────────────────────────────

describe("collectOverdueItems", () => {
  // Reference date: April 10, 2026
  const APRIL_10 = new Date(2026, 3, 10);

  it("returns TODO items past their deadline", () => {
    const entries = [
      entry({
        title: "Overdue task",
        todo: "TODO",
        planning: [{
          kind: "deadline",
          timestamp: { date: "2026-04-07", startTime: null, endTime: null, repeater: null, raw: "" },
        }],
      }),
    ];
    const items = collectOverdueItems(entries, APRIL_10);
    expect(items).toHaveLength(1);
    expect(items[0].daysOverdue).toBe(3);
    expect(items[0].kind).toBe("deadline");
  });

  it("returns TODO items past their scheduled date", () => {
    const entries = [
      entry({
        title: "Late scheduled",
        todo: "TODO",
        planning: [{
          kind: "scheduled",
          timestamp: { date: "2026-04-08", startTime: null, endTime: null, repeater: null, raw: "" },
        }],
      }),
    ];
    const items = collectOverdueItems(entries, APRIL_10);
    expect(items).toHaveLength(1);
    expect(items[0].daysOverdue).toBe(2);
    expect(items[0].kind).toBe("scheduled");
  });

  it("excludes DONE items", () => {
    const entries = [
      entry({
        title: "Done task",
        todo: "DONE",
        planning: [{
          kind: "deadline",
          timestamp: { date: "2026-04-05", startTime: null, endTime: null, repeater: null, raw: "" },
        }],
      }),
    ];
    const items = collectOverdueItems(entries, APRIL_10);
    expect(items).toHaveLength(0);
  });

  it("excludes items with no todo state", () => {
    const entries = [
      entry({
        title: "Plain heading",
        todo: null,
        planning: [{
          kind: "deadline",
          timestamp: { date: "2026-04-05", startTime: null, endTime: null, repeater: null, raw: "" },
        }],
      }),
    ];
    const items = collectOverdueItems(entries, APRIL_10);
    expect(items).toHaveLength(0);
  });

  it("excludes items due today or in the future", () => {
    const entries = [
      entry({
        title: "Due today",
        todo: "TODO",
        planning: [{
          kind: "deadline",
          timestamp: { date: "2026-04-10", startTime: null, endTime: null, repeater: null, raw: "" },
        }],
      }),
      entry({
        title: "Future",
        todo: "TODO",
        planning: [{
          kind: "deadline",
          timestamp: { date: "2026-04-15", startTime: null, endTime: null, repeater: null, raw: "" },
        }],
      }),
    ];
    const items = collectOverdueItems(entries, APRIL_10);
    expect(items).toHaveLength(0);
  });

  it("sorts most overdue first", () => {
    const entries = [
      entry({
        title: "2 days ago",
        todo: "TODO",
        planning: [{
          kind: "deadline",
          timestamp: { date: "2026-04-08", startTime: null, endTime: null, repeater: null, raw: "" },
        }],
      }),
      entry({
        title: "5 days ago",
        todo: "TODO",
        planning: [{
          kind: "scheduled",
          timestamp: { date: "2026-04-05", startTime: null, endTime: null, repeater: null, raw: "" },
        }],
      }),
    ];
    const items = collectOverdueItems(entries, APRIL_10);
    expect(items).toHaveLength(2);
    expect(items[0].entry.title).toBe("5 days ago");
    expect(items[1].entry.title).toBe("2 days ago");
  });

  it("includes both deadline and scheduled from the same entry", () => {
    const entries = [
      entry({
        title: "Both overdue",
        todo: "TODO",
        planning: [
          {
            kind: "scheduled",
            timestamp: { date: "2026-04-06", startTime: null, endTime: null, repeater: null, raw: "" },
          },
          {
            kind: "deadline",
            timestamp: { date: "2026-04-07", startTime: null, endTime: null, repeater: null, raw: "" },
          },
        ],
      }),
    ];
    const items = collectOverdueItems(entries, APRIL_10);
    expect(items).toHaveLength(2);
    expect(items[0].kind).toBe("scheduled"); // 4 days overdue
    expect(items[1].kind).toBe("deadline");  // 3 days overdue
  });

  it("treats a timed deadline later today as not overdue", () => {
    const entries = [
      entry({
        title: "Tonight",
        todo: "TODO",
        planning: [{
          kind: "deadline",
          timestamp: { date: "2026-04-10", startTime: "19:00", endTime: null, repeater: null, raw: "" },
        }],
      }),
    ];
    const items = collectOverdueItems(entries, new Date(2026, 3, 10, 9, 0));
    expect(items).toHaveLength(0);
  });

  it("treats a timed scheduled item from yesterday as overdue today", () => {
    const entries = [
      entry({
        title: "Late night",
        todo: "TODO",
        planning: [{
          kind: "scheduled",
          timestamp: { date: "2026-04-09", startTime: "23:00", endTime: null, repeater: null, raw: "" },
        }],
      }),
    ];
    const items = collectOverdueItems(entries, new Date(2026, 3, 10, 0, 5));
    expect(items).toHaveLength(1);
    expect(items[0].daysOverdue).toBe(1);
  });

  it("uses the latest past recurring occurrence", () => {
    const entries = parseOrg("** TODO Water plants\nSCHEDULED: <2026-04-01 on. +1w>\n");
    const items = collectOverdueItems(entries, new Date(2026, 3, 10, 12, 0));
    expect(items).toHaveLength(1);
    expect(items[0].dueDate.getFullYear()).toBe(2026);
    expect(items[0].dueDate.getMonth()).toBe(3);
    expect(items[0].dueDate.getDate()).toBe(8);
    expect(items[0].daysOverdue).toBe(2);
  });

  it("ignores cancelled recurring occurrences when finding overdue items", () => {
    const entries = parseOrg(
      "** TODO Water plants\n" +
      "SCHEDULED: <2026-04-01 on. +1w>\n" +
      ":PROPERTIES:\n" +
      ":EXCEPTION-2026-04-08: cancelled\n" +
      ":END:\n",
    );
    const items = collectOverdueItems(entries, new Date(2026, 3, 10, 12, 0));
    expect(items).toHaveLength(1);
    expect(items[0].dueDate.getDate()).toBe(1);
    expect(items[0].daysOverdue).toBe(9);
  });

  it("threads occurrence notes onto overdue items", () => {
    const entries = parseOrg(
      "** TODO Water plants\n" +
      "SCHEDULED: <2026-04-01 on. +1w>\n" +
      ":PROPERTIES:\n" +
      ":EXCEPTION-NOTE-2026-04-08: Check the balcony pots\n" +
      ":END:\n",
    );
    const items = collectOverdueItems(entries, new Date(2026, 3, 10, 12, 0));
    expect(items).toHaveLength(1);
    expect(items[0].baseDate).toBe("2026-04-08");
    expect(items[0].instanceNote).toBe("Check the balcony pots");
  });
});

// ── Upcoming deadlines ──────────────────────────────────────────────

describe("collectDeadlines", () => {
  it("returns a deadline due later today as today", () => {
    const entries = [
      entry({
        title: "Ship it",
        todo: "TODO",
        planning: [{
          kind: "deadline",
          timestamp: { date: "2026-04-10", startTime: "19:00", endTime: null, repeater: null, raw: "" },
        }],
      }),
    ];
    const items = collectDeadlines(entries, new Date(2026, 3, 10, 9, 0));
    expect(items).toHaveLength(1);
    expect(items[0].daysUntil).toBe(0);
  });

  it("excludes DONE deadlines", () => {
    const entries = parseOrg("** DONE Filed taxes\nDEADLINE: <2026-04-10 fr.>\n");
    const items = collectDeadlines(entries, new Date(2026, 3, 9, 9, 0));
    expect(items).toHaveLength(0);
  });

  it("uses the next upcoming recurring deadline occurrence", () => {
    const entries = parseOrg("** TODO Pay rent\nDEADLINE: <2026-04-01 on. +1w>\n");
    const items = collectDeadlines(entries, new Date(2026, 3, 10, 9, 0));
    expect(items).toHaveLength(1);
    expect(items[0].dueDate.getFullYear()).toBe(2026);
    expect(items[0].dueDate.getMonth()).toBe(3);
    expect(items[0].dueDate.getDate()).toBe(15);
    expect(items[0].daysUntil).toBe(5);
    expect(items[0].baseDate).toBe("2026-04-15");
  });

  it("skips cancelled recurring deadline occurrences and finds the next one", () => {
    const entries = parseOrg(
      "** TODO Pay rent\n" +
      "DEADLINE: <2026-04-01 on. +1w>\n" +
      ":PROPERTIES:\n" +
      ":EXCEPTION-2026-04-15: cancelled\n" +
      ":END:\n",
    );
    const items = collectDeadlines(entries, new Date(2026, 3, 10, 9, 0));
    expect(items).toHaveLength(1);
    expect(items[0].dueDate.getDate()).toBe(22);
    expect(items[0].daysUntil).toBe(12);
  });

  it("uses rescheduled recurring deadline dates", () => {
    const entries = parseOrg(
      "** TODO Pay rent\n" +
      "DEADLINE: <2026-04-01 on. +1w>\n" +
      ":PROPERTIES:\n" +
      ":EXCEPTION-2026-04-15: reschedule 2026-04-18 09:30\n" +
      ":END:\n",
    );
    const items = collectDeadlines(entries, new Date(2026, 3, 10, 9, 0));
    expect(items).toHaveLength(1);
    expect(items[0].dueDate.getDate()).toBe(18);
    expect(items[0].dueDate.getHours()).toBe(9);
    expect(items[0].dueDate.getMinutes()).toBe(30);
    expect(items[0].daysUntil).toBe(8);
    expect(items[0].baseDate).toBe("2026-04-15");
  });

  it("threads occurrence notes onto upcoming deadlines", () => {
    const entries = parseOrg(
      "** TODO Pay rent\n" +
      "DEADLINE: <2026-04-01 on. +1w>\n" +
      ":PROPERTIES:\n" +
      ":EXCEPTION-NOTE-2026-04-15: Confirm autopay\n" +
      ":END:\n",
    );
    const items = collectDeadlines(entries, new Date(2026, 3, 10, 9, 0));
    expect(items).toHaveLength(1);
    expect(items[0].baseDate).toBe("2026-04-15");
    expect(items[0].instanceNote).toBe("Confirm autopay");
  });
});

// ── Someday ────────────────────────────────────────────────────────

describe("collectSomedayItems", () => {
  it("preserves source order so quick captures stay in capture order", () => {
    const entries = parseOrg(
      "** TODO foo\n" +
      "** TODO bar\n" +
      "** TODO baz\n",
    );

    expect(collectSomedayItems(entries).map(item => item.entry.title)).toEqual([
      "foo",
      "bar",
      "baz",
    ]);
  });

  it("keeps DONE someday items after TODO items while preserving source order within each state", () => {
    const entries = parseOrg(
      "** DONE done first\n" +
      "** TODO todo first\n" +
      "** DONE done second\n" +
      "** TODO todo second\n",
    );

    expect(collectSomedayItems(entries).map(item => item.entry.title)).toEqual([
      "todo first",
      "todo second",
      "done first",
      "done second",
    ]);
  });
});
