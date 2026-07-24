import type { ReactNode } from "react";
import { createElement } from "react";

export function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function buildSearchPattern(query: string): RegExp | null {
  if (!query.trim()) return null;
  const terms = query.trim().split(/\s+/).filter(Boolean);
  const pattern = terms.map(escapeRegex).join("|");
  return new RegExp(pattern, "gi");
}

export function highlightMatches(text: string, query: string): ReactNode {
  const regex = buildSearchPattern(query);
  if (!regex) return text;
  const splitter = new RegExp(`(${regex.source})`, "gi");
  const parts = text.split(splitter);
  if (parts.length === 1) return text;
  const testRegex = new RegExp(regex.source, "i");
  return parts.map((part, i) =>
    testRegex.test(part)
      ? createElement("mark", { key: i, className: "search-highlight" }, part)
      : part
  );
}
