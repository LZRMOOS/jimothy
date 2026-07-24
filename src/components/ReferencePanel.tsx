import { useEffect } from "react";

const isMac = navigator.platform.toUpperCase().includes("MAC");
const mod = isMac ? "⌘" : "Ctrl";

export type ReferencePanelMode = "markdown" | "controls";

type Props = {
  mode: ReferencePanelMode;
  macros?: Record<string, string>;
  onClose: () => void;
};

export function ReferencePanel({ mode, macros, onClose }: Props) {
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      }
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [onClose]);

  return (
    <div className="reference-panel">
      <div className="reference-panel-header">
        <h3>{mode === "markdown" ? "Markdown" : "Controls"}</h3>
        <button className="reference-panel-close" onClick={onClose}>&times;</button>
      </div>
      <div className="reference-panel-body">
        {mode === "markdown" && <MarkdownReference macros={macros} />}
        {mode === "controls" && <ControlsReference />}
      </div>
    </div>
  );
}

function MarkdownReference({ macros }: { macros?: Record<string, string> }) {
  const macroEntries = Object.entries(macros || {});

  return (
    <>
      <h4>Formatting</h4>
      <table className="ref-table">
        <tbody>
          <tr><td className="ref-syntax"># Heading 1</td><td>Large heading</td></tr>
          <tr><td className="ref-syntax">## Heading 2</td><td>Medium heading</td></tr>
          <tr><td className="ref-syntax">### Heading 3</td><td>Small heading</td></tr>
          <tr><td className="ref-syntax">**bold**</td><td>Bold text</td></tr>
          <tr><td className="ref-syntax">*italic*</td><td>Italic text</td></tr>
          <tr><td className="ref-syntax">~~strike~~</td><td>Strikethrough</td></tr>
          <tr><td className="ref-syntax">`code`</td><td>Inline code</td></tr>
        </tbody>
      </table>
      <h4>Blocks</h4>
      <table className="ref-table">
        <tbody>
          <tr><td className="ref-syntax">```lang</td><td>Code block</td></tr>
          <tr><td className="ref-syntax">&gt; quote</td><td>Blockquote</td></tr>
          <tr><td className="ref-syntax">---</td><td>Horizontal rule</td></tr>
        </tbody>
      </table>
      <h4>Lists</h4>
      <table className="ref-table">
        <tbody>
          <tr><td className="ref-syntax">- item</td><td>Bullet list</td></tr>
          <tr><td className="ref-syntax">1. item</td><td>Numbered list</td></tr>
          <tr><td className="ref-syntax">- [ ] task</td><td>Task item</td></tr>
          <tr><td className="ref-syntax">- [x] done</td><td>Completed task</td></tr>
        </tbody>
      </table>
      <h4>Links & References</h4>
      <table className="ref-table">
        <tbody>
          <tr><td className="ref-syntax">[text](url)</td><td>Hyperlink</td></tr>
          <tr><td className="ref-syntax">![alt](url)</td><td>Image</td></tr>
          <tr><td className="ref-syntax">[[note name</td><td>Link to note (autocomplete)</td></tr>
          <tr><td className="ref-syntax">#tag</td><td>Tag (searchable)</td></tr>
          <tr><td className="ref-syntax">@name</td><td>Dictionary mention</td></tr>
        </tbody>
      </table>
      <h4>Macros</h4>
      <table className="ref-table">
        <tbody>
          <tr><td className="ref-syntax">/date</td><td>Today's date</td></tr>
          <tr><td className="ref-syntax">/time</td><td>Current time</td></tr>
          {macroEntries.map(([trigger, expansion]) => (
            <tr key={trigger}><td className="ref-syntax">{trigger}</td><td>{expansion}</td></tr>
          ))}
        </tbody>
      </table>
      <h4>Task Priority</h4>
      <table className="ref-table">
        <tbody>
          <tr><td className="ref-syntax">!high</td><td>High priority (red)</td></tr>
          <tr><td className="ref-syntax">!med</td><td>Medium priority (orange)</td></tr>
          <tr><td className="ref-syntax">!low</td><td>Low priority (green)</td></tr>
          <tr><td className="ref-syntax">!2026-07-30</td><td>Due date (color shifts)</td></tr>
        </tbody>
      </table>
    </>
  );
}

function ControlsReference() {
  return (
    <>
      <h4>Search</h4>
      <table className="ref-table">
        <tbody>
          <tr><td className="ref-key">{mod}F</td><td>Find in note</td></tr>
          <tr><td className="ref-key">{mod}H</td><td>Find & replace</td></tr>
          <tr><td className="ref-key">{mod}]</td><td>Next match</td></tr>
          <tr><td className="ref-key">{mod}[</td><td>Previous match</td></tr>
          <tr><td className="ref-key">{mod}⇧F</td><td>Search notes</td></tr>
          <tr><td className="ref-key">{mod}K</td><td>Command palette</td></tr>
          <tr><td className="ref-key">#tag</td><td>Filter by tag</td></tr>
          <tr><td className="ref-key">@name</td><td>Filter by dictionary</td></tr>
        </tbody>
      </table>
      <h4>Notes</h4>
      <table className="ref-table">
        <tbody>
          <tr><td className="ref-key">{mod}N</td><td>New note</td></tr>
          <tr><td className="ref-key">{mod}J</td><td>Daily note</td></tr>
          <tr><td className="ref-key">↑ ↓</td><td>Navigate notes</td></tr>
          <tr><td className="ref-key">Enter</td><td>Edit note</td></tr>
          <tr><td className="ref-key">→</td><td>Expand backlinks</td></tr>
          <tr><td className="ref-key">←</td><td>Collapse backlinks</td></tr>
          <tr><td className="ref-key">{mod}⇧]</td><td>Next note</td></tr>
          <tr><td className="ref-key">{mod}⇧[</td><td>Previous note</td></tr>
        </tbody>
      </table>
      <h4>Editor</h4>
      <table className="ref-table">
        <tbody>
          <tr><td className="ref-key">[[</td><td>Link to note</td></tr>
          <tr><td className="ref-key">@</td><td>Dictionary mention</td></tr>
          <tr><td className="ref-key">/macro</td><td>Expand macro</td></tr>
        </tbody>
      </table>
      <h4>View</h4>
      <table className="ref-table">
        <tbody>
          <tr><td className="ref-key">{mod}/</td><td>Toggle sidebar</td></tr>
          <tr><td className="ref-key">{mod}T</td><td>Table of contents</td></tr>
          <tr><td className="ref-key">{mod}\</td><td>Split view</td></tr>
          <tr><td className="ref-key">{mod}1–9</td><td>Switch codex</td></tr>
          <tr><td className="ref-key">{mod}=</td><td>Zoom in</td></tr>
          <tr><td className="ref-key">{mod}-</td><td>Zoom out</td></tr>
          <tr><td className="ref-key">{mod}0</td><td>Reset zoom</td></tr>
        </tbody>
      </table>
      <h4>App</h4>
      <table className="ref-table">
        <tbody>
          <tr><td className="ref-key">{mod},</td><td>Settings</td></tr>
          <tr><td className="ref-key">{mod}.</td><td>Markdown reference</td></tr>
          <tr><td className="ref-key">{mod};</td><td>Controls reference</td></tr>
          <tr><td className="ref-key">Esc</td><td>Hide window</td></tr>
        </tbody>
      </table>
    </>
  );
}
