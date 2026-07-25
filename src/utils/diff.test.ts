import { describe, it, expect } from "vitest";
import { diffLines } from "./diff";

describe("diffLines", () => {
  it("marks identical text as all equal", () => {
    const result = diffLines("a\nb\nc", "a\nb\nc");
    expect(result.every((l) => l.type === "equal")).toBe(true);
    expect(result).toHaveLength(3);
  });

  it("flags a changed line as removed + added", () => {
    const result = diffLines("a\nb\nc", "a\nB\nc");
    expect(result).toEqual([
      { type: "equal", text: "a" },
      { type: "removed", text: "b" },
      { type: "added", text: "B" },
      { type: "equal", text: "c" },
    ]);
  });

  it("handles an added line", () => {
    const result = diffLines("a\nc", "a\nb\nc");
    expect(result.filter((l) => l.type === "added")).toEqual([
      { type: "added", text: "b" },
    ]);
    expect(result.filter((l) => l.type === "removed")).toHaveLength(0);
  });

  it("handles a removed line", () => {
    const result = diffLines("a\nb\nc", "a\nc");
    expect(result.filter((l) => l.type === "removed")).toEqual([
      { type: "removed", text: "b" },
    ]);
  });

  it("handles the real-world truncation case", () => {
    const live = "- [ ] maybe custom emojis? like dropbox emoji, pepes for fun";
    const conflict = "- [ ] maybe custom emojis?";
    const result = diffLines(live, conflict);
    expect(result).toEqual([
      { type: "removed", text: live },
      { type: "added", text: conflict },
    ]);
  });
});
