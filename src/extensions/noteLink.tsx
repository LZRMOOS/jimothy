import { ReactRenderer } from "@tiptap/react";
import { Node, mergeAttributes } from "@tiptap/core";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { forwardRef, useEffect, useImperativeHandle, useState, useRef } from "react";
import type { SuggestionKeyDownProps } from "@tiptap/suggestion";
import Suggestion from "@tiptap/suggestion";

type NoteItem = { id: string; title: string; codex?: string | null };

type ListProps = {
  items: NoteItem[];
  command: (item: NoteItem) => void;
};

type ListRef = {
  onKeyDown: (props: SuggestionKeyDownProps) => boolean;
};

const NoteLinkList = forwardRef<ListRef, ListProps>((props, ref) => {
  const [selectedIndex, setSelectedIndex] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setSelectedIndex(0);
  }, [props.items]);

  useEffect(() => {
    const el = listRef.current?.children[selectedIndex] as HTMLElement | undefined;
    el?.scrollIntoView({ block: "nearest" });
  }, [selectedIndex]);

  useImperativeHandle(ref, () => ({
    onKeyDown: ({ event }: SuggestionKeyDownProps) => {
      if (event.key === "ArrowUp") {
        setSelectedIndex((i) => (i - 1 + props.items.length) % props.items.length);
        return true;
      }
      if (event.key === "ArrowDown") {
        setSelectedIndex((i) => (i + 1) % props.items.length);
        return true;
      }
      if (event.key === "Enter") {
        if (props.items[selectedIndex]) {
          props.command(props.items[selectedIndex]);
        }
        return true;
      }
      if (event.key === "Escape") {
        return true;
      }
      return false;
    },
  }));

  if (props.items.length === 0) {
    return (
      <div className="note-link-menu">
        <div className="note-link-empty">No matching notes</div>
      </div>
    );
  }

  return (
    <div className="note-link-menu" ref={listRef}>
      {props.items.map((item, i) => (
        <button
          key={item.id}
          className={`note-link-item${i === selectedIndex ? " selected" : ""}`}
          onClick={() => props.command(item)}
          onMouseEnter={() => setSelectedIndex(i)}
        >
          <span className="note-link-item-title">{item.title}</span>
          {item.codex && <span className="note-link-item-codex">{item.codex}</span>}
        </button>
      ))}
    </div>
  );
});

NoteLinkList.displayName = "NoteLinkList";

