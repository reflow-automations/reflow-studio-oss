import { describe, expect, it } from "vitest";
import { safeNext } from "@/lib/utils/safe-next";

const FALLBACK = "/create/image";

describe("safeNext", () => {
  it("keeps same-origin paths with query and hash", () => {
    expect(safeNext("/library")).toBe("/library");
    expect(safeNext("/generations/abc?tab=outputs#top")).toBe("/generations/abc?tab=outputs#top");
    expect(safeNext("/create/video", "/x")).toBe("/create/video");
  });

  it("falls back for empty and relative values", () => {
    expect(safeNext(null)).toBe(FALLBACK);
    expect(safeNext("")).toBe(FALLBACK);
    expect(safeNext("library")).toBe(FALLBACK);
    expect(safeNext("https://evil.com/")).toBe(FALLBACK);
    expect(safeNext("javascript:alert(1)")).toBe(FALLBACK);
  });

  it("blocks protocol-relative and backslash tricks", () => {
    for (const value of ["//evil.com", "/\\evil.com", "/\\/evil.com", "\\\\evil.com", "/..//evil.com", "/./..//evil.com"]) {
      expect(safeNext(value), value).toBe(FALLBACK);
    }
  });

  it("blocks tab, CR and LF that URL parsers strip (\"/\\t/evil.com\" becomes //evil.com)", () => {
    const fromQuery = new URLSearchParams("next=%2F%09%2Fevil.com").get("next");
    expect(fromQuery).toBe("/\t/evil.com");
    for (const value of [fromQuery, "/\n/evil.com", "/\r/evil.com", "/\u0000/evil.com", "/\u007f/evil.com"]) {
      expect(safeNext(value), JSON.stringify(value)).toBe(FALLBACK);
    }
  });

  it("keeps encoded slashes on this origin", () => {
    const result = safeNext("/%2F%2Fevil.com");
    expect(new URL(result, "https://studio.test").origin).toBe("https://studio.test");
  });

  it("never sends people back to the auth pages", () => {
    for (const value of ["/login", "/login?next=/x", "/auth/callback", "/setup"]) expect(safeNext(value), value).toBe(FALLBACK);
    expect(safeNext("/loginhelp")).toBe("/loginhelp");
  });
});
