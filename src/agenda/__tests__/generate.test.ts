import { describe, it, expect } from "vitest";
import { generateWeek, collectOverdueItems } from "../generate.ts";
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
    const entries = parseOrg("** Holiday :helligdag:\n<2026-04-06 ma.>\n");
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
      "** TODO Task :studie:\nDEADLINE: <2026-04-09 to.>\n",
    );
    const week = generateWeek(entries, APRIL_6);
    const item = week[3].items[0];
    expect(item.entry.title).toBe("Task");
    expect(item.entry.todo).toBe("TODO");
    expect(item.entry.tags).toEqual(["studie"]);
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
** TODO Levér semesteroppgave i satstek :studie:
DEADLINE: <2026-05-05 ti.>
** TODO Levér semesteroppgave i arrkomp :studie:
DEADLINE: <2026-05-09 lø.>
** TODO Install Syncthing on VPS :tech:
** TODO Show HN: playlist-to-audiobook :tech:
** TODO Ta med fulladet laptop på skriving
SCHEDULED: <2026-04-14 ti. 12:00>
* Events
** Første påskedag :helligdag:
<2026-04-05 sø.>
** Andre påskedag :helligdag:
<2026-04-06 ma.>
** Boogie Woogie beginner :dans:
<2026-04-06 ma. 20:00-21:30 +1w>
** Analyse :studie:
<2026-04-07 ti. 15:15-16:00>
** Satstek skriving :studie:
<2026-04-07 ti. 13:15-14:00 +1w>
** Folkeswing videregående :dans:
<2026-04-05 sø. 18:00-21:00 +1w>
** Folkeswing øvet :dans:
<2026-04-08 on. 18:00-21:00 +1w>
** Folkedans :dans:
<2026-04-05 sø. 14:30-16:00 +1w>
** Lindy Hop beginner :dans:
<2026-04-07 ti. 17:00-18:30 +1w>
** Lindy Hop intermediate :dans:
<2026-04-07 ti. 18:30-20:00 +1w>
** Balboa beginner :dans:
<2026-04-07 ti. 20:00-21:30 +1w>
** Mamma har bursdag :bursdag:
<2026-04-06 ma. +1y>
** Pappa har bursdag :bursdag:
<2026-04-09 to. +1y>
** Jeg har bursdag :bursdag:
<2026-04-23 ti. +1y>
** Helgekurs for videregående :dans:
<2026-04-11 Sat 12:00>
** Tur til månen :friluft:
<2026-04-12 Sun 14:00>
Oppmøte Dragvoll.
`;

  const entries = parseOrg(INBOX);

  it("Monday April 6 (index 0): holiday + birthday + dance", () => {
    const week = generateWeek(entries, APRIL_6);
    const mon = week[0];
    expect(mon.date.getDate()).toBe(6);

    const categories = mon.items.map((i) => i.category);
    const titles = mon.items.map((i) => i.entry.title);

    // All-day items first (Andre påskedag, Mamma har bursdag), then timed (Boogie Woogie)
    expect(categories).toEqual(["all-day", "all-day", "timed"]);
    expect(titles).toContain("Andre påskedag");
    expect(titles).toContain("Mamma har bursdag");
    expect(titles).toContain("Boogie Woogie beginner");
  });

  it("Tuesday April 7 (index 1): dense dance/study schedule", () => {
    const week = generateWeek(entries, APRIL_6);
    const tue = week[1];

    const titles = tue.items.map((i) => i.entry.title);
    expect(titles).toContain("Satstek skriving");
    expect(titles).toContain("Analyse");
    expect(titles).toContain("Lindy Hop beginner");
    expect(titles).toContain("Lindy Hop intermediate");
    expect(titles).toContain("Balboa beginner");

    // Check time ordering
    const times = tue.items.map((i) => i.startTime);
    expect(times).toEqual(["13:15", "15:15", "17:00", "18:30", "20:00"]);
  });

  it("Wednesday April 8 (index 2): Folkeswing øvet", () => {
    const week = generateWeek(entries, APRIL_6);
    const wed = week[2];
    expect(wed.items).toHaveLength(1);
    expect(wed.items[0].entry.title).toBe("Folkeswing øvet");
    expect(wed.items[0].startTime).toBe("18:00");
  });

  it("Thursday April 9 (index 3): Pappa har bursdag", () => {
    const week = generateWeek(entries, APRIL_6);
    const thu = week[3];
    expect(thu.items).toHaveLength(1);
    expect(thu.items[0].entry.title).toBe("Pappa har bursdag");
    expect(thu.items[0].category).toBe("all-day");
  });

  it("Friday April 10 (index 4): empty", () => {
    const week = generateWeek(entries, APRIL_6);
    expect(week[4].items).toHaveLength(0);
  });

  it("Saturday April 11 (index 5): Helgekurs", () => {
    const week = generateWeek(entries, APRIL_6);
    const sat = week[5];
    expect(sat.items).toHaveLength(1);
    expect(sat.items[0].entry.title).toBe("Helgekurs for videregående");
    expect(sat.items[0].startTime).toBe("12:00");
  });

  it("Sunday April 12 (index 6): Folkedans + Folkeswing + Tur til månen", () => {
    const week = generateWeek(entries, APRIL_6);
    const sun = week[6];

    const titles = sun.items.map((i) => i.entry.title);
    expect(titles).toContain("Folkedans");
    expect(titles).toContain("Folkeswing videregående");
    expect(titles).toContain("Tur til månen");

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

  it("Jeg har bursdag (April 23) not in this range", () => {
    const week = generateWeek(entries, APRIL_6);
    const allItems = week.flatMap((d) => d.items);
    expect(allItems.find((i) => i.entry.title === "Jeg har bursdag")).toBeUndefined();
  });

  it("Første påskedag (April 5) not in this range", () => {
    const week = generateWeek(entries, APRIL_6);
    const allItems = week.flatMap((d) => d.items);
    expect(allItems.find((i) => i.entry.title === "Første påskedag")).toBeUndefined();
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
});
