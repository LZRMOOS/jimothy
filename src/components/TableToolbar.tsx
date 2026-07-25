import { useEffect, useState, useCallback } from "react";
import type { Editor } from "@tiptap/react";

// Floating controls for the table the cursor is currently inside. Modeled on
// the image resize toolbar: it only shows when relevant and drives the standard
// Tiptap table commands. No merge/split (GFM tables are strictly rectangular).
type Props = { editor: Editor };

type Rect = { top: number; left: number } | null;

export function TableToolbar({ editor }: Props) {
  const [pos, setPos] = useState<Rect>(null);

  const update = useCallback(() => {
    if (!editor || editor.isDestroyed) {
      setPos(null);
      return;
    }
    if (!editor.isEditable || !editor.isActive("table")) {
      setPos(null);
      return;
    }
    // Find the DOM node for the table wrapping the current selection.
    const dom = editor.view.domAtPos(editor.state.selection.from)?.node as Node | undefined;
    const el = dom instanceof HTMLElement ? dom : dom?.parentElement ?? null;
    const table = el?.closest("table") as HTMLElement | null;
    const body = editor.view.dom.closest(".editor-body") as HTMLElement | null;
    if (!table || !body) {
      setPos(null);
      return;
    }
    const tableRect = table.getBoundingClientRect();
    const bodyRect = body.getBoundingClientRect();
    setPos({
      // Position relative to the scroll container so it tracks the table.
      top: tableRect.top - bodyRect.top + body.scrollTop - 34,
      left: tableRect.left - bodyRect.left,
    });
  }, [editor]);

  useEffect(() => {
    if (!editor) return;
    update();
    editor.on("selectionUpdate", update);
    editor.on("transaction", update);
    return () => {
      editor.off("selectionUpdate", update);
      editor.off("transaction", update);
    };
  }, [editor, update]);

  if (!pos) return null;

  // Keep focus in the editor so the table selection survives the button click.
  const guard = (e: React.MouseEvent) => e.preventDefault();

  return (
    <div
      className="table-toolbar"
      contentEditable={false}
      style={{ top: `${pos.top}px`, left: `${pos.left}px` }}
      onMouseDown={guard}
    >
      <button className="table-toolbar-btn" title="Add column before" onClick={() => editor.chain().focus().addColumnBefore().run()}>+Col ←</button>
      <button className="table-toolbar-btn" title="Add column after" onClick={() => editor.chain().focus().addColumnAfter().run()}>+Col →</button>
      <button className="table-toolbar-btn" title="Delete column" onClick={() => editor.chain().focus().deleteColumn().run()}>−Col</button>
      <span className="table-toolbar-sep" />
      <button className="table-toolbar-btn" title="Add row above" onClick={() => editor.chain().focus().addRowBefore().run()}>+Row ↑</button>
      <button className="table-toolbar-btn" title="Add row below" onClick={() => editor.chain().focus().addRowAfter().run()}>+Row ↓</button>
      <button className="table-toolbar-btn" title="Delete row" onClick={() => editor.chain().focus().deleteRow().run()}>−Row</button>
      <span className="table-toolbar-sep" />
      <button
        className="table-toolbar-btn"
        // GFM needs the first row to be the header, so this toggles the top row.
        title="Toggle header row"
        onClick={() => editor.chain().focus().toggleHeaderRow().run()}
      >Header</button>
      <span className="table-toolbar-sep" />
      <button className="table-toolbar-btn" title="Delete table" onClick={() => editor.chain().focus().deleteTable().run()}>Delete</button>
    </div>
  );
}
