import { useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { AppSettings } from "../types";

const clamp = (v: number) => Math.max(0, Math.min(255, v));
const hexRgb = (hex: string) => [
  parseInt(hex.slice(1, 3), 16),
  parseInt(hex.slice(3, 5), 16),
  parseInt(hex.slice(5, 7), 16),
];

async function loadSettings(): Promise<AppSettings> {
  const settingsRaw = await invoke<string>("get_app_settings");
  const settings: AppSettings = JSON.parse(settingsRaw);
  try {
    const prefsRaw = await invoke<string>("get_preferences");
    const prefs = JSON.parse(prefsRaw);
    return { ...settings, ...prefs };
  } catch {
    return settings;
  }
}

function applyTheme(settings: AppSettings) {
  const root = document.documentElement;
  const mq = window.matchMedia("(prefers-color-scheme: dark)");
  const theme = settings.theme || "system";

  if (theme === "system") {
    root.setAttribute("data-theme", mq.matches ? "dark" : "light");
  } else {
    root.setAttribute("data-theme", theme);
  }

  const isDark = root.getAttribute("data-theme") === "dark";
  const colors = isDark ? settings.colorsDark : settings.colorsLight;

  const ALL_PROPS = [
    "--accent", "--accent-subtle", "--accent-hover",
    "--bg-primary", "--bg-secondary", "--bg-tertiary", "--bg-hover", "--bg-selected",
    "--text-primary", "--text-secondary", "--text-hint",
  ];

  const props: Record<string, string | null> = {};
  for (const p of ALL_PROPS) props[p] = null;

  if (colors?.accent) {
    const [r, g, b] = hexRgb(colors.accent);
    props["--accent"] = colors.accent;
    props["--accent-subtle"] = `rgba(${r}, ${g}, ${b}, ${isDark ? 0.1 : 0.08})`;
  }
  if (colors?.accentHover) props["--accent-hover"] = colors.accentHover;

  if (colors?.bgPrimary) {
    const [r, g, b] = hexRgb(colors.bgPrimary);
    const shift = isDark ? 12 : -8;
    const hoverShift = isDark ? 6 : -4;
    props["--bg-primary"] = colors.bgPrimary;
    props["--bg-tertiary"] = `rgb(${clamp(r + shift)}, ${clamp(g + shift)}, ${clamp(b + shift)})`;
    props["--bg-hover"] = `rgb(${clamp(r + hoverShift)}, ${clamp(g + hoverShift)}, ${clamp(b + hoverShift)})`;
  }
  if (colors?.bgSecondary) props["--bg-secondary"] = colors.bgSecondary;
  if (colors?.bgSelected) props["--bg-selected"] = colors.bgSelected;
  if (colors?.textPrimary) props["--text-primary"] = colors.textPrimary;

  if (colors?.textSecondary) {
    const [r, g, b] = hexRgb(colors.textSecondary);
    const hintShift = isDark ? -20 : 20;
    props["--text-secondary"] = colors.textSecondary;
    props["--text-hint"] = `rgb(${clamp(r + hintShift)}, ${clamp(g + hintShift)}, ${clamp(b + hintShift)})`;
  }

  for (const [prop, value] of Object.entries(props)) {
    if (value) {
      root.style.setProperty(prop, value);
    } else {
      root.style.removeProperty(prop);
    }
  }
}

export function ScratchpadTheme() {
  useEffect(() => {
    loadSettings().then(applyTheme).catch(() => {
      const mq = window.matchMedia("(prefers-color-scheme: dark)");
      document.documentElement.setAttribute("data-theme", mq.matches ? "dark" : "light");
    });

    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const handler = () => loadSettings().then(applyTheme).catch(() => {});
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, []);

  useEffect(() => {
    const handleFocus = () => {
      loadSettings().then(applyTheme).catch(() => {});
    };
    window.addEventListener("focus", handleFocus);
    return () => window.removeEventListener("focus", handleFocus);
  }, []);

  return null;
}
