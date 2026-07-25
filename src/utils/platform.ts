// Platform detection + modifier-key labels, in one place so the whole app
// agrees on what to show. `navigator.platform` is deprecated and, in WebView2
// on Windows, has historically reported inconsistent values — so we prefer the
// newer `userAgentData.platform` and fall back to the user agent string before
// touching `navigator.platform`.
function detectMac(): boolean {
  const nav = navigator as Navigator & {
    userAgentData?: { platform?: string };
  };
  const uaPlatform = nav.userAgentData?.platform;
  if (uaPlatform) return uaPlatform.toUpperCase().includes("MAC");
  if (navigator.userAgent) {
    const ua = navigator.userAgent.toUpperCase();
    if (ua.includes("WIN")) return false;
    if (ua.includes("MAC")) return true;
  }
  return (navigator.platform || "").toUpperCase().includes("MAC");
}

export const isMac = detectMac();

// Symbol form (⌘, ⇧, ⌥) used in compact shortcut hints; on Windows we spell
// them out with a trailing separator so `${mod}K` reads "Ctrl+K".
export const mod = isMac ? "⌘" : "Ctrl+";
export const shift = isMac ? "⇧" : "Shift+";
export const alt = isMac ? "⌥" : "Alt+";

// Word form ("Cmd", "Ctrl") for places that render modifiers as text.
export const modName = isMac ? "Cmd" : "Ctrl";
export const altName = isMac ? "Opt" : "Alt";
export const superName = isMac ? "Cmd" : "Win";
