export function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function buildSearchPattern(query: string): RegExp | null {
  if (!query.trim()) return null;
  const terms = query.trim().split(/\s+/).filter(Boolean);
  const pattern = terms.map(escapeRegex).join("|");
  return new RegExp(pattern, "gi");
}
