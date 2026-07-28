import { Extension } from "@tiptap/core";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { invoke } from "@tauri-apps/api/core";
import { convertFileSrc } from "@tauri-apps/api/core";
import TiptapImage from "@tiptap/extension-image";
import { ReactNodeViewRenderer, NodeViewWrapper, type ReactNodeViewProps } from "@tiptap/react";

function extensionFromMime(mime: string): string {
  if (mime === "image/png") return "png";
  if (mime === "image/jpeg" || mime === "image/jpg") return "jpg";
  if (mime === "image/gif") return "gif";
  if (mime === "image/webp") return "webp";
  return "png";
}

function resolveImageSrc(src: string, notesFolder: string | null): string {
  if (!src || src.startsWith("asset://") || src.startsWith("https://asset.localhost")) {
    return src;
  }
  if (src.startsWith("http://") || src.startsWith("https://")) {
    return src;
  }
  if (src.startsWith(".scratch/") && notesFolder) {
    return convertFileSrc(`${notesFolder}/${src}`);
  }
  // An absolute path only renders as an image when it's inside the active
  // notes folder — note bodies are synced/shared content, so resolving any
  // absolute path on disk would let a note leak arbitrary local files as an
  // inline image.
  if (src.startsWith("/")) {
    return notesFolder && src.startsWith(`${notesFolder}/`) ? convertFileSrc(src) : "";
  }
  if (notesFolder) {
    return convertFileSrc(`${notesFolder}/${src}`);
  }
  return src;
}

async function handleImageFile(file: File, notesFolder: string | null): Promise<string | null> {
  const buffer = await file.arrayBuffer();
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  const base64 = btoa(binary);
  const ext = extensionFromMime(file.type);

  const absolutePath = (await invoke("save_image", {
    data: base64,
    extension: ext,
  })) as string;

  if (notesFolder && absolutePath.startsWith(notesFolder + "/")) {
    return absolutePath.slice(notesFolder.length + 1);
  }
  return absolutePath;
}

// Preset sizes offered by the resize toolbar. `null` clears the width so the
// image falls back to its natural size (capped at the editor width by CSS).
const SIZE_PRESETS: { label: string; width: number | null }[] = [
  { label: "S", width: 150 },
  { label: "M", width: 300 },
  { label: "L", width: 500 },
  { label: "Full", width: null },
];

// Strip a trailing `|123` width marker from Obsidian-style alt text.
function stripWidthMarker(alt: string | null | undefined): string | null {
  if (!alt) return null;
  const cleaned = alt.replace(/\|\d+$/, "");
  return cleaned.length > 0 ? cleaned : null;
}

// Pull the width out of either a real width attribute or the `|123` alt marker.
function widthFromElement(el: HTMLElement): number | null {
  const attr = el.getAttribute("width");
  if (attr && /^\d+$/.test(attr)) return parseInt(attr, 10);
  const m = el.getAttribute("alt")?.match(/\|(\d+)$/);
  return m ? parseInt(m[1], 10) : null;
}

function ImageNodeView({ node, updateAttributes, deleteNode, selected, editor }: ReactNodeViewProps<HTMLElement>) {
  const notesFolder = (editor.storage as any).image?.notesFolder ?? null;
  const src = resolveImageSrc(node.attrs.src, notesFolder);
  const width: number | null = node.attrs.width ?? null;
  const active = selected && editor.isEditable;

  return (
    <NodeViewWrapper as="span" className="image-node" data-selected={active ? "true" : undefined}>
      <span className="image-node-inner">
        <img
          src={src}
          alt={node.attrs.alt || ""}
          title={node.attrs.title || undefined}
          style={width ? { width: `${width}px` } : undefined}
          draggable={false}
        />
        {active && (
          <>
            <button
              className="image-delete-btn"
              contentEditable={false}
              title="Remove image"
              aria-label="Remove image"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => deleteNode()}
            >
              ×
            </button>
            <span className="image-resize-toolbar" contentEditable={false}>
              {SIZE_PRESETS.map((p) => (
                <button
                  key={p.label}
                  className={`image-resize-btn${(p.width ?? null) === width ? " active" : ""}`}
                  // Keep focus in the editor so the node stays selected.
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => updateAttributes({ width: p.width })}
                >
                  {p.label}
                </button>
              ))}
            </span>
          </>
        )}
      </span>
    </NodeViewWrapper>
  );
}

export function createImageExtension(notesFolderRef: { current: string | null }) {
  return TiptapImage.extend({
    addStorage() {
      return {
        // Expose the current notes folder to the NodeView (which only receives
        // the editor, not our ref) and drive markdown (de)serialization.
        get notesFolder() {
          return notesFolderRef.current;
        },
        markdown: {
          // Obsidian-style: width rides after a pipe in the alt text, so the
          // file stays valid Markdown and other tools ignore the extra bit.
          serialize(state: any, node: any) {
            const alt = (node.attrs.alt || "").replace(/([\\[\]])/g, "\\$1");
            const width = node.attrs.width;
            const label = width ? `${alt}|${width}` : alt;
            const title = node.attrs.title ? ` "${node.attrs.title.replace(/"/g, '\\"')}"` : "";
            state.write(`![${label}](${node.attrs.src}${title})`);
          },
          parse: {
            // Handled by markdown-it; width is recovered from alt in parseHTML.
          },
        },
      };
    },

    addAttributes() {
      return {
        ...this.parent?.(),
        // Display width in pixels. null means natural size.
        width: {
          default: null,
          parseHTML: (element: HTMLElement) => widthFromElement(element),
          renderHTML: (attrs: Record<string, any>) =>
            attrs.width ? { width: attrs.width } : {},
        },
        // Strip the `|123` marker so it never shows as visible alt text.
        alt: {
          default: null,
          parseHTML: (element: HTMLElement) => stripWidthMarker(element.getAttribute("alt")),
          renderHTML: (attrs: Record<string, any>) =>
            attrs.alt ? { alt: attrs.alt } : {},
        },
      };
    },

    renderHTML({ HTMLAttributes }) {
      const resolved = resolveImageSrc(HTMLAttributes.src, notesFolderRef.current);
      return ["img", { ...HTMLAttributes, src: resolved }];
    },

    addNodeView() {
      return ReactNodeViewRenderer(ImageNodeView);
    },
  }).configure({ inline: true, allowBase64: true });
}

export function createImagePasteExtension(notesFolderRef: { current: string | null }) {
  return Extension.create({
    name: "imagePaste",

    addProseMirrorPlugins() {
      const editor = this.editor;
      return [
        new Plugin({
          key: new PluginKey("imagePaste"),
          props: {
            handlePaste(_view, event) {
              const items = event.clipboardData?.items;
              if (!items) return false;

              for (const item of items) {
                if (item.type.startsWith("image/")) {
                  const file = item.getAsFile();
                  if (!file) continue;
                  event.preventDefault();
                  handleImageFile(file, notesFolderRef.current).then((relativePath) => {
                    if (relativePath) {
                      editor.chain().focus().setImage({ src: relativePath }).run();
                    }
                  });
                  return true;
                }
              }
              return false;
            },
            handleDrop(_view, event) {
              const files = event.dataTransfer?.files;
              if (!files || files.length === 0) return false;

              for (const file of files) {
                if (file.type.startsWith("image/")) {
                  event.preventDefault();
                  handleImageFile(file, notesFolderRef.current).then((relativePath) => {
                    if (relativePath) {
                      editor.chain().focus().setImage({ src: relativePath }).run();
                    }
                  });
                  return true;
                }
              }
              return false;
            },
          },
        }),
      ];
    },
  });
}
