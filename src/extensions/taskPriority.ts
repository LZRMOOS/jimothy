import { Extension } from "@tiptap/core";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import { isInsideTaskItem, deleteWithSurroundingSpace } from "./taskUtils";

const PRIORITY_REGEX = /(?:^|\s)(!(?:high|med|low))(?=\s|$)/g;
const PRIORITIES = ["!high", "!med", "!low"] as const;
const pluginKey = new PluginKey("taskPriority");

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
                const token = match[1];
                const tokenStart = match.index + match[0].indexOf(token);
                const from = pos + tokenStart;
                const to = from + token.length;
                const level = token as typeof PRIORITIES[number];
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
            const parentStart = $pos.start();
            PRIORITY_REGEX.lastIndex = 0;
            let match;
            while ((match = PRIORITY_REGEX.exec(text)) !== null) {
              const token = match[1];
              const tokenStart = match.index + match[0].indexOf(token);
              const from = parentStart + tokenStart;
              const to = from + token.length;
              if (pos >= from && pos < to) {
                const current = token as typeof PRIORITIES[number];
                const idx = PRIORITIES.indexOf(current);
                if (idx === PRIORITIES.length - 1) {
                  deleteWithSurroundingSpace(view, from, to, parentStart, text.length);
                } else {
                  const next = PRIORITIES[idx + 1];
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
