import { describe, it, expect } from "vitest";
import { extractTags, getAllTags, getGroups, getTasksForGroup, searchTasks, getUntaggedTasks, SMART_GROUPS } from "./taskGroups";
import type { IdTask } from "./agenda";

describe("taskGroups", () => {
  describe("extractTags", () => {
    it("extracts tags from task text", () => {
      expect(extractTags("Call Bob #work #urgent")).toEqual(["work", "urgent"]);
      expect(extractTags("Buy milk #personal #groceries")).toEqual(["personal", "groceries"]);
      expect(extractTags("No tags here")).toEqual([]);
    });

    it("handles case insensitivity", () => {
      expect(extractTags("Task #Work #URGENT")).toEqual(["work", "urgent"]);
    });

    it("handles tags with numbers and hyphens", () => {
      expect(extractTags("Task #work-2024 #client_1")).toEqual(["work-2024", "client_1"]);
    });
  });

  describe("getAllTags", () => {
    it("gets all unique tags across tasks", () => {
      const tasks: IdTask[] = [
        { cid: "1", text: "Task 1 #work #urgent", date: null, time: null, priority: null, recurrence: null, done: false },
        { cid: "2", text: "Task 2 #work #personal", date: null, time: null, priority: null, recurrence: null, done: false },
        { cid: "3", text: "Task 3 #personal", date: null, time: null, priority: null, recurrence: null, done: false },
      ];
      expect(getAllTags(tasks)).toEqual(["personal", "urgent", "work"]);
    });

    it("skips completed tasks", () => {
      const tasks: IdTask[] = [
        { cid: "1", text: "Task 1 #work", date: null, time: null, priority: null, recurrence: null, done: false },
        { cid: "2", text: "Task 2 #urgent", date: null, time: null, priority: null, recurrence: null, done: true },
      ];
      expect(getAllTags(tasks)).toEqual(["work"]);
    });
  });

  describe("getGroups", () => {
    it("includes smart groups with counts", () => {
      const today = "2026-07-29";
      const tasks: IdTask[] = [
        { cid: "1", text: "Recurring task", date: "2026-07-30", time: null, priority: null, recurrence: { every: 1, unit: "w" }, done: false },
        { cid: "2", text: "High priority task", date: null, time: null, priority: "high", recurrence: null, done: false },
        { cid: "3", text: "Overdue task", date: "2026-07-20", time: null, priority: null, recurrence: null, done: false },
        { cid: "4", text: "No due date", date: null, time: null, priority: null, recurrence: null, done: false },
      ];
      const groups = getGroups(tasks, today);
      expect(groups).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ id: "recurring", name: "Recurring" }),
          expect.objectContaining({ id: "high-priority", name: "High priority" }),
          expect.objectContaining({ id: "overdue", name: "Overdue" }),
          expect.objectContaining({ id: "no-due-date", name: "No due date" }),
        ])
      );
    });

    it("includes tag groups with counts", () => {
      const today = "2026-07-29";
      const tasks: IdTask[] = [
        { cid: "1", text: "Task 1 #work", date: null, time: null, priority: null, recurrence: null, done: false },
        { cid: "2", text: "Task 2 #work", date: null, time: null, priority: null, recurrence: null, done: false },
        { cid: "3", text: "Task 3 #personal", date: null, time: null, priority: null, recurrence: null, done: false },
      ];
      const groups = getGroups(tasks, today);
      expect(groups).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ type: "tag", id: "work", name: "#work", count: 2 }),
          expect.objectContaining({ type: "tag", id: "personal", name: "#personal", count: 1 }),
        ])
      );
    });
  });

  describe("getTasksForGroup", () => {
    const today = "2026-07-29";

    it("filters by smart group", () => {
      const tasks: IdTask[] = [
        { cid: "1", text: "High priority", date: null, time: null, priority: "high", recurrence: null, done: false },
        { cid: "2", text: "Low priority", date: null, time: null, priority: "low", recurrence: null, done: false },
      ];
      const highPriorityGroup = SMART_GROUPS.find((g) => g.id === "high-priority")!;
      const filtered = getTasksForGroup(tasks, highPriorityGroup, today);
      expect(filtered).toHaveLength(1);
      expect(filtered[0].text).toBe("High priority");
    });

    it("filters by tag group", () => {
      const tasks: IdTask[] = [
        { cid: "1", text: "Task #work", date: null, time: null, priority: null, recurrence: null, done: false },
        { cid: "2", text: "Task #personal", date: null, time: null, priority: null, recurrence: null, done: false },
      ];
      const workGroup = { type: "tag" as const, id: "work", name: "#work", count: 1 };
      const filtered = getTasksForGroup(tasks, workGroup, today);
      expect(filtered).toHaveLength(1);
      expect(filtered[0].text).toBe("Task #work");
    });
  });

  describe("searchTasks", () => {
    it("searches by text", () => {
      const tasks: IdTask[] = [
        { cid: "1", text: "Call Bob", date: null, time: null, priority: null, recurrence: null, done: false },
        { cid: "2", text: "Email Alice", date: null, time: null, priority: null, recurrence: null, done: false },
      ];
      expect(searchTasks(tasks, "Bob")).toHaveLength(1);
      expect(searchTasks(tasks, "bob")).toHaveLength(1);
      expect(searchTasks(tasks, "call")).toHaveLength(1);
    });

    it("skips completed tasks", () => {
      const tasks: IdTask[] = [
        { cid: "1", text: "Call Bob", date: null, time: null, priority: null, recurrence: null, done: true },
      ];
      expect(searchTasks(tasks, "Bob")).toHaveLength(0);
    });
  });

  describe("getUntaggedTasks", () => {
    it("returns tasks with no tags", () => {
      const tasks: IdTask[] = [
        { cid: "1", text: "Task with no tags", date: null, time: null, priority: null, recurrence: null, done: false },
        { cid: "2", text: "Task #work", date: null, time: null, priority: null, recurrence: null, done: false },
        { cid: "3", text: "Another untagged", date: null, time: null, priority: null, recurrence: null, done: false },
      ];
      const untagged = getUntaggedTasks(tasks);
      expect(untagged).toHaveLength(2);
      expect(untagged[0].text).toBe("Task with no tags");
      expect(untagged[1].text).toBe("Another untagged");
    });

    it("skips completed tasks", () => {
      const tasks: IdTask[] = [
        { cid: "1", text: "Untagged task", date: null, time: null, priority: null, recurrence: null, done: true },
      ];
      expect(getUntaggedTasks(tasks)).toHaveLength(0);
    });
  });
});
