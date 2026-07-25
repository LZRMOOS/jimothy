export type Note = {
  id: string;
  title: string;
  body: string;
  created_at: string;
  updated_at: string;
  encrypted: boolean;
  codex: string | null;
  archived: boolean;
};

export type SearchResult = {
  id: string;
  title: string;
  preview: string;
  score: number;
  matchedInTitle: boolean;
  matchedInBody: boolean;
};

export type SaveStatus = "idle" | "unsaved" | "saving" | "saved" | "error";

export type VaultStatus = "plaintext" | "locked" | "unlocked";

export type ThemeColors = {
  accent?: string;
  accentHover?: string;
  bgPrimary?: string;
  bgSecondary?: string;
  bgSelected?: string;
  textPrimary?: string;
  textSecondary?: string;
};

export type ColorPreset = {
  name: string;
  mode: "light" | "dark";
  colors: ThemeColors;
};

export type VaultProfile = {
  name: string;
  path: string;
  color?: string;
};

export type LocalSettings = {
  notesFolder?: string;
  showTrayIcon?: boolean;
  launchMinimized?: boolean;
  zoomLevel?: number;
  globalShortcut?: string;
  captureShortcut?: string;
  vaultProfiles?: VaultProfile[];
};

export type Preferences = {
  theme?: "system" | "light" | "dark";
  confirmDelete?: boolean;
  idleLockMinutes?: number;
  defaultCodex?: string | null;
  tocDefault?: boolean;
  dailyNoteCodex?: string | null;
  dailyNoteFormat?: string;
  codexIcons?: Record<string, string>;
  codexColors?: Record<string, string>;
  tagColors?: Record<string, string>;
  pinnedNotes?: string[];
  frozenNotes?: string[];
  pinnedCommands?: string[];
  hiddenCommands?: string[];
  protectedNotes?: string[];
  macros?: Record<string, string>;
  dictionary?: string[];
  colorsLight?: ThemeColors;
  colorsDark?: ThemeColors;
  colorPresets?: ColorPreset[];
};

export type AppSettings = LocalSettings & Preferences;
