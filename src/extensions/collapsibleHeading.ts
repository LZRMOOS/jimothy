import { Extension } from "@tiptap/core";
import { Plugin, PluginKey, Transaction } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";

const pluginKey = new PluginKey("collapsibleHeading");

interface CollapseState {
  collapsed: Set<number>;
}

function getCollapsedRange(
  doc: any,
  headingPos: number,
  headingLevel: number
): { from: number; to: number } | null {
  const headingNode = doc.nodeAt(headingPos);
  if (!headingNode) return null;
  const contentStart = headingPos + headingNode.nodeSize;
  let end = contentStart;

  for (let pos = contentStart; pos < doc.content.size; ) {
    const node = doc.nodeAt(pos);
    if (!node) break;
    if (node.type.name === "heading" && node.attrs.level <= headingLevel) {
      break;
    }
    end = pos + node.nodeSize;
    pos = end;
  }

  if (end <= contentStart) return null;
  return { from: contentStart, to: end };
}

export function createCollapsibleHeadingExtension() {
  return Extension.create({
    name: "collapsibleHeading",
    addProseMirrorPlugins() {
      const plugin = new Plugin({
        key: pluginKey,
        state: {
          init(): CollapseState {
            return { collapsed: new Set() };
          },
          apply(tr: Transaction, value: CollapseState): CollapseState {
            const meta = tr.getMeta(pluginKey);
            if (meta?.toggle !== undefined) {
              const next = new Set(value.collapsed);
              if (next.has(meta.toggle)) {
                next.delete(meta.toggle);
              } else {
                next.add(meta.toggle);
              }
              return { collapsed: next };
            }
            if (meta?.expand !== undefined) {
              const next = new Set(value.collapsed);
              next.delete(meta.expand);
              return { collapsed: next };
            }
            if (!tr.docChanged) return value;
            const next = new Set<number>();
            for (const pos of value.collapsed) {
              const mapped = tr.mapping.map(pos);
              const node = tr.doc.nodeAt(mapped);
              if (node?.type.name === "heading") {
                next.add(mapped);
              }
            }
            return { collapsed: next };
          },
        },
        props: {
          decorations(state) {
            const { collapsed } = pluginKey.getState(state) as CollapseState;
            const decorations: Decoration[] = [];

            state.doc.forEach((node, offset) => {
              if (node.type.name !== "heading") return;
              const isCollapsed = collapsed.has(offset);
              const endPos = offset + node.nodeSize - 1;

              decorations.push(
                Decoration.widget(
                  endPos,
                  () => {
                    const toggle = document.createElement("span");
                    toggle.className = `heading-collapse-toggle${isCollapsed ? " collapsed" : ""}`;
                    toggle.setAttribute("data-collapse-pos", String(offset));
                    toggle.setAttribute("contenteditable", "false");
                    return toggle;
                  },
                  { side: 1, key: `collapse-${offset}-${isCollapsed}` }
                )
              );

              if (isCollapsed) {
                decorations.push(
                  Decoration.node(offset, offset + node.nodeSize, {
                    class: "heading-is-collapsed",
                  })
                );

                const range = getCollapsedRange(
                  state.doc,
                  offset,
                  node.attrs.level
                );
                if (range) {
                  for (let pos = range.from; pos < range.to; ) {
                    const child = state.doc.nodeAt(pos);
                    if (!child) break;
                    decorations.push(
                      Decoration.node(pos, pos + child.nodeSize, {
                        class: "collapsed-content",
                      })
                    );
                    pos += child.nodeSize;
                  }
                }
              }
            });

            return DecorationSet.create(state.doc, decorations);
          },
          handleClick(view, _pos, event) {
            const target = event.target as HTMLElement;
            if (!target.classList.contains("heading-collapse-toggle")) return false;
            const headingPos = Number(target.getAttribute("data-collapse-pos"));
            if (isNaN(headingPos)) return false;
            const node = view.state.doc.nodeAt(headingPos);
            if (!node || node.type.name !== "heading") return false;
            const tr = view.state.tr.setMeta(pluginKey, { toggle: headingPos });
            view.dispatch(tr);
            return true;
          },
        },
        appendTransaction(_transactions, _oldState, newState) {
          const { collapsed } = pluginKey.getState(newState) as CollapseState;
          if (collapsed.size === 0) return null;

          const { from, to } = newState.selection;
          for (const headingPos of collapsed) {
            const node = newState.doc.nodeAt(headingPos);
            if (!node || node.type.name !== "heading") continue;
            const range = getCollapsedRange(
              newState.doc,
              headingPos,
              node.attrs.level
            );
            if (!range) continue;
            if (from < range.to && to > range.from) {
              return newState.tr.setMeta(pluginKey, { expand: headingPos });
            }
          }
          return null;
        },
      });
      return [plugin];
    },
  });
}
