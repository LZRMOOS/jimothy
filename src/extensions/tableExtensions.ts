import { Table } from "@tiptap/extension-table";
import { TableRow } from "@tiptap/extension-table-row";
import { TableHeader } from "@tiptap/extension-table-header";
import { TableCell } from "@tiptap/extension-table-cell";

// GFM pipe tables. Storage stays plain-text Markdown, so notes remain portable
// and diff-friendly (same philosophy as the rest of the app). tiptap-markdown
// handles the serialize/parse round-trip by node name, and markdown-it parses
// GFM tables out of the box, so we just register the standard Tiptap nodes.
//
// Caveat baked into GFM: tables are strictly rectangular. No merged/spanning
// cells and no block content inside a cell. That's why we leave mergeCells off
// the toolbar and keep column resizing enabled purely as a display convenience
// (widths aren't persisted to Markdown).
export function createTableExtensions() {
  return [
    Table.configure({
      resizable: true,
      // Keep the header row so the table serializes as valid GFM (which
      // requires a header + delimiter row).
      HTMLAttributes: { class: "editor-table" },
    }),
    TableRow,
    TableHeader,
    TableCell,
  ];
}