export function createNoteLinkExtension(
  notesRef: React.MutableRefObject<NoteItem[]>,
  onNavigateRef: React.MutableRefObject<(id: string) => void>,
) {
  return Node.create({
    name: "noteLink",
    group: "inline",
    inline: true,
    atom: true,

    addAttributes() {
      return {
        id: { default: null },
        label: { default: null },
      };
    },

    parseHTML() {
      return [{
        tag: 'span[data-type="noteLink"]',
        getAttrs: (el: HTMLElement) => ({
          id: el.getAttribute("data-id"),
          label: el.getAttribute("data-label") || el.textContent,
        }),
      }];
    },

    renderHTML({ HTMLAttributes }) {
      return ["span", mergeAttributes(HTMLAttributes, {
        "data-type": "noteLink",
        class: "note-link",
      }), HTMLAttributes.label || ""];
    },

    addProseMirrorPlugins() {
      const navigateRef = onNavigateRef;
      return [
        Suggestion({
          editor: this.editor,
          char: "@",
          pluginKey: new PluginKey("noteLink"),
          items: ({ query }) => {
            const q = query.toLowerCase();
            return notesRef.current
              .filter((n) => n.title.toLowerCase().includes(q))
              .slice(0, 8);
          },
          command: ({ editor, range, props: item }) => {
            editor
              .chain()
              .focus()
              .deleteRange(range)
              .insertContent({
                type: "noteLink",
                attrs: { id: item.id, label: item.title },
              })
              .insertContent(" ")
              .run();
          },
          render: () => {
            let component: ReactRenderer<ListRef> | null = null;
            let popup: HTMLDivElement | null = null;

            const positionPopup = (rect: DOMRect | null) => {
              if (!rect || !popup) return;
              const menuHeight = popup.offsetHeight || 200;
              const spaceBelow = window.innerHeight - rect.bottom;
              if (spaceBelow < menuHeight + 8) {
                popup.style.left = `${rect.left}px`;
                popup.style.top = `${rect.top - menuHeight - 4}px`;
              } else {
                popup.style.left = `${rect.left}px`;
                popup.style.top = `${rect.bottom + 4}px`;
              }
            };

            return {
              onStart: (props) => {
                component = new ReactRenderer(NoteLinkList, {
                  props: { items: props.items, command: props.command },
                  editor: props.editor,
                });

                popup = document.createElement("div");
                popup.className = "note-link-popup";
                popup.appendChild(component.element);
                document.body.appendChild(popup);

                const rect = props.clientRect?.();
                positionPopup(rect ?? null);
              },
              onUpdate: (props) => {
                component?.updateProps({ items: props.items, command: props.command });
                const rect = props.clientRect?.();
                positionPopup(rect ?? null);
              },
              onKeyDown: (props) => {
                if (props.event.key === "Escape") {
                  popup?.remove();
                  popup = null;
                  component?.destroy();
                  component = null;
                  return true;
                }
                return component?.ref?.onKeyDown(props) ?? false;
              },
              onExit: () => {
                popup?.remove();
                popup = null;
                component?.destroy();
                component = null;
              },
            };
          },
        }),
        new Plugin({
          props: {
            handleClick(view, pos) {
              const resolved = view.state.doc.resolve(pos);
              const node = resolved.nodeAfter || resolved.nodeBefore;
              if (node?.type.name === "noteLink" && node.attrs.id) {
                navigateRef.current(node.attrs.id);
                return true;
              }
              return false;
            },
          },
        }),
      ];
    },

    addStorage() {
      return {
        markdown: {
          serialize(state: any, node: any) {
            const currentNote = notesRef.current.find((n: NoteItem) => n.id === node.attrs.id);
            const label = currentNote?.title || node.attrs.label;
            state.write(`[${label}](scratch://${node.attrs.id})`);
          },
          parse: {
            setup(md: any) {
              const defaultLinkOpen = md.renderer.rules.link_open ||
                function (tokens: any, idx: any, options: any, _env: any, self: any) {
                  return self.renderToken(tokens, idx, options);
                };
              const defaultLinkClose = md.renderer.rules.link_close ||
                function (tokens: any, idx: any, options: any, _env: any, self: any) {
                  return self.renderToken(tokens, idx, options);
                };

              md.renderer.rules.link_open = function (tokens: any, idx: any, options: any, env: any, self: any) {
                const href = tokens[idx].attrGet("href");
                if (href && href.startsWith("scratch://")) {
                  const id = href.slice(10);
                  const textToken = tokens[idx + 1];
                  const currentNote = notesRef.current.find((n) => n.id === id);
                  const label = currentNote?.title || textToken?.content || id;
                  if (textToken) textToken.content = label;
                  return `<span data-type="noteLink" data-id="${id}" data-label="${label}" class="note-link">`;
                }
                return defaultLinkOpen(tokens, idx, options, env, self);
              };

              md.renderer.rules.link_close = function (tokens: any, idx: any, options: any, env: any, self: any) {
                // Find the matching link_open to check if it was a scratch:// link
                for (let i = idx - 1; i >= 0; i--) {
                  if (tokens[i].type === "link_open") {
                    const href = tokens[i].attrGet("href");
                    if (href && href.startsWith("scratch://")) {
                      return "</span>";
                    }
                    break;
                  }
                }
                return defaultLinkClose(tokens, idx, options, env, self);
              };
            },
          },
        },
      };
    },
  });
}
