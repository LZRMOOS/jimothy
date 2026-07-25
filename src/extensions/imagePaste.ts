import { Extension } from "@tiptap/core";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { invoke } from "@tauri-apps/api/core";
import { convertFileSrc } from "@tauri-apps/api/core";
import TiptapImage from "@tiptap/extension-image";

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
  if (src.startsWith("/")) {
    return convertFileSrc(src);
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

export function createImageExtension(notesFolderRef: { current: string | null }) {
  return TiptapImage.extend({
    renderHTML({ HTMLAttributes }) {
      const resolved = resolveImageSrc(HTMLAttributes.src, notesFolderRef.current);
      return ["img", { ...HTMLAttributes, src: resolved }];
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
