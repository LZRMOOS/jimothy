import { describe, it, expect } from "vitest";
import { parseTaskDoc, serializeTaskDoc } from "./taskList";

describe("Calendar Event Parsing", () => {
  it("should parse all-day events", () => {
    const input = "[all-day] Holiday !2026-08-25";
    const doc = parseTaskDoc(input);
    expect(doc).toHaveLength(1);
    expect(doc[0]).toEqual({
      kind: "event",
      event: {
        text: "Holiday",
        date: "2026-08-25",
        startTime: 0,
        endTime: null,
      },
    });
  });

  it("should parse timed events with range", () => {
    const input = "[9am-10am] Team Meeting !2026-08-21";
    const doc = parseTaskDoc(input);
    expect(doc).toHaveLength(1);
    expect(doc[0]).toEqual({
      kind: "event",
      event: {
        text: "Team Meeting",
        date: "2026-08-21",
        startTime: 540, // 9am = 9 * 60
        endTime: 600,   // 10am = 10 * 60
      },
    });
  });

  it("should parse events with minutes", () => {
    const input = "[2:30pm-4pm] F1: FP1 (Dutch Grand Prix) !2026-08-21";
    const doc = parseTaskDoc(input);
    expect(doc).toHaveLength(1);
    expect(doc[0]).toEqual({
      kind: "event",
      event: {
        text: "F1: FP1 (Dutch Grand Prix)",
        date: "2026-08-21",
        startTime: 870, // 2:30pm = 14 * 60 + 30
        endTime: 960,   // 4pm = 16 * 60
      },
    });
  });

  it("should serialize events back to markdown", () => {
    const input = "[9am-10am] Team Meeting !2026-08-21";
    const doc = parseTaskDoc(input);
    const output = serializeTaskDoc(doc);
    expect(output).toBe(input);
  });

  it("should handle mixed tasks and events", () => {
    const input = `- [ ] Buy groceries !2026-08-21
[9am-10am] Team Meeting !2026-08-21
- [x] Done task !2026-08-20`;

    const doc = parseTaskDoc(input);
    expect(doc).toHaveLength(3);
    expect(doc[0].kind).toBe("task");
    expect(doc[1].kind).toBe("event");
    expect(doc[2].kind).toBe("task");
  });
});
