import { describe, it, expect } from "vitest";
import { splitSettings, isLocalKey, LOCAL_KEYS } from "./settings";
import type { AppSettings } from "../types";

describe("splitSettings", () => {
  it("routes device-local keys to local", () => {
    const settings: AppSettings = {
      notesFolder: "/notes",
      showTrayIcon: true,
      zoomLevel: 110,
      globalShortcut: "Ctrl+Shift+Space",
      captureShortcut: "Ctrl+Alt+Space",
      vaultProfiles: [{ name: "Work", path: "/notes", color: "#ff0000" }],
    };
    const { local, prefs } = splitSettings(settings);
    expect(local.vaultProfiles).toEqual([{ name: "Work", path: "/notes", color: "#ff0000" }]);
    expect(local.captureShortcut).toBe("Ctrl+Alt+Space");
    // None of the local keys should have leaked into the synced prefs.
    expect(Object.keys(prefs)).toHaveLength(0);
  });

  it("routes portable keys (macros, dictionary, theme, ...) to prefs", () => {
    const settings: AppSettings = {
      theme: "dark",
      macros: { "/sig": "Best,\nWei" },
      dictionary: ["Jimothy", "Tauri"],
      tagColors: { urgent: "#f00" },
    };
    const { local, prefs } = splitSettings(settings);
    expect(prefs.macros).toEqual({ "/sig": "Best,\nWei" });
    expect(prefs.dictionary).toEqual(["Jimothy", "Tauri"]);
    expect(prefs.theme).toBe("dark");
    expect(prefs.tagColors).toEqual({ urgent: "#f00" });
    expect(Object.keys(local)).toHaveLength(0);
  });

  it("drops undefined values from both halves", () => {
    const settings = { notesFolder: undefined, theme: undefined } as AppSettings;
    const { local, prefs } = splitSettings(settings);
    expect(local).toEqual({});
    expect(prefs).toEqual({});
  });

  it("keeps vault-profile colors attached to their profile in local", () => {
    const settings: AppSettings = {
      vaultProfiles: [
        { name: "A", path: "/a", color: "#123456" },
        { name: "B", path: "/b" },
      ],
    };
    const { local } = splitSettings(settings);
    expect(local.vaultProfiles?.[0].color).toBe("#123456");
    expect(local.vaultProfiles?.[1].color).toBeUndefined();
  });

  it("isLocalKey agrees with LOCAL_KEYS", () => {
    for (const k of LOCAL_KEYS) expect(isLocalKey(k)).toBe(true);
    expect(isLocalKey("macros")).toBe(false);
    expect(isLocalKey("theme")).toBe(false);
  });
});
