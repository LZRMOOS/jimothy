import { Extension } from "@tiptap/core";
import { Plugin } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";

const TAG_REGEX = /(?:^|[\s(])(#[a-zA-Z]\w*)/g;

export function createTagHighlightExtension(
  tagColorsRef: { current: Record<string, string> | undefined }
) {
  let cachedDoc: any = null;
  let cachedColors: Record<string, string> | undefined = undefined;
  let cachedDecos: DecorationSet = DecorationSet.empty;

  return Extension.create({
    name: "tagHighlight",
    addProseMirrorPlugins() {
      return [
        new Plugin({
          props: {
            decorations(state) {
              const colors = tagColorsRef.current;
              if (state.doc === cachedDoc && colors === cachedColors) return cachedDecos;
              cachedDoc = state.doc;
              cachedColors = colors;
              const decorations: Decoration[] = [];

              state.doc.descendants((node, pos) => {
                if (!node.isText) return;
                const text = node.text || "";

                TAG_REGEX.lastIndex = 0;
                let match;
                while ((match = TAG_REGEX.exec(text)) !== null) {
                  const tagText = match[1];
                  const tagName = tagText.slice(1).toLowerCase();
                  const startInMatch = match[0].indexOf("#");
                  const from = pos + match.index + startInMatch;
                  const to = from + tagText.length;
                  const color = colors?.[tagName];
                  const attrs: Record<string, string> = { class: "inline-tag" };
                  if (color) {
                    attrs.style = `color: ${color}; background: ${color}20;`;
                  }
                  decorations.push(Decoration.inline(from, to, attrs));
                }
              });

              cachedDecos = DecorationSet.create(state.doc, decorations);
              return cachedDecos;
            },
          },
        }),
      ];
    },
  });
}
