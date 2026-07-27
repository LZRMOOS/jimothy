import { useState, useEffect } from "react";
// On mac these are bare symbols (⌘⇧⌥); on Windows they spell out with a
// trailing "+" so a row like `{mod}{shift}F` reads "Ctrl+Shift+F".
import { mod, shift, alt } from "../utils/platform";

type Props = {
  macros?: Record<string, string>;
  onClose: () => void;
};

type Tab = "markdown" | "controls";

export function ReferencePanel({ macros, onClose }: Props) {
  const [tab, setTab] = useState<Tab>("markdown");

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
        <div className="reference-panel-tabs">
          <button
            className={`reference-panel-tab ${tab === "markdown" ? "active" : ""}`}
            onClick={() => setTab("markdown")}
          >
            Markdown
          </button>
          <button
            className={`reference-panel-tab ${tab === "controls" ? "active" : ""}`}
            onClick={() => setTab("controls")}
          >
            Controls
          </button>
        </div>
        <button className="reference-panel-close" onClick={onClose}>&times;</button>
      </div>
      <div className="reference-panel-body">
        {tab === "markdown" && <MarkdownReference macros={macros} />}
        {tab === "controls" && <ControlsReference />}
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
        </tbody>
      </table>
      <h4>Tasks</h4>
      <table className="ref-table">
        <tbody>
          <tr><td className="ref-syntax">- [ ] task</td><td>Task item</td></tr>
          <tr><td className="ref-syntax">- [x] done</td><td>Completed task</td></tr>
          <tr><td className="ref-syntax">!high</td><td>High priority (red)</td></tr>
          <tr><td className="ref-syntax">!med</td><td>Medium priority (orange)</td></tr>
          <tr><td className="ref-syntax">!low</td><td>Low priority (green)</td></tr>
          <tr><td className="ref-syntax">!YYYY-MM-DD</td><td>Due date (color shifts)</td></tr>
        </tbody>
      </table>
      <h4>Links & References</h4>
      <table className="ref-table">
        <tbody>
          <tr><td className="ref-syntax">[[note name</td><td>Link to note (autocomplete)</td></tr>
          <tr><td className="ref-syntax">#tag</td><td>Tag (searchable)</td></tr>
          <tr><td className="ref-syntax">@name</td><td>Dictionary mention</td></tr>
          <tr><td className="ref-syntax">:name:</td><td>Custom emoji</td></tr>
        </tbody>
      </table>
      <h4>Macros</h4>
      <table className="ref-table">
        <tbody>
          <tr><td className="ref-syntax">/date</td><td>Today's date</td></tr>
          <tr><td className="ref-syntax">/time</td><td>Current time</td></tr>
          <tr><td className="ref-syntax">/table</td><td>Insert a 2×2 table (or Insert Table in {mod}K)</td></tr>
          {macroEntries.map(([trigger, expansion]) => (
            <tr key={trigger}><td className="ref-syntax">{trigger}</td><td>{expansion}</td></tr>
          ))}
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
          <tr><td className="ref-key">{mod}] / [</td><td>Next / previous match</td></tr>
          <tr><td className="ref-key">{mod}{shift}F</td><td>Search notes</td></tr>
          <tr><td className="ref-key">{mod}K</td><td>Command palette</td></tr>
          <tr><td className="ref-key">#tag / @name</td><td>Filter by tag or mention</td></tr>
        </tbody>
      </table>
      <h4>Notes</h4>
      <table className="ref-table">
        <tbody>
          <tr><td className="ref-key">{mod}N</td><td>New note</td></tr>
          <tr><td className="ref-key">{mod}J</td><td>Daily note</td></tr>
          <tr><td className="ref-key">↑ ↓</td><td>Navigate notes</td></tr>
          <tr><td className="ref-key">← →</td><td>Collapse / expand backlinks</td></tr>
          <tr><td className="ref-key">Enter</td><td>Edit note</td></tr>
          <tr><td className="ref-key">{mod}{shift}] / [</td><td>Next / previous note</td></tr>
        </tbody>
      </table>
      <h4>Editor</h4>
      <table className="ref-table">
        <tbody>
          <tr><td className="ref-key">[[</td><td>Link to note</td></tr>
          <tr><td className="ref-key">@</td><td>Dictionary mention</td></tr>
          <tr><td className="ref-key">:</td><td>Custom emoji</td></tr>
          <tr><td className="ref-key">/macro</td><td>Expand macro</td></tr>
        </tbody>
      </table>
      <h4>View</h4>
      <table className="ref-table">
        <tbody>
          <tr><td className="ref-key">{mod}/</td><td>Toggle sidebar</td></tr>
          <tr><td className="ref-key">{mod}T</td><td>Tasks</td></tr>
          <tr><td className="ref-key">{mod}I</td><td>Index</td></tr>
          <tr><td className="ref-key">{mod}\</td><td>Split view</td></tr>
          <tr><td className="ref-key">{mod}1-9</td><td>Switch codex</td></tr>
          <tr><td className="ref-key">{mod}`</td><td>Tasks view</td></tr>
          <tr><td className="ref-key">{mod}= / -</td><td>Zoom in / out</td></tr>
          <tr><td className="ref-key">{mod}0</td><td>Reset zoom</td></tr>
        </tbody>
      </table>
      <h4>App</h4>
      <table className="ref-table">
        <tbody>
          <tr><td className="ref-key">{mod}{shift}Space</td><td>Summon window</td></tr>
          <tr><td className="ref-key">{mod}{alt}Space</td><td>Scratchpad</td></tr>
          <tr><td className="ref-key">{mod}W / Esc</td><td>Banish window</td></tr>
          <tr><td className="ref-key">{mod},</td><td>Settings</td></tr>
          <tr><td className="ref-key">{mod}.</td><td>Reference panel</td></tr>
        </tbody>
      </table>
    </>
  );
}
