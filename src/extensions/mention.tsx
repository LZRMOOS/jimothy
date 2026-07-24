import { ReactRenderer } from "@tiptap/react";
import { Node, mergeAttributes } from "@tiptap/core";
import { PluginKey } from "@tiptap/pm/state";
import { forwardRef, useEffect, useImperativeHandle, useState, useRef } from "react";
import type { SuggestionKeyDownProps } from "@tiptap/suggestion";
import Suggestion from "@tiptap/suggestion";

type ListProps = {
  items: string[];
  command: (item: string) => void;
};

type ListRef = {
  onKeyDown: (props: SuggestionKeyDownProps) => boolean;
};

const MentionList = forwardRef<ListRef, ListProps>((props, ref) => {
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
      <div className="mention-menu">
        <div className="mention-empty">No matches</div>
      </div>
    );
  }

  return (
    <div className="mention-menu" ref={listRef}>
      {props.items.map((item, i) => (
        <button
          key={item}
          className={`mention-item${i === selectedIndex ? " selected" : ""}`}
          onClick={() => props.command(item)}
          onMouseEnter={() => setSelectedIndex(i)}
        >
          {item}
        </button>
      ))}
    </div>
  );
});

MentionList.displayName = "MentionList";

export function createMentionExtension(
  dictionaryRef: React.MutableRefObject<string[]>,
) {
  return Node.create({
    name: "mention",
    group: "inline",
    inline: true,
    atom: true,

    addAttributes() {
      return {
        label: { default: null },
      };
    },

    parseHTML() {
      return [{
        tag: 'span[data-type="mention"]',
        getAttrs: (el: HTMLElement) => ({
          label: el.getAttribute("data-label") || el.textContent?.replace(/^@/, ""),
        }),
      }];
    },

    renderHTML({ HTMLAttributes }) {
      return ["span", mergeAttributes(HTMLAttributes, {
        "data-type": "mention",
        "data-label": HTMLAttributes.label,
        class: "mention",
      }), `@${HTMLAttributes.label || ""}`];
    },

    addProseMirrorPlugins() {
      return [
        Suggestion({
          editor: this.editor,
          char: "@",
          pluginKey: new PluginKey("mention"),
          items: ({ query }) => {
            const q = query.toLowerCase();
            return dictionaryRef.current
              .filter((entry) => entry.toLowerCase().includes(q))
              .slice(0, 8);
          },
          command: ({ editor, range, props: item }) => {
            editor
              .chain()
              .focus()
              .deleteRange(range)
              .insertContent({
                type: "mention",
                attrs: { label: item },
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
                component = new ReactRenderer(MentionList, {
                  props: { items: props.items, command: props.command },
                  editor: props.editor,
                });

                popup = document.createElement("div");
                popup.className = "mention-popup";
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
      ];
    },

    addStorage() {
      return {
        markdown: {
          serialize(state: any, node: any) {
            state.write(`@${node.attrs.label}`);
          },
          parse: {
            setup(md: any) {
              const defaultTextRule = md.renderer.rules.text ||
                function (tokens: any, idx: any) { return tokens[idx].content; };

              md.renderer.rules.text = function (tokens: any, idx: any, options: any, env: any, self: any) {
                const content = tokens[idx].content;
                const mentionRegex = /@([^\s@]+(?:\s[^\s@]+)*?)(?=\s|$|[.,;:!?)])/g;
                let result = "";
                let lastIndex = 0;
                let match;

                while ((match = mentionRegex.exec(content)) !== null) {
                  const label = match[1];
                  if (dictionaryRef.current.some((d) => d.toLowerCase() === label.toLowerCase())) {
                    const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
                    result += content.slice(lastIndex, match.index);
                    result += `<span data-type="mention" data-label="${esc(label)}" class="mention">@${esc(label)}</span>`;
                    lastIndex = match.index + match[0].length;
                  }
                }

                if (lastIndex === 0) {
                  return defaultTextRule(tokens, idx, options, env, self);
                }
                result += content.slice(lastIndex);
                return result;
              };
            },
          },
        },
      };
    },
  });
}
