import { ReactRenderer } from "@tiptap/react";
import { Node, mergeAttributes } from "@tiptap/core";
import { PluginKey } from "@tiptap/pm/state";
import { forwardRef, useEffect, useImperativeHandle, useState, useRef } from "react";
import type { SuggestionKeyDownProps } from "@tiptap/suggestion";
import Suggestion from "@tiptap/suggestion";
import { convertFileSrc } from "@tauri-apps/api/core";

export type EmojiEntry = { name: string; path: string };

/** Resolve a custom-emoji name to an asset:// URL the webview can load. */
export function resolveEmojiSrc(
  name: string,
  emojis: EmojiEntry[],
): string | null {
  const match = emojis.find((e) => e.name === name);
  if (!match) return null;
  return convertFileSrc(match.path);
}

type ListProps = {
  items: EmojiEntry[];
  command: (item: EmojiEntry) => void;
};

type ListRef = {
  onKeyDown: (props: SuggestionKeyDownProps) => boolean;
};

const EmojiList = forwardRef<ListRef, ListProps>((props, ref) => {
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
      if (event.key === "Enter" || event.key === "Tab") {
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
        <div className="mention-empty">No matching emoji</div>
      </div>
    );
  }

  return (
    <div className="mention-menu" ref={listRef}>
      {props.items.map((item, i) => (
        <button
          key={item.name}
          className={`mention-item emoji-item${i === selectedIndex ? " selected" : ""}`}
          onClick={() => props.command(item)}
          onMouseEnter={() => setSelectedIndex(i)}
        >
          <img className="emoji-item-img" src={convertFileSrc(item.path)} alt={item.name} />
          <span>:{item.name}:</span>
        </button>
      ))}
    </div>
  );
});

EmojiList.displayName = "EmojiList";

export function createEmojiExtension(
  emojisRef: React.MutableRefObject<EmojiEntry[]>,
) {
  return Node.create({
    name: "emoji",
    group: "inline",
    inline: true,
    atom: true,

    addAttributes() {
      return {
        name: { default: null },
      };
    },

    parseHTML() {
      return [{
        tag: 'img[data-type="emoji"]',
        getAttrs: (el: HTMLElement) => ({
          name: el.getAttribute("data-name"),
        }),
      }];
    },

    renderHTML({ HTMLAttributes }) {
      const name = HTMLAttributes.name || "";
      const src = resolveEmojiSrc(name, emojisRef.current);
      if (!src) {
        // Missing emoji (e.g. mid-sync): fall back to the shortcode text.
        return ["span", { class: "emoji-missing" }, `:${name}:`];
      }
      return ["img", mergeAttributes(HTMLAttributes, {
        "data-type": "emoji",
        "data-name": name,
        class: "emoji",
        src,
        alt: `:${name}:`,
        title: `:${name}:`,
        draggable: "false",
      })];
    },

    addProseMirrorPlugins() {
      return [
        Suggestion({
          editor: this.editor,
          char: ":",
          pluginKey: new PluginKey("emoji"),
          items: ({ query }) => {
            const q = query.toLowerCase();
            return emojisRef.current
              .filter((e) => e.name.toLowerCase().includes(q))
              .slice(0, 8);
          },
          command: ({ editor, range, props: item }) => {
            editor
              .chain()
              .focus()
              .deleteRange(range)
              .insertContent({
                type: "emoji",
                attrs: { name: item.name },
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
                component = new ReactRenderer(EmojiList, {
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
      const emojisRefLocal = emojisRef;
      return {
        markdown: {
          serialize(state: any, node: any) {
            state.write(`:${node.attrs.name}:`);
          },
          parse: {
            setup(md: any) {
              const defaultTextRule = md.renderer.rules.text ||
                function (tokens: any, idx: any) { return tokens[idx].content; };

              md.renderer.rules.text = function (tokens: any, idx: any, options: any, env: any, self: any) {
                const content = tokens[idx].content;
                const emojiRegex = /:([a-zA-Z0-9_-]+):/g;
                let result = "";
                let lastIndex = 0;
                let match;

                while ((match = emojiRegex.exec(content)) !== null) {
                  const name = match[1];
                  if (emojisRefLocal.current.some((e) => e.name === name)) {
                    result += content.slice(lastIndex, match.index);
                    const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
                    result += `<img data-type="emoji" data-name="${esc(name)}" class="emoji" alt=":${esc(name)}:" />`;
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
