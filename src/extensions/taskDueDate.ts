import { Extension } from "@tiptap/core";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import { isInsideTaskItem, deleteWithSurroundingSpace } from "./taskUtils";

const DUE_REGEX = /(?:^|\s)(!\d{4}-\d{2}-\d{2})(?=\s|$)/g;
const pluginKey = new PluginKey("taskDueDate");

function isValidDate(dateStr: string): boolean {
  const d = new Date(dateStr + "T00:00:00");
  if (isNaN(d.getTime())) return false;
  const [y, m, day] = dateStr.split("-").map(Number);
  return d.getFullYear() === y && d.getMonth() + 1 === m && d.getDate() === day;
}

function getUrgencyColor(dateStr: string): string {
  const due = new Date(dateStr + "T23:59:59");
  const now = new Date();
  const daysLeft = (due.getTime() - now.getTime()) / 86400000;

  if (daysLeft < 0) return "#dc2626";
  if (daysLeft < 1) return "#ea580c";
  if (daysLeft < 3) return "#d97706";
  if (daysLeft < 7) return "#ca8a04";
  if (daysLeft < 14) return "#65a30d";
  return "#16a34a";
}

function formatDueLabel(dateStr: string): string {
  const due = new Date(dateStr + "T23:59:59");
  const now = new Date();
  const daysLeft = Math.ceil((due.getTime() - now.getTime()) / 86400000);

  if (daysLeft < 0) return `${Math.abs(daysLeft)}d overdue`;
  if (daysLeft === 0) return "today";
  if (daysLeft === 1) return "tomorrow";
  if (daysLeft < 7) return `${daysLeft}d`;
  return due.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

export function createTaskDueDateExtension() {
  return Extension.create({
    name: "taskDueDate",
    addProseMirrorPlugins() {
      const plugin = new Plugin({
        key: pluginKey,
        props: {
          decorations(state) {
            const decorations: Decoration[] = [];
            state.doc.descendants((node, pos) => {
              if (!node.isText) return;
              if (!isInsideTaskItem(state.doc, pos)) return;
              const text = node.text || "";
              DUE_REGEX.lastIndex = 0;
              let match;
              while ((match = DUE_REGEX.exec(text)) !== null) {
                const token = match[1];
                const dateStr = token.slice(1);
                if (!isValidDate(dateStr)) continue;
                const tokenStart = match.index + match[0].indexOf(token);
                const from = pos + tokenStart;
                const to = from + token.length;
                const color = getUrgencyColor(dateStr);
                const label = formatDueLabel(dateStr);
                decorations.push(
                  Decoration.inline(from, to, {
                    class: "due-date-pill",
                    style: `color: ${color}; background: ${color}18;`,
                    nodeName: "span",
                    "data-due-label": label,
                  } as any)
                );
              }
            });
            return DecorationSet.create(state.doc, decorations);
          },
          handleClick(view, pos, event) {
            const target = event.target as HTMLElement;
            if (!target.classList.contains("due-date-pill")) return false;

            const state = view.state;
            const $pos = state.doc.resolve(pos);
            const node = $pos.parent;
            if (!node.isTextblock) return false;

            const text = node.textContent;
            const parentStart = $pos.start();
            DUE_REGEX.lastIndex = 0;
            let match;
            while ((match = DUE_REGEX.exec(text)) !== null) {
              const token = match[1];
              const tokenStart = match.index + match[0].indexOf(token);
              const from = parentStart + tokenStart;
              const to = from + token.length;
              if (pos >= from && pos < to) {
                deleteWithSurroundingSpace(view, from, to, parentStart, text.length);
                return true;
              }
            }
            return false;
          },
        },
      });
      return [plugin];
    },
  });
}
