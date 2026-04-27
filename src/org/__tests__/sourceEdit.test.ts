import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  appendAgendaItemToSource,
  appendOrgTextToSource,
  appendOrgTextUnderHeading,
  appendQuickCaptureToTasks,
  deleteOrgBlockInSource,
  replaceOrgBlockInSource,
  toggleCheckboxInSource,
  toggleDoneInSource,
} from "../sourceEdit.ts";
import { parseOrg } from "../parser.ts";

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(2026, 3, 22, 10, 0, 0));
});

describe("replaceOrgBlockInSource", () => {
  it("replaces planning fields while preserving body text", () => {
    const source =
      "** TODO Task\n" +
      "SCHEDULED: <2026-04-07 ti.>\n" +
      "Body line.\n";

    const updated = replaceOrgBlockInSource(
      source,
      1,
      "** TODO Task renamed\nDEADLINE: <2026-04-09 to.>\n",
    );

    expect(updated).toBe(
      "** TODO Task renamed\n" +
      "DEADLINE: <2026-04-09 to.>\n" +
      "\n" +
      "Body line.\n",
    );
  });

  it("drops old checkbox lines because the editor re-emits the full checklist", () => {
    const source =
      "** TODO Task\n" +
      "- [ ] First\n" +
      "- [X] Second\n" +
      "Notes stay.\n";

    const updated = replaceOrgBlockInSource(
      source,
      1,
      "** TODO Task\n- [X] Replacement\n",
    );

    expect(updated).toBe(
      "** TODO Task\n" +
      "- [X] Replacement\n" +
      "\n" +
      "Notes stay.\n",
    );
  });

  it("preserves additional bare timestamps when replacing the first event timestamp", () => {
    const source =
      "** Event\n" +
      "<2026-04-07 ti. 10:00>\n" +
      "<2026-04-08 on. 11:00>\n" +
      "Body.\n";

    const updated = replaceOrgBlockInSource(
      source,
      1,
      "** Event updated\n<2026-04-07 ti. 12:00>\n",
    );

    expect(updated).toBe(
      "** Event updated\n" +
      "<2026-04-07 ti. 12:00>\n" +
      "\n" +
      "<2026-04-08 on. 11:00>\n" +
      "Body.\n",
    );
  });

  it("removes prior planning lines when the new block contains a planning line", () => {
    const source =
      "** TODO Task\n" +
      "DEADLINE: <2026-04-10 fr.>\n" +
      "SCHEDULED: <2026-04-07 ti.>\n" +
      "Body.\n";

    const updated = replaceOrgBlockInSource(
      source,
      1,
      "** TODO Task\nSCHEDULED: <2026-04-11 lø.>\n",
    );

    expect(updated).toBe(
      "** TODO Task\n" +
      "SCHEDULED: <2026-04-11 lø.>\n" +
      "\n" +
      "Body.\n",
    );
  });

  it("removes old bare event timestamps when converting an event to an unscheduled TODO", () => {
    const source =
      "** Event\n" +
      "<2026-04-07 ti. 10:00>\n" +
      "Body.\n";

    const updated = replaceOrgBlockInSource(
      source,
      1,
      "** TODO Event\n",
    );

    expect(updated).toBe(
      "** TODO Event\n" +
      "\n" +
      "Body.\n",
    );
  });

  it("removes old planning lines when converting a scheduled TODO to an event", () => {
    const source =
      "** TODO Task\n" +
      "SCHEDULED: <2026-04-07 ti.>\n" +
      "Body.\n";

    const updated = replaceOrgBlockInSource(
      source,
      1,
      "** Task\n<2026-04-08 on. 11:00>\n",
    );

    expect(updated).toBe(
      "** Task\n" +
      "<2026-04-08 on. 11:00>\n" +
      "\n" +
      "Body.\n",
    );
  });

  it("is a no-op when the source line is out of range", () => {
    const source = "** TODO Task\n";
    expect(replaceOrgBlockInSource(source, 5, "** TODO Other\n")).toBe(source);
  });
});

