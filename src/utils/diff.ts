// Minimal line-based diff for the conflict resolver.
// Uses a longest-common-subsequence table so unchanged lines line up and only
// the genuinely different lines get flagged. Good enough for note bodies; we
// are not diffing giant files here.

export type DiffLine = {
  type: "equal" | "added" | "removed";
  text: string;
};

/**
 * Diff two blocks of text line by line.
 * `removed` lines exist only in `left`, `added` lines only in `right`.
 */
export function diffLines(left: string, right: string): DiffLine[] {
  const a = left.split("\n");
  const b = right.split("\n");
  const n = a.length;
  const m = b.length;

  // LCS length table.
  const lcs: number[][] = Array.from({ length: n + 1 }, () =>
    new Array<number>(m + 1).fill(0)
  );
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      lcs[i][j] =
        a[i] === b[j]
          ? lcs[i + 1][j + 1] + 1
          : Math.max(lcs[i + 1][j], lcs[i][j + 1]);
    }
  }

  const out: DiffLine[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      out.push({ type: "equal", text: a[i] });
      i++;
      j++;
    } else if (lcs[i + 1][j] >= lcs[i][j + 1]) {
      out.push({ type: "removed", text: a[i] });
      i++;
    } else {
      out.push({ type: "added", text: b[j] });
      j++;
    }
  }
  while (i < n) {
    out.push({ type: "removed", text: a[i] });
    i++;
  }
  while (j < m) {
    out.push({ type: "added", text: b[j] });
    j++;
  }
  return out;
}

/** True when the two texts are identical. */
export function textsEqual(left: string, right: string): boolean {
  return left === right;
}
