import { Extension } from "@tiptap/core";
import { Plugin } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";

const TAG_REGEX = /(?:^|[\s(])(#[a-zA-Z]\w*)/g;

export function createTagHighlightExtension() {
  let cachedDoc: any = null;
  let cachedDecos: DecorationSet = DecorationSet.empty;

  return Extension.create({
    name: "tagHighlight",
    addProseMirrorPlugins() {
      return [
        new Plugin({
          props: {
            decorations(state) {
              if (state.doc === cachedDoc) return cachedDecos;
              cachedDoc = state.doc;
              const decorations: Decoration[] = [];

              state.doc.descendants((node, pos) => {
                if (!node.isText) return;
                const text = node.text || "";

                TAG_REGEX.lastIndex = 0;
                let match;
                while ((match = TAG_REGEX.exec(text)) !== null) {
                  const tagText = match[1];
                  const startInMatch = match[0].indexOf("#");
                  const from = pos + match.index + startInMatch;
                  const to = from + tagText.length;
                  decorations.push(
                    Decoration.inline(from, to, { class: "inline-tag" })
                  );
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
