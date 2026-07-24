import { Extension } from "@tiptap/core";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";

const PRIORITY_REGEX = /!(?:high|med|low)/g;
const PRIORITIES = ["!high", "!med", "!low"] as const;
const pluginKey = new PluginKey("taskPriority");

function isInsideTaskItem(doc: any, pos: number): boolean {
  const resolved = doc.resolve(pos);
  for (let depth = resolved.depth; depth >= 0; depth--) {
    if (resolved.node(depth).type.name === "taskItem") return true;
  }
  return false;
}

export function createTaskPriorityExtension() {
  return Extension.create({
    name: "taskPriority",
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
              PRIORITY_REGEX.lastIndex = 0;
              let match;
              while ((match = PRIORITY_REGEX.exec(text)) !== null) {
                const from = pos + match.index;
                const to = from + match[0].length;
                const level = match[0] as typeof PRIORITIES[number];
                decorations.push(
                  Decoration.inline(from, to, {
                    class: `priority-pill priority-${level.slice(1)}`,
                    nodeName: "span",
                  })
                );
              }
            });
            return DecorationSet.create(state.doc, decorations);
          },
          handleClick(view, pos, event) {
            const target = event.target as HTMLElement;
            if (!target.classList.contains("priority-pill")) return false;

            const state = view.state;
            const $pos = state.doc.resolve(pos);
            const node = $pos.parent;
            if (!node.isTextblock) return false;

            const text = node.textContent;
            PRIORITY_REGEX.lastIndex = 0;
            let match;
            while ((match = PRIORITY_REGEX.exec(text)) !== null) {
              const from = $pos.start() + match.index;
              const to = from + match[0].length;
              if (pos >= from && pos <= to) {
                const current = match[0] as typeof PRIORITIES[number];
                const idx = PRIORITIES.indexOf(current);
                const next = PRIORITIES[(idx + 1) % PRIORITIES.length];
                if (idx === PRIORITIES.length - 1) {
                  // After low, remove the priority (and any trailing space)
                  const afterTo = to < node.textContent.length + $pos.start() && state.doc.textBetween(to, to + 1) === " " ? to + 1 : to;
                  const beforeFrom = from > $pos.start() && state.doc.textBetween(from - 1, from) === " " ? from - 1 : from;
                  view.dispatch(state.tr.delete(beforeFrom, afterTo));
                } else {
                  view.dispatch(state.tr.replaceWith(from, to, state.schema.text(next)));
                }
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
