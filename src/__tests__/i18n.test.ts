// @vitest-environment happy-dom
import { describe, it, expect, beforeEach } from "vitest";
import { t, getLocale, setLocale } from "../i18n.ts";

describe("i18n", () => {
  beforeEach(() => {
    setLocale("en");
  });

  it("returns English by default", () => {
    expect(t("save")).toBe("Save");
    expect(t("delete")).toBe("Delete");
  });

  it("returns Norwegian when locale is set to nb", () => {
    setLocale("nb");
    expect(t("save")).toBe("Lagre");
    expect(t("delete")).toBe("Slett");
    expect(getLocale()).toBe("nb");
  });

  it("interpolates parameters", () => {
    expect(t("addEventOn", { date: "Mon 6 May" })).toBe("Add event on Mon 6 May");
    setLocale("nb");
    expect(t("addEventOn", { date: "man. 6. mai" })).toBe("Legg til hendelse man. 6. mai");
  });

  it("falls back to English when key missing in target locale", () => {
    setLocale("en");
    expect(t("save")).toBeTruthy();
  });

  it("persists locale to localStorage", () => {
    setLocale("nb");
    expect(localStorage.getItem("mediant-locale")).toBe("nb");
    setLocale("en");
    expect(localStorage.getItem("mediant-locale")).toBe("en");
  });
});