describe("toggleDoneInSource", () => {
  it("flips TODO to DONE without touching the rest of the block for non-repeating items", () => {
    const source =
      "** TODO Task :work:\n" +
      "SCHEDULED: <2026-04-07 ti.>\n" +
      "Body.\n";

    expect(toggleDoneInSource(source, 1)).toBe(
      "** DONE Task :work:\n" +
      "SCHEDULED: <2026-04-07 ti.>\n" +
      "Body.\n",
    );
  });

  it("advances + repeaters by exactly one interval and keeps TODO", () => {
    const source =
      "** TODO Rent\n" +
      "DEADLINE: <2026-04-01 Wed +1m>\n";

    expect(toggleDoneInSource(source, 1)).toBe(
      "** TODO Rent\n" +
      "DEADLINE: <2026-05-01 Fri +1m>\n",
    );
  });

  it("advances ++ repeaters until they land in the future", () => {
    const source =
      "** TODO Call Father\n" +
      "DEADLINE: <2026-04-01 Wed ++1w>\n";

    expect(toggleDoneInSource(source, 1)).toBe(
      "** TODO Call Father\n" +
      "DEADLINE: <2026-04-29 Wed ++1w>\n",
    );
  });

  it("advances ++ yearly repeaters until they land in the future", () => {
    const source =
      "** TODO Tax\n" +
      "DEADLINE: <2024-04-01 Mon ++1y>\n";

    expect(toggleDoneInSource(source, 1)).toBe(
      "** TODO Tax\n" +
      "DEADLINE: <2027-04-01 Thu ++1y>\n",
    );
  });

  it("advances .+ repeaters from today", () => {
    const source =
      "** TODO Batteries\n" +
      "DEADLINE: <2026-04-01 Wed .+1m>\n";

    expect(toggleDoneInSource(source, 1)).toBe(
      "** TODO Batteries\n" +
      "DEADLINE: <2026-05-22 Fri .+1m>\n",
    );
  });

  it("advances .+ yearly repeaters from today", () => {
    const source =
      "** TODO Passport\n" +
      "DEADLINE: <2024-04-01 Mon .+1y>\n";

    expect(toggleDoneInSource(source, 1)).toBe(
      "** TODO Passport\n" +
      "DEADLINE: <2027-04-22 Thu .+1y>\n",
    );
  });

  it("uses the current time for timed ++ repeaters", () => {
    const source =
      "** TODO Trash\n" +
      "DEADLINE: <2026-04-08 Wed 20:00 ++1d>\n";

    expect(toggleDoneInSource(source, 1)).toBe(
      "** TODO Trash\n" +
      "DEADLINE: <2026-04-22 Wed 20:00 ++1d>\n",
    );
  });

  it("does nothing for headings without TODO/DONE", () => {
    const source = "** Plain heading\n";
    expect(toggleDoneInSource(source, 1)).toBe(source);
  });
});

describe("toggleCheckboxInSource", () => {
  it("flips an unchecked box to X and updates the [N/M] cookie", () => {
    const source =
      "** TODO Buy stuff [1/3]\n" +
      "- [X] Milk\n" +
      "- [ ] Bread\n" +
      "- [ ] Eggs\n";

    expect(toggleCheckboxInSource(source, 1, 1)).toBe(
      "** TODO Buy stuff [2/3]\n" +
      "- [X] Milk\n" +
      "- [X] Bread\n" +
      "- [ ] Eggs\n",
    );
  });

  it("flips a checked box back to unchecked and updates the cookie", () => {
    const source =
      "** TODO Buy stuff [2/3]\n" +
      "- [X] Milk\n" +
      "- [X] Bread\n" +
      "- [ ] Eggs\n";

    expect(toggleCheckboxInSource(source, 1, 0)).toBe(
      "** TODO Buy stuff [1/3]\n" +
      "- [ ] Milk\n" +
      "- [X] Bread\n" +
      "- [ ] Eggs\n",
    );
  });

  it("updates a [%] cookie", () => {
    const source =
      "** TODO Buy stuff [33%]\n" +
      "- [X] Milk\n" +
      "- [ ] Bread\n" +
      "- [ ] Eggs\n";

    expect(toggleCheckboxInSource(source, 1, 1)).toBe(
      "** TODO Buy stuff [67%]\n" +
      "- [X] Milk\n" +
      "- [X] Bread\n" +
      "- [ ] Eggs\n",
    );
  });

  it("leaves the heading unchanged when there is no progress cookie", () => {
    const source =
      "** TODO Buy stuff\n" +
      "- [ ] Milk\n";

    expect(toggleCheckboxInSource(source, 1, 0)).toBe(
      "** TODO Buy stuff\n" +
      "- [X] Milk\n",
    );
  });

  it("only edits the target entry's block, not subsequent entries' checkboxes", () => {
    const source =
      "** TODO First [0/1]\n" +
      "- [ ] A\n" +
      "** TODO Second [0/1]\n" +
      "- [ ] B\n";

    expect(toggleCheckboxInSource(source, 1, 0)).toBe(
      "** TODO First [1/1]\n" +
      "- [X] A\n" +
      "** TODO Second [0/1]\n" +
      "- [ ] B\n",
    );
  });

  it("supports indented checkbox items", () => {
    const source =
      "** TODO Outer [0/1]\n" +
      "  - [ ] Indented\n";

    expect(toggleCheckboxInSource(source, 1, 0)).toBe(
      "** TODO Outer [1/1]\n" +
      "  - [X] Indented\n",
    );
  });

  it("is a no-op when the index is out of range", () => {
    const source =
      "** TODO Buy stuff [0/1]\n" +
      "- [ ] Milk\n";

    expect(toggleCheckboxInSource(source, 1, 5)).toBe(source);
  });

  it("is a no-op when the parent line is not a heading", () => {
    const source =
      "** TODO Task\n" +
      "- [ ] Item\n";

    expect(toggleCheckboxInSource(source, 2, 0)).toBe(source);
  });
});

