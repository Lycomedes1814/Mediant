import { describe, it, expect } from "vitest";
import { parseOrg } from "../parser.ts";

// ── File-level behavior ──────────────────────────────────────────────

describe("file preamble", () => {
  it("ignores #+title and #+startup lines", () => {
    const entries = parseOrg("#+title: Org Inbox\n#+startup: show2levels\n");
    expect(entries).toHaveLength(0);
  });

  it("ignores blank lines before any heading", () => {
    const entries = parseOrg("\n\n\n** TODO Task\n");
    expect(entries).toHaveLength(1);
    expect(entries[0].title).toBe("Task");
  });
});

// ── Heading parsing ──────────────────────────────────────────────────

describe("headings", () => {
  it("parses heading level", () => {
    const entries = parseOrg("* Top\n** Second\n*** Third\n");
    expect(entries).toHaveLength(3);
    expect(entries[0].level).toBe(1);
    expect(entries[1].level).toBe(2);
    expect(entries[2].level).toBe(3);
  });

  it("records source line number (1-based)", () => {
    const entries = parseOrg("#+title: test\n\n** Entry\n");
    expect(entries).toHaveLength(1);
    expect(entries[0].sourceLineNumber).toBe(3);
  });
});

// ── TODO / DONE states ───────────────────────────────────────────────

describe("todo states", () => {
  it("parses TODO state", () => {
    const entries = parseOrg("** TODO Buy groceries\n");
    expect(entries[0].todo).toBe("TODO");
    expect(entries[0].title).toBe("Buy groceries");
  });

  it("parses DONE state", () => {
    const entries = parseOrg("** DONE Finished task\n");
    expect(entries[0].todo).toBe("DONE");
    expect(entries[0].title).toBe("Finished task");
  });

  it("treats unknown keywords as part of the title", () => {
    const entries = parseOrg("** WAITING Some task\n");
    expect(entries[0].todo).toBeNull();
    expect(entries[0].title).toBe("WAITING Some task");
  });

  it("heading with no state has null todo", () => {
    const entries = parseOrg("** Just a heading\n");
    expect(entries[0].todo).toBeNull();
  });
});

// ── Priority ─────────────────────────────────────────────────────────

describe("priority", () => {
  it("parses [#A] after TODO keyword and strips from title", () => {
    const entries = parseOrg("** TODO [#A] Urgent task\n");
    expect(entries[0].priority).toBe("A");
    expect(entries[0].title).toBe("Urgent task");
  });

  it("parses [#B] without TODO keyword", () => {
    const entries = parseOrg("** [#B] Plain heading\n");
    expect(entries[0].priority).toBe("B");
    expect(entries[0].title).toBe("Plain heading");
  });

  it("parses [#C] with DONE and tags", () => {
    const entries = parseOrg("** DONE [#C] Done task :work:\n");
    expect(entries[0].priority).toBe("C");
    expect(entries[0].todo).toBe("DONE");
    expect(entries[0].title).toBe("Done task");
    expect(entries[0].tags).toEqual(["work"]);
  });

  it("priority is null when no cookie present", () => {
    const entries = parseOrg("** TODO Task\n");
    expect(entries[0].priority).toBeNull();
  });

  it("ignores unknown priority letters", () => {
    const entries = parseOrg("** TODO [#D] Task\n");
    expect(entries[0].priority).toBeNull();
    expect(entries[0].title).toBe("[#D] Task");
  });
});

// ── Tags ─────────────────────────────────────────────────────────────

describe("tags", () => {
  it("parses a single tag", () => {
    const entries = parseOrg("** Heading :studie:\n");
    expect(entries[0].tags).toEqual(["studie"]);
    expect(entries[0].title).toBe("Heading");
  });

  it("parses multiple tags", () => {
    const entries = parseOrg("** Heading :dans:bursdag:\n");
    expect(entries[0].tags).toEqual(["dans", "bursdag"]);
  });

  it("heading with no tags has empty array", () => {
    const entries = parseOrg("** Plain heading\n");
    expect(entries[0].tags).toEqual([]);
  });

  it("tags are removed from title", () => {
    const entries = parseOrg("** Lindy Hop beginner :dans:\n");
    expect(entries[0].title).toBe("Lindy Hop beginner");
  });

  it("handles TODO + tags together", () => {
    const entries = parseOrg("** TODO Levér semesteroppgave :studie:\n");
    expect(entries[0].todo).toBe("TODO");
    expect(entries[0].title).toBe("Levér semesteroppgave");
    expect(entries[0].tags).toEqual(["studie"]);
  });
});

