import type { AppSettings, LocalSettings, Preferences } from "../types";

// The single definition of which settings are device-local (settings.json) vs
// portable/synced (.scratch/preferences.json). Everything not listed here is
// treated as portable. Keeping this in one place stops the load path, the save
// path, and the migration step from drifting out of sync — a mismatch silently
// sends local-only keys (like vaultProfiles) into the synced file, or drops a
// newly added preference on save.
export const LOCAL_KEYS: (keyof LocalSettings)[] = [
  "notesFolder",
  "showTrayIcon",
  "launchMinimized",
  "zoomLevel",
  "globalShortcut",
  "globalShortcut2",
  "captureShortcut",
  "captureShortcut2",
  "vaultProfiles",
];

export function isLocalKey(key: string): key is keyof LocalSettings {
  return (LOCAL_KEYS as string[]).includes(key);
}

// Partition a full settings object into the local and portable halves. Any key
// present on `settings` lands in exactly one bucket; keys with `undefined`
// values are dropped (nothing to persist).
export function splitSettings(settings: AppSettings): {
  local: LocalSettings;
  prefs: Preferences;
} {
  const local: LocalSettings = {};
  const prefs: Preferences = {};
  for (const [k, v] of Object.entries(settings)) {
    if (v === undefined) continue;
    if (isLocalKey(k)) {
      (local as Record<string, unknown>)[k] = v;
    } else {
      (prefs as Record<string, unknown>)[k] = v;
    }
  }
  return { local, prefs };
}
