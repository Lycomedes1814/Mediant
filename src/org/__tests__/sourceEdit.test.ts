import { describe, expect, it } from "vitest";
import {
  appendOrgTextToSource,
  deleteOrgBlockInSource,
  replaceOrgBlockInSource,
  toggleDoneInSource,
} from "../sourceEdit.ts";

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

  it("is a no-op when the source line is out of range", () => {
    const source = "** TODO Task\n";
    expect(replaceOrgBlockInSource(source, 5, "** TODO Other\n")).toBe(source);
  });
});

describe("toggleDoneInSource", () => {
  it("flips TODO to DONE without touching the rest of the block", () => {
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

  it("does nothing for headings without TODO/DONE", () => {
    const source = "** Plain heading\n";
    expect(toggleDoneInSource(source, 1)).toBe(source);
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
