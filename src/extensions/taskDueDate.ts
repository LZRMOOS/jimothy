import { Extension } from "@tiptap/core";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";

const DUE_REGEX = /!\d{4}-\d{2}-\d{2}/g;
const pluginKey = new PluginKey("taskDueDate");

function isInsideTaskItem(doc: any, pos: number): boolean {
  const resolved = doc.resolve(pos);
  for (let depth = resolved.depth; depth >= 0; depth--) {
    if (resolved.node(depth).type.name === "taskItem") return true;
  }
  return false;
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
                const from = pos + match.index;
                const to = from + match[0].length;
                const dateStr = match[0].slice(1);
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
            DUE_REGEX.lastIndex = 0;
            let match;
            while ((match = DUE_REGEX.exec(text)) !== null) {
              const from = $pos.start() + match.index;
              const to = from + match[0].length;
              if (pos >= from && pos <= to) {
                const afterTo = to < node.textContent.length + $pos.start() && state.doc.textBetween(to, to + 1) === " " ? to + 1 : to;
                const beforeFrom = from > $pos.start() && state.doc.textBetween(from - 1, from) === " " ? from - 1 : from;
                view.dispatch(state.tr.delete(beforeFrom, afterTo));
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