// ── Planning lines (SCHEDULED / DEADLINE) ────────────────────────────

describe("planning", () => {
  it("parses DEADLINE", () => {
    const entries = parseOrg(
      "** TODO Levér semesteroppgave i satstek :studie:\nDEADLINE: <2026-05-05 ti.>\n",
    );
    expect(entries[0].planning).toHaveLength(1);
    expect(entries[0].planning[0].kind).toBe("deadline");
    expect(entries[0].planning[0].timestamp.date).toBe("2026-05-05");
  });

  it("parses SCHEDULED with time", () => {
    const entries = parseOrg(
      "** TODO Task\nSCHEDULED: <2026-04-14 ti. 12:00>\n",
    );
    expect(entries[0].planning).toHaveLength(1);
    expect(entries[0].planning[0].kind).toBe("scheduled");
    expect(entries[0].planning[0].timestamp.startTime).toBe("12:00");
  });

  it("parses both SCHEDULED and DEADLINE on one entry", () => {
    const entries = parseOrg(
      "** TODO Task\nSCHEDULED: <2026-04-14 ti.>\nDEADLINE: <2026-05-05 ti.>\n",
    );
    expect(entries[0].planning).toHaveLength(2);
    expect(entries[0].planning[0].kind).toBe("scheduled");
    expect(entries[0].planning[1].kind).toBe("deadline");
  });

  it("planning not accepted after body text starts", () => {
    const entries = parseOrg(
      "** Heading\nSome body text\nSCHEDULED: <2026-04-14 ti.>\n",
    );
    expect(entries[0].planning).toHaveLength(0);
    // The SCHEDULED line becomes body text
    expect(entries[0].body).toContain("SCHEDULED:");
  });
});

// ── Active timestamps ────────────────────────────────────────────────

describe("active timestamps", () => {
  it("parses standalone timestamp line", () => {
    const entries = parseOrg("** Event\n<2026-04-07 ti. 15:15-16:00>\n");
    expect(entries[0].timestamps).toHaveLength(1);
    expect(entries[0].timestamps[0].date).toBe("2026-04-07");
    expect(entries[0].timestamps[0].startTime).toBe("15:15");
    expect(entries[0].timestamps[0].endTime).toBe("16:00");
  });

  it("parses date-only timestamp", () => {
    const entries = parseOrg("** Holiday\n<2026-04-05 sø.>\n");
    expect(entries[0].timestamps).toHaveLength(1);
    expect(entries[0].timestamps[0].startTime).toBeNull();
  });

  it("parses timestamp with repeater", () => {
    const entries = parseOrg("** Weekly\n<2026-04-07 ti. 13:15-14:00 +1w>\n");
    expect(entries[0].timestamps).toHaveLength(1);
    expect(entries[0].timestamps[0].repeater).toEqual({ value: 1, unit: "w" });
  });

  it("parses yearly repeater", () => {
    const entries = parseOrg("** Birthday\n<2026-04-06 ma. +1y>\n");
    expect(entries[0].timestamps[0].repeater).toEqual({ value: 1, unit: "y" });
  });

  it("timestamp with trailing whitespace", () => {
    const entries = parseOrg("** Event\n<2026-04-08 on. 18:00-21:00 +1w> \n");
    expect(entries[0].timestamps).toHaveLength(1);
  });

  it("handles Norwegian weekday names in timestamps", () => {
    for (const day of ["ma.", "ti.", "on.", "to.", "fr.", "lø.", "sø."]) {
      const entries = parseOrg(`** E\n<2026-04-07 ${day}>\n`);
      expect(entries[0].timestamps).toHaveLength(1);
    }
  });

  it("handles English weekday names in timestamps", () => {
    const entries = parseOrg("** E\n<2026-04-11 Sat 12:00>\n");
    expect(entries[0].timestamps).toHaveLength(1);
    expect(entries[0].timestamps[0].startTime).toBe("12:00");
  });

  it("does not pick up SCHEDULED/DEADLINE timestamps as active timestamps", () => {
    const entries = parseOrg(
      "** TODO Task\nDEADLINE: <2026-05-05 ti.>\n",
    );
    expect(entries[0].timestamps).toHaveLength(0);
    expect(entries[0].planning).toHaveLength(1);
  });

  it("mixed prose + timestamp line is treated as body text, not captured", () => {
    const entries = parseOrg(
      "** Event\nMeet at <2026-04-07 ti. 15:00> sharp.\n",
    );
    expect(entries[0].timestamps).toHaveLength(0);
    expect(entries[0].body).toBe("Meet at <2026-04-07 ti. 15:00> sharp.");
  });
});