describe("deleteOrgBlockInSource", () => {
  it("removes an entry block and keeps neighboring entries intact", () => {
    const source =
      "** One\n" +
      "Body1.\n" +
      "** Two\n" +
      "Body2.\n" +
      "** Three\n" +
      "Body3.\n";

    expect(deleteOrgBlockInSource(source, 3)).toBe(
      "** One\n" +
      "Body1.\n" +
      "** Three\n" +
      "Body3.\n",
    );
  });

  it("collapses the blank separator left behind by deletion", () => {
    const source =
      "** One\n" +
      "Body1.\n" +
      "\n" +
      "** Two\n" +
      "Body2.\n";

    expect(deleteOrgBlockInSource(source, 4)).toBe(
      "** One\n" +
      "Body1.",
    );
  });
});

describe("appendOrgTextToSource", () => {
  it("appends a block with a single separating newline", () => {
    const source = "** Existing\n";
    expect(appendOrgTextToSource(source, "** New\nBody.")).toBe(
      "** Existing\n** New\nBody.\n",
    );
  });

  it("trims trailing blank lines before appending", () => {
    const source = "** Existing\n\n";
    expect(appendOrgTextToSource(source, "** New")).toBe(
      "** Existing\n** New\n",
    );
  });
});

describe("appendOrgTextUnderHeading", () => {
  it("creates a top-level Tasks heading and appends TODOs as child entries", () => {
    expect(appendOrgTextUnderHeading("", "Tasks", "* TODO New task")).toBe(
      "* Tasks\n" +
      "** TODO New task\n",
    );
  });

  it("creates a top-level Events heading and appends events as child entries", () => {
    expect(appendOrgTextUnderHeading("* Tasks\n** TODO Existing\n", "Events", "* Meeting\n<2026-04-24 Fri 10:00>")).toBe(
      "* Tasks\n" +
      "** TODO Existing\n" +
      "* Events\n" +
      "** Meeting\n" +
      "<2026-04-24 Fri 10:00>\n",
    );
  });

  it("appends before the next top-level heading", () => {
    const source =
      "* Tasks\n" +
      "** TODO Existing\n" +
      "\n" +
      "* Events\n" +
      "** Meeting\n";

    expect(appendOrgTextUnderHeading(source, "Tasks", "* TODO Later")).toBe(
      "* Tasks\n" +
      "** TODO Existing\n" +
      "** TODO Later\n" +
      "* Events\n" +
      "** Meeting\n",
    );
  });
});

describe("appendAgendaItemToSource", () => {
  it("routes TODO entries to Tasks", () => {
    expect(appendAgendaItemToSource("", "* TODO Follow up")).toBe(
      "* Tasks\n" +
      "** TODO Follow up\n",
    );
  });

  it("routes event entries to Events", () => {
    expect(appendAgendaItemToSource("", "* Meeting\n<2026-04-24 Fri 10:00>")).toBe(
      "* Events\n" +
      "** Meeting\n" +
      "<2026-04-24 Fri 10:00>\n",
    );
  });
});

describe("appendQuickCaptureToTasks", () => {
  it("creates a Tasks heading at the end of an empty source", () => {
    expect(appendQuickCaptureToTasks("", "Buy milk")).toBe(
      "* Tasks\n" +
      "** TODO Buy milk\n",
    );
  });

  it("appends to an existing Tasks subtree", () => {
    const source =
      "* Tasks\n" +
      "** TODO Existing\n";

    expect(appendQuickCaptureToTasks(source, "Call Ada")).toBe(
      "* Tasks\n" +
      "** TODO Existing\n" +
      "** TODO Call Ada\n",
    );
  });

  it("preserves following top-level headings", () => {
    const source =
      "* Tasks\n" +
      "** TODO Existing\n" +
      "\n" +
      "* Projects\n" +
      "** TODO Planned\n";

    expect(appendQuickCaptureToTasks(source, "Quick task")).toBe(
      "* Tasks\n" +
      "** TODO Existing\n" +
      "** TODO Quick task\n" +
      "* Projects\n" +
      "** TODO Planned\n",
    );
  });

  it("normalizes multiline heading text into a single safe heading", () => {
    expect(appendQuickCaptureToTasks("* Tasks\n", "  First\n** Injected\r\n  Second  ")).toBe(
      "* Tasks\n" +
      "** TODO First ** Injected Second\n",
    );
  });

  it("keeps captured Org-looking syntax as plain someday task text", () => {
    const updated = appendQuickCaptureToTasks(
      "",
      "[#A] Ship <2026-04-20 Mon> [1/2] :work:",
    );

    expect(updated).toBe(
      "* Tasks\n" +
      "** TODO #A Ship (2026-04-20 Mon) (1/2) ;work;\n",
    );

    const task = parseOrg(updated).find(entry => entry.todo === "TODO");
    expect(task?.title).toBe("#A Ship (2026-04-20 Mon) (1/2) ;work;");
    expect(task?.priority).toBeNull();
    expect(task?.tags).toEqual([]);
    expect(task?.timestamps).toEqual([]);
    expect(task?.planning).toEqual([]);
  });

  it("leaves the source unchanged for blank captures", () => {
    const source = "* Tasks\n";
    expect(appendQuickCaptureToTasks(source, " \n\t ")).toBe(source);
  });
});
