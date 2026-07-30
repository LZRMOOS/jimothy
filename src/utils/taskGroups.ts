// Task grouping by tags and smart filters. Tags are extracted from task text
// using the same #tag pattern the markdown renderer recognizes, so groups stay
// byte-compatible with the plaintext format (no new metadata files).

import type { IdTask } from "./agenda";

// Extract all #tags from task text. Same pattern as the markdown renderer's
// tag highlight so they stay in sync.
export function extractTags(text: string): string[] {
  const tags: string[] = [];
  const regex = /#([a-zA-Z0-9_-]+)/g;
  let match;
  while ((match = regex.exec(text)) !== null) {
    tags.push(match[1].toLowerCase());
  }
  return tags;
}

// Get all unique tags across all tasks, sorted alphabetically.
export function getAllTags(tasks: IdTask[]): string[] {
  const tagSet = new Set<string>();
  for (const task of tasks) {
    if (task.done) continue; // Skip completed tasks
    const tags = extractTags(task.text);
    tags.forEach((t) => tagSet.add(t));
  }
  return Array.from(tagSet).sort();
}

export type SmartGroupType = "recurring" | "high-priority" | "overdue" | "no-due-date";

export type SmartGroup = {
  type: "smart";
  id: SmartGroupType;
  name: string;
  icon: string;
  filter: (task: IdTask, today: string) => boolean;
};

export type TagGroup = {
  type: "tag";
  id: string; // The tag name
  name: string; // "#tagname" for display
  count: number;
};

export type Group = SmartGroup | TagGroup;

// Built-in smart groups that filter tasks dynamically.
// Icons are Ionicons names (https://ionic.io/ionicons).
export const SMART_GROUPS: SmartGroup[] = [
  {
    type: "smart",
    id: "recurring",
    name: "Recurring",
    icon: "repeat-outline",
    filter: (task) => task.recurrence !== null && !task.done,
  },
  {
    type: "smart",
    id: "high-priority",
    name: "High priority",
    icon: "alert-circle-outline",
    filter: (task) => task.priority === "high" && !task.done,
  },
  {
    type: "smart",
    id: "overdue",
    name: "Overdue",
    icon: "warning-outline",
    filter: (task, today) => !task.done && task.date !== null && task.date < today,
  },
  {
    type: "smart",
    id: "no-due-date",
    name: "No due date",
    icon: "pin-outline",
    filter: (task) => !task.done && task.date === null,
  },
];

// Get all groups (smart + tag-based) with their task counts.
export function getGroups(tasks: IdTask[], today: string): Group[] {
  const groups: Group[] = [];

  // Add smart groups with counts
  for (const smart of SMART_GROUPS) {
    const count = tasks.filter((t) => smart.filter(t, today)).length;
    if (count > 0) {
      groups.push({ ...smart });
    }
  }

  // Add tag groups with counts
  const tags = getAllTags(tasks);
  for (const tag of tags) {
    const count = tasks.filter((t) => {
      if (t.done) return false;
      return extractTags(t.text).includes(tag);
    }).length;
    if (count > 0) {
      groups.push({
        type: "tag",
        id: tag,
        name: `#${tag}`,
        count,
      });
    }
  }

  return groups;
}

// Get tasks for a specific group.
export function getTasksForGroup(
  tasks: IdTask[],
  group: Group,
  today: string,
): IdTask[] {
  if (group.type === "smart") {
    return tasks.filter((t) => group.filter(t, today));
  } else {
    return tasks.filter((t) => {
      if (t.done) return false;
      const tags = extractTags(t.text);
      return tags.includes(group.id);
    });
  }
}

// Search tasks by text (fuzzy).
export function searchTasks(tasks: IdTask[], query: string): IdTask[] {
  if (!query.trim()) return [];
  const q = query.toLowerCase();
  return tasks.filter((t) => {
    if (t.done) return false;
    return t.text.toLowerCase().includes(q);
  });
}

// Get all untagged tasks (tasks with no #tags).
export function getUntaggedTasks(tasks: IdTask[]): IdTask[] {
  return tasks.filter((t) => {
    if (t.done) return false;
    return extractTags(t.text).length === 0;
  });
}
