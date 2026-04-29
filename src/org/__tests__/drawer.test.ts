import { describe, it, expect } from "vitest";
import { upsertProperty, removeProperty } from "../drawer.ts";
import { parseOrg } from "../parser.ts";

function withEntry(
  source: string,
): { source: string; entry: ReturnType<typeof parseOrg>[number] } {
  const entries = parseOrg(source);
  return { source, entry: entries[0] };
}

describe("upsertProperty", () => {
  it("creates a PROPERTIES drawer when absent, between heading and body", () => {
    const { source, entry } = withEntry("** Event\n<2026-04-27 ma. 17:00>\nBody line.\n");
    const out = upsertProperty(source, entry, "EXCEPTION-2026-04-27", "cancelled");
    expect(out).toBe(
      "** Event\n:PROPERTIES:\n:EXCEPTION-2026-04-27: cancelled\n:END:\n<2026-04-27 ma. 17:00>\nBody line.\n",
    );
  });

  it("inserts after SCHEDULED / DEADLINE lines", () => {
    const { source, entry } = withEntry(
      "** TODO Yoga\nSCHEDULED: <2026-04-27 ma. 17:00 +1w>\nBody.\n",
    );
    const out = upsertProperty(source, entry, "EXCEPTION-2026-04-27", "cancelled");
    const expected =
      "** TODO Yoga\nSCHEDULED: <2026-04-27 ma. 17:00 +1w>\n:PROPERTIES:\n:EXCEPTION-2026-04-27: cancelled\n:END:\nBody.\n";
    expect(out).toBe(expected);
  });

  it("appends to an existing drawer, preserving other keys and order", () => {
    const { source, entry } = withEntry(
      "** Yoga\n" +
        "<2026-04-27 ma. 17:00 +1w>\n" +
        ":PROPERTIES:\n" +
        ":CATEGORY: health\n" +
        ":EXCEPTION-2026-04-27: cancelled\n" +
        ":END:\n",
    );
    const out = upsertProperty(source, entry, "EXCEPTION-2026-05-04", "shift +45m");
    expect(out).toContain(":CATEGORY: health\n:EXCEPTION-2026-04-27: cancelled\n:EXCEPTION-2026-05-04: shift +45m\n:END:");
  });

  it("updates an existing key in place", () => {
    const { source, entry } = withEntry(
      "** Yoga\n" +
        "<2026-04-27 ma. +1w>\n" +
        ":PROPERTIES:\n" +
        ":EXCEPTION-2026-04-27: cancelled\n" +
        ":END:\n",
    );
    const out = upsertProperty(source, entry, "EXCEPTION-2026-04-27", "shift +45m");
    expect(out).toContain(":EXCEPTION-2026-04-27: shift +45m");
    expect(out).not.toContain(":EXCEPTION-2026-04-27: cancelled");
  });

  it("is idempotent when the same value is written twice", () => {
    const { source, entry } = withEntry(
      "** Yoga\n" +
        "<2026-04-27 ma. +1w>\n" +
        ":PROPERTIES:\n" +
        ":EXCEPTION-2026-04-27: cancelled\n" +
        ":END:\n",
    );
    const once = upsertProperty(source, entry, "EXCEPTION-2026-04-27", "cancelled");
    const twice = upsertProperty(once, entry, "EXCEPTION-2026-04-27", "cancelled");
    expect(once).toBe(source);
    expect(twice).toBe(source);
  });

  it("inserts directly after the heading when no planning/timestamp lines follow", () => {
    const { source, entry } = withEntry("** Yoga\nBody.\n");
    const out = upsertProperty(source, entry, "EXCEPTION-2026-04-27", "cancelled");
    expect(out).toBe(
      "** Yoga\n:PROPERTIES:\n:EXCEPTION-2026-04-27: cancelled\n:END:\nBody.\n",
    );
  });

  it("does not touch other entries", () => {
    const src = "** One\nBody1.\n** Two\n<2026-04-27 ma.>\nBody2.\n";
    const entries = parseOrg(src);
    const out = upsertProperty(src, entries[1], "EXCEPTION-2026-04-27", "cancelled");
    expect(out).toBe(
      "** One\nBody1.\n** Two\n:PROPERTIES:\n:EXCEPTION-2026-04-27: cancelled\n:END:\n<2026-04-27 ma.>\nBody2.\n",
    );
  });

  it("creates active-timestamp event drawers where Org property APIs recognize them", () => {
    const { source, entry } = withEntry("** Event\n<2026-04-27 ma. 17:00 +1w>\n");
    const out = upsertProperty(source, entry, "SERIES-UNTIL", "2026-05-04");
    expect(out).toBe(
      "** Event\n:PROPERTIES:\n:SERIES-UNTIL: 2026-05-04\n:END:\n<2026-04-27 ma. 17:00 +1w>\n",
    );
  });

  it("written source round-trips through the parser", () => {
    const { source, entry } = withEntry(
      "** Yoga\n<2026-04-27 ma. 17:00 +1w>\nBody.\n",
    );
    const out = upsertProperty(source, entry, "EXCEPTION-2026-04-27", "shift +45m");
    const reparsed = parseOrg(out);
    const ex = reparsed[0].exceptions.get("2026-04-27");
    expect(ex?.override).toEqual({ kind: "shift", offsetMinutes: 45 });
  });
});

describe("removeProperty", () => {
  it("removes a single key while leaving other keys untouched", () => {
    const { source, entry } = withEntry(
      "** Yoga\n" +
        "<2026-04-27 ma. +1w>\n" +
        ":PROPERTIES:\n" +
        ":CATEGORY: health\n" +
        ":EXCEPTION-2026-04-27: cancelled\n" +
        ":EXCEPTION-2026-05-04: shift +45m\n" +
        ":END:\n",
    );
    const out = removeProperty(source, entry, "EXCEPTION-2026-04-27");
    expect(out).not.toContain(":EXCEPTION-2026-04-27:");
    expect(out).toContain(":CATEGORY: health");
    expect(out).toContain(":EXCEPTION-2026-05-04: shift +45m");
  });

  it("drops the whole drawer when the last key is removed", () => {
    const { source, entry } = withEntry(
      "** Yoga\n" +
        "<2026-04-27 ma. +1w>\n" +
        ":PROPERTIES:\n" +
        ":EXCEPTION-2026-04-27: cancelled\n" +
        ":END:\n" +
        "Body.\n",
    );
    const out = removeProperty(source, entry, "EXCEPTION-2026-04-27");
    expect(out).toBe("** Yoga\n<2026-04-27 ma. +1w>\nBody.\n");
  });

  it("is a no-op when the key does not exist", () => {
    const { source, entry } = withEntry(
      "** Yoga\n" +
        "<2026-04-27 ma. +1w>\n" +
        ":PROPERTIES:\n" +
        ":EXCEPTION-2026-04-27: cancelled\n" +
        ":END:\n",
    );
    const out = removeProperty(source, entry, "EXCEPTION-2026-05-04");
    expect(out).toBe(source);
  });

  it("is a no-op when there is no drawer", () => {
    const { source, entry } = withEntry("** Yoga\nBody.\n");
    const out = removeProperty(source, entry, "EXCEPTION-2026-04-27");
    expect(out).toBe(source);
  });
});
