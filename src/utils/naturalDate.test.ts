import { describe, it, expect } from "vitest";
import { parseTaskInput } from "./naturalDate";

describe("naturalDate - numeric formats", () => {
  const testDate = new Date("2026-08-20T12:00:00");

  describe("short M/D format (without year)", () => {
    it("parses 8/27 as August 27 of current year", () => {
      const result = parseTaskInput("Call dentist 8/27", testDate);
      expect(result.date).toBe("2026-08-27");
      expect(result.text).toBe("Call dentist");
    });

    it("parses 8-27 with dash separator", () => {
      const result = parseTaskInput("Meeting 8-27", testDate);
      expect(result.date).toBe("2026-08-27");
      expect(result.text).toBe("Meeting");
    });

    it("bumps to next year if date is in the past", () => {
      const result = parseTaskInput("Review 8/15", testDate);
      expect(result.date).toBe("2027-08-15");
      expect(result.text).toBe("Review");
    });

    it("handles single-digit months and days", () => {
      const result = parseTaskInput("Task 9/5", testDate);
      expect(result.date).toBe("2026-09-05");
    });

    it("rejects invalid dates like 2/30", () => {
      const result = parseTaskInput("Task 2/30", testDate);
      expect(result.date).toBe(null);
    });
  });

  describe("full M/D/YYYY format", () => {
    it("parses 8/23/2028 with 4-digit year", () => {
      const result = parseTaskInput("Future task 8/23/2028", testDate);
      expect(result.date).toBe("2028-08-23");
      expect(result.text).toBe("Future task");
    });

    it("parses with dash separator", () => {
      const result = parseTaskInput("Event 12-25-2027", testDate);
      expect(result.date).toBe("2027-12-25");
      expect(result.text).toBe("Event");
    });

    it("handles single-digit months and days with year", () => {
      const result = parseTaskInput("Task 1/5/2027", testDate);
      expect(result.date).toBe("2027-01-05");
    });
  });

  describe("with time", () => {
    it("parses date and time together", () => {
      const result = parseTaskInput("Meeting 8/27 2pm", testDate);
      expect(result.date).toBe("2026-08-27");
      expect(result.time).toBe(14 * 60);
      expect(result.text).toBe("Meeting");
    });

    it("parses full date with time", () => {
      const result = parseTaskInput("Call 8/23/2028 9:30am", testDate);
      expect(result.date).toBe("2028-08-23");
      expect(result.time).toBe(9 * 60 + 30);
      expect(result.text).toBe("Call");
    });
  });
});
