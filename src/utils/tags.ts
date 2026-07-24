const TAG_REGEX = /(?:^|[\s(])#([a-zA-Z]\w*)/g;

export function extractTags(body: string): string[] {
  const tags = new Set<string>();
  let match;
  TAG_REGEX.lastIndex = 0;
  while ((match = TAG_REGEX.exec(body)) !== null) {
    tags.add(match[1].toLowerCase());
  }
  return Array.from(tags).sort();
}

export function noteHasTag(body: string, tag: string): boolean {
  const lower = tag.toLowerCase();
  const regex = /(?:^|[\s(])#([a-zA-Z]\w*)/g;
  let match;
  while ((match = regex.exec(body)) !== null) {
    if (match[1].toLowerCase() === lower) return true;
  }
  return false;
}