// ── Skipped constructs ───────────────────────────────────────────────

describe("skipped constructs", () => {
  it("ignores #+ keyword lines inside an entry", () => {
    const entries = parseOrg("** Entry\n#+begin_src python\ncode\n#+end_src\n");
    expect(entries[0].body).toBe("code");
  });

  it("ignores comment lines inside an entry", () => {
    const entries = parseOrg("** Entry\n# This is a comment\nReal body.\n");
    expect(entries[0].body).toBe("Real body.");
  });

  it("planning line only uses first timestamp", () => {
    const entries = parseOrg(
      "** Task\nSCHEDULED: <2026-04-14 ti.> <2026-04-15 on.>\n",
    );
    expect(entries[0].planning).toHaveLength(1);
    expect(entries[0].planning[0].timestamp.date).toBe("2026-04-14");
  });
});

// ── Body text ────────────────────────────────────────────────────────

describe("body text", () => {
  it("preserves body text as notes", () => {
    const entries = parseOrg(
      "** Tur til månen :friluft:\n<2026-04-12 Sun 14:00>\nOppmøte Dragvoll.\n",
    );
    expect(entries[0].body).toBe("Oppmøte Dragvoll.");
  });

  it("multiline body text preserves newlines", () => {
    const entries = parseOrg(
      "** Event\nFirst line.\nSecond line.\n",
    );
    expect(entries[0].body).toBe("First line.\nSecond line.");
  });

  it("empty body is empty string", () => {
    const entries = parseOrg("** Just a heading\n");
    expect(entries[0].body).toBe("");
  });

  it("body does not include planning lines", () => {
    const entries = parseOrg(
      "** TODO Task\nDEADLINE: <2026-05-05 ti.>\nSome note.\n",
    );
    expect(entries[0].body).toBe("Some note.");
    expect(entries[0].planning).toHaveLength(1);
  });

  it("body does not include standalone timestamp lines", () => {
    const entries = parseOrg(
      "** Event\n<2026-04-07 ti. 15:15>\nDetails here.\n",
    );
    expect(entries[0].body).toBe("Details here.");
    expect(entries[0].timestamps).toHaveLength(1);
  });
});

// ── Drawers ──────────────────────────────────────────────────────────

describe("drawers", () => {
  it("skips property drawers", () => {
    const entries = parseOrg(
      "** Entry\n:PROPERTIES:\n:CATEGORY: work\n:END:\nBody text.\n",
    );
    expect(entries[0].body).toBe("Body text.");
  });

  it("skips logbook drawers", () => {
    const entries = parseOrg(
      "** Entry\n:LOGBOOK:\nCLOCK: [2026-04-07 ti.]\n:END:\nBody.\n",
    );
    expect(entries[0].body).toBe("Body.");
  });
});

// ── Multiple entries ─────────────────────────────────────────────────

describe("multiple entries", () => {
  it("parses consecutive headings", () => {
    const entries = parseOrg("* Tasks\n** TODO A\n** DONE B\n* Events\n** C\n");
    expect(entries).toHaveLength(5);
    expect(entries[0].title).toBe("Tasks");
    expect(entries[1].todo).toBe("TODO");
    expect(entries[2].todo).toBe("DONE");
    expect(entries[3].title).toBe("Events");
    expect(entries[4].title).toBe("C");
  });
});

