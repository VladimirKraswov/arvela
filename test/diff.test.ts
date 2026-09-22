import { describe, expect, it } from "vitest";
import { looksBinary, unifiedDiffLines } from "../src/util/diff";

describe("looksBinary", () => {
  it("flags NUL bytes in either side", () => {
    expect(looksBinary("text", "bin\u0000ary")).toBe(true);
    expect(looksBinary("plain", "other")).toBe(false);
    expect(looksBinary(undefined, "plain")).toBe(false);
  });
});

describe("unifiedDiffLines", () => {
  it("marks additions and deletions", () => {
    const out = unifiedDiffLines("a\nb\nc", "a\nB\nc");
    expect(out).toContain("-b");
    expect(out).toContain("+B");
    expect(out).toContain(" a");
    expect(out).toContain(" c");
  });

  it("handles creation and deletion of whole files", () => {
    expect(unifiedDiffLines(undefined, "x\ny")).toEqual(["+x", "+y"]);
    expect(unifiedDiffLines("x\ny", undefined)).toEqual(["-x", "-y"]);
  });

  it("emits nothing when content is identical", () => {
    expect(unifiedDiffLines("a\nb", "a\nb")).toEqual([]);
  });

  it("collapses far-apart hunks with a skip marker and bounded context", () => {
    const before = Array.from({ length: 20 }, (_, i) => `l${i}`).join("\n");
    const afterLines = Array.from({ length: 20 }, (_, i) => `l${i}`);
    afterLines[0] = "changed0";
    afterLines[19] = "changed19";
    const out = unifiedDiffLines(before, afterLines.join("\n"));
    expect(out.filter((l) => l === "…")).toHaveLength(1);
    // no more than CONTEXT(2) unchanged lines surround each change
    expect(out.indexOf("-l0")).toBeLessThanOrEqual(2);
    expect(out.some((l) => l.startsWith("l") && !l.startsWith(" "))).toBe(
      false,
    );
  });

  it("does not treat a trailing newline as an extra empty line", () => {
    expect(unifiedDiffLines("a\n", "a")).toEqual([]);
  });
});
