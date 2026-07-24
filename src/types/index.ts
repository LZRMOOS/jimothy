export type Note = {
  id: string;
  title: string;
  body: string;
  created_at: string;
  updated_at: string;
  encrypted: boolean;
  codex: string | null;
};

export type SearchResult = {
  id: string;
  title: string;
  preview: string;
  score: number;
  matchedInTitle: boolean;
  matchedInBody: boolean;
};

export type SaveStatus = "idle" | "saving" | "saved" | "error";

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

export type AppSettings = {
  notesFolder?: string;
  theme?: "system" | "light" | "dark";
  confirmDelete?: boolean;
  idleLockMinutes?: number;
  codexIcons?: Record<string, string>;
  showTrayIcon?: boolean;
  pinnedNotes?: string[];
  protectedNotes?: string[];
  zoomLevel?: number;
  globalShortcut?: string;
  macros?: Record<string, string>;
  colorsLight?: ThemeColors;
  colorsDark?: ThemeColors;
  colorPresets?: ColorPreset[];
};
