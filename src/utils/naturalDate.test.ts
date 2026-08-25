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

  describe("relative time (in N hours/minutes)", () => {
    it("parses 'in 3 hours' from noon", () => {
      const result = parseTaskInput("Call dentist in 3 hours", testDate);
      expect(result.date).toBe("2026-08-20");
      expect(result.time).toBe(15 * 60); // 12:00 + 3h = 15:00
      expect(result.text).toBe("Call dentist");
    });

    it("parses 'in 1 hour'", () => {
      const result = parseTaskInput("Meeting in 1 hour", testDate);
      expect(result.date).toBe("2026-08-20");
      expect(result.time).toBe(13 * 60); // 12:00 + 1h = 13:00
      expect(result.text).toBe("Meeting");
    });

    it("parses 'in 30 minutes'", () => {
      const result = parseTaskInput("Quick call in 30 minutes", testDate);
      expect(result.date).toBe("2026-08-20");
      expect(result.time).toBe(12 * 60 + 30); // 12:00 + 30m = 12:30
      expect(result.text).toBe("Quick call");
    });

    it("parses 'in 90 minutes'", () => {
      const result = parseTaskInput("Task in 90 minutes", testDate);
      expect(result.date).toBe("2026-08-20");
      expect(result.time).toBe(13 * 60 + 30); // 12:00 + 90m = 13:30
      expect(result.text).toBe("Task");
    });

    it("accepts 'min' as abbreviation for minutes", () => {
      const result = parseTaskInput("Task in 15 min", testDate);
      expect(result.date).toBe("2026-08-20");
      expect(result.time).toBe(12 * 60 + 15);
      expect(result.text).toBe("Task");
    });

    it("accepts 'mins' as abbreviation for minutes", () => {
      const result = parseTaskInput("Task in 45 mins", testDate);
      expect(result.date).toBe("2026-08-20");
      expect(result.time).toBe(12 * 60 + 45);
      expect(result.text).toBe("Task");
    });

    it("crosses midnight correctly with hours", () => {
      const lateDate = new Date("2026-08-20T23:00:00");
      const result = parseTaskInput("Late task in 2 hours", lateDate);
      expect(result.date).toBe("2026-08-21"); // next day
      expect(result.time).toBe(1 * 60); // 23:00 + 2h = 01:00
      expect(result.text).toBe("Late task");
    });

    it("crosses midnight correctly with minutes", () => {
      const lateDate = new Date("2026-08-20T23:45:00");
      const result = parseTaskInput("Task in 30 minutes", lateDate);
      expect(result.date).toBe("2026-08-21"); // next day
      expect(result.time).toBe(0 * 60 + 15); // 23:45 + 30m = 00:15
      expect(result.text).toBe("Task");
    });
  });

  describe("abbreviated relative time (3h, 20m, etc)", () => {
    it("parses 'in 3h' from noon", () => {
      const result = parseTaskInput("Call dentist in 3h", testDate);
      expect(result.date).toBe("2026-08-20");
      expect(result.time).toBe(15 * 60); // 12:00 + 3h = 15:00
      expect(result.text).toBe("Call dentist");
    });

    it("parses 'in 1hr'", () => {
      const result = parseTaskInput("Meeting in 1hr", testDate);
      expect(result.date).toBe("2026-08-20");
      expect(result.time).toBe(13 * 60); // 12:00 + 1h = 13:00
      expect(result.text).toBe("Meeting");
    });

    it("parses 'in 2hrs'", () => {
      const result = parseTaskInput("Review in 2hrs", testDate);
      expect(result.date).toBe("2026-08-20");
      expect(result.time).toBe(14 * 60); // 12:00 + 2h = 14:00
      expect(result.text).toBe("Review");
    });

    it("parses 'in 30m'", () => {
      const result = parseTaskInput("Quick call in 30m", testDate);
      expect(result.date).toBe("2026-08-20");
      expect(result.time).toBe(12 * 60 + 30); // 12:00 + 30m = 12:30
      expect(result.text).toBe("Quick call");
    });

    it("parses 'in 90m'", () => {
      const result = parseTaskInput("Task in 90m", testDate);
      expect(result.date).toBe("2026-08-20");
      expect(result.time).toBe(13 * 60 + 30); // 12:00 + 90m = 13:30
      expect(result.text).toBe("Task");
    });

    it("crosses midnight with 'in 2h'", () => {
      const lateDate = new Date("2026-08-20T23:00:00");
      const result = parseTaskInput("Late task in 2h", lateDate);
      expect(result.date).toBe("2026-08-21"); // next day
      expect(result.time).toBe(1 * 60); // 23:00 + 2h = 01:00
      expect(result.text).toBe("Late task");
    });

    it("crosses midnight with 'in 30m'", () => {
      const lateDate = new Date("2026-08-20T23:45:00");
      const result = parseTaskInput("Task in 30m", lateDate);
      expect(result.date).toBe("2026-08-21"); // next day
      expect(result.time).toBe(0 * 60 + 15); // 23:45 + 30m = 00:15
      expect(result.text).toBe("Task");
    });
  });
});