// ── Full inbox.org integration test ──────────────────────────────────

describe("inbox.org integration", () => {
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

  it("parses correct number of entries", () => {
    const entries = parseOrg(INBOX);
    // 2 top-level headings (Tasks, Events) + 5 tasks + 16 events = 23
    expect(entries).toHaveLength(23);
  });

  it("parses first task correctly", () => {
    const entries = parseOrg(INBOX);
    const task = entries[1]; // ** TODO Levér semesteroppgave i satstek
    expect(task.level).toBe(2);
    expect(task.todo).toBe("TODO");
    expect(task.title).toBe("Levér semesteroppgave i satstek");
    expect(task.tags).toEqual(["studie"]);
    expect(task.planning).toHaveLength(1);
    expect(task.planning[0].kind).toBe("deadline");
    expect(task.planning[0].timestamp.date).toBe("2026-05-05");
    expect(task.timestamps).toHaveLength(0);
    expect(task.body).toBe("");
  });

  it("parses scheduled task correctly", () => {
    const entries = parseOrg(INBOX);
    const task = entries[5]; // ** TODO Ta med fulladet laptop
    expect(task.todo).toBe("TODO");
    expect(task.title).toBe("Ta med fulladet laptop på skriving");
    expect(task.tags).toEqual([]);
    expect(task.planning).toHaveLength(1);
    expect(task.planning[0].kind).toBe("scheduled");
    expect(task.planning[0].timestamp.startTime).toBe("12:00");
  });

  it("parses date-only event (holiday)", () => {
    const entries = parseOrg(INBOX);
    const event = entries[7]; // Første påskedag
    expect(event.title).toBe("Første påskedag");
    expect(event.tags).toEqual(["helligdag"]);
    expect(event.timestamps).toHaveLength(1);
    expect(event.timestamps[0].date).toBe("2026-04-05");
    expect(event.timestamps[0].startTime).toBeNull();
    expect(event.timestamps[0].repeater).toBeNull();
  });

  it("parses timed event with repeater", () => {
    const entries = parseOrg(INBOX);
    const event = entries[9]; // Boogie Woogie beginner
    expect(event.title).toBe("Boogie Woogie beginner");
    expect(event.tags).toEqual(["dans"]);
    expect(event.timestamps[0].startTime).toBe("20:00");
    expect(event.timestamps[0].endTime).toBe("21:30");
    expect(event.timestamps[0].repeater).toEqual({ value: 1, unit: "w" });
  });

  it("parses yearly repeater (birthday)", () => {
    const entries = parseOrg(INBOX);
    const event = entries[18]; // Mamma har bursdag
    expect(event.title).toBe("Mamma har bursdag");
    expect(event.tags).toEqual(["bursdag"]);
    expect(event.timestamps[0].repeater).toEqual({ value: 1, unit: "y" });
  });

  it("preserves body text on Tur til månen", () => {
    const entries = parseOrg(INBOX);
    const event = entries[22]; // Tur til månen
    expect(event.title).toBe("Tur til månen");
    expect(event.tags).toEqual(["friluft"]);
    expect(event.body).toBe("Oppmøte Dragvoll.");
    expect(event.timestamps).toHaveLength(1);
    expect(event.timestamps[0].startTime).toBe("14:00");
  });

  it("parses task with no planning or timestamps", () => {
    const entries = parseOrg(INBOX);
    const task = entries[3]; // Install Syncthing on VPS
    expect(task.todo).toBe("TODO");
    expect(task.title).toBe("Install Syncthing on VPS");
    expect(task.tags).toEqual(["tech"]);
    expect(task.planning).toHaveLength(0);
    expect(task.timestamps).toHaveLength(0);
  });

  it("handles Norwegian ø in event names", () => {
    const entries = parseOrg(INBOX);
    const event = entries.find((e) => e.title === "Folkeswing øvet");
    expect(event).toBeDefined();
    expect(event!.tags).toEqual(["dans"]);
  });
});
