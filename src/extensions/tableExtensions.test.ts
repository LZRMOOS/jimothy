import { describe, it, expect } from "vitest";
import { Editor } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { Markdown } from "tiptap-markdown";
import { createTableExtensions } from "./tableExtensions";

function makeEditor(content: string): Editor {
  return new Editor({
    extensions: [
      StarterKit,
      Markdown.configure({ html: false, transformPastedText: true, transformCopiedText: false }),
      ...createTableExtensions(),
    ],
    content,
  });
}

function getMarkdown(editor: Editor): string {
  return (editor.storage as any).markdown.getMarkdown();
}

describe("GFM table round-trip", () => {
  it("parses a GFM pipe table into a table node", () => {
    const md = `| Name | Role |\n| --- | --- |\n| Ann | Dev |\n| Bob | PM |`;
    const editor = makeEditor(md);
    let tables = 0;
    let cells = 0;
    editor.state.doc.descendants((node) => {
      if (node.type.name === "table") tables++;
      if (node.type.name === "tableCell" || node.type.name === "tableHeader") cells++;
    });
    expect(tables).toBe(1);
    // 2 columns x 3 rows (header + 2 body) = 6 cells
    expect(cells).toBe(6);
    editor.destroy();
  });

  it("serializes a table back to GFM markdown", () => {
    const md = `| Name | Role |\n| --- | --- |\n| Ann | Dev |`;
    const editor = makeEditor(md);
    const out = getMarkdown(editor);
    expect(out).toContain("| Name | Role |");
    expect(out).toContain("| --- | --- |");
    expect(out).toContain("| Ann | Dev |");
    editor.destroy();
  });

  it("survives a full parse -> serialize -> parse cycle", () => {
    const md = `| A | B |\n| --- | --- |\n| 1 | 2 |`;
    const first = makeEditor(md);
    const serialized = getMarkdown(first);
    first.destroy();

    const second = makeEditor(serialized);
    let tables = 0;
    second.state.doc.descendants((node) => {
      if (node.type.name === "table") tables++;
    });
    expect(tables).toBe(1);
    second.destroy();
  });

  it("preserves inline formatting inside cells", () => {
    const md = `| Col |\n| --- |\n| **bold** |`;
    const editor = makeEditor(md);
    const out = getMarkdown(editor);
    expect(out).toContain("**bold**");
    editor.destroy();
  });
});
