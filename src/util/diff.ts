// Local unified-diff fallback: some diff responses return file contents (before/after)
// without patch text. Pure functions, no dependencies, so the reducer stays testable.

/** NUL byte or invalid-looking content marks a binary file; such files get no textual preview. */
export function looksBinary(...texts: Array<string | undefined>): boolean {
  return texts.some((t) => t !== undefined && t.includes("\u0000"));
}

const MAX_LINES = 2000;
const CONTEXT = 2;

/**
 * Produce unified-style diff lines (" ", "-", "+") without headers.
 * Above MAX_LINES per side the LCS is skipped and a full replace is emitted —
 * bounded work for pathological inputs.
 */
export function unifiedDiffLines(
  before: string | undefined,
  after: string | undefined,
): string[] {
  const a = splitLines(before ?? "");
  const b = splitLines(after ?? "");
  if (a.length === 0 && b.length === 0) return [];
  if (a.length > MAX_LINES || b.length > MAX_LINES) {
    return [...a.map((l) => `-${l}`), ...b.map((l) => `+${l}`)];
  }
  return withContext(lcsEdits(a, b));
}

function splitLines(text: string): string[] {
  if (text === "") return [];
  const lines = text.split("\n");
  if (lines[lines.length - 1] === "") lines.pop(); // trailing newline is not an empty line
  return lines;
}

type Edit = { op: " " | "-" | "+"; line: string };

/** Classic LCS table diff; quadratic memory capped by MAX_LINES upstream. */
function lcsEdits(a: string[], b: string[]): Edit[] {
  const n = a.length;
  const m = b.length;
  const dp: Uint32Array[] = Array.from(
    { length: n + 1 },
    () => new Uint32Array(m + 1),
  );
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i][j] =
        a[i] === b[j]
          ? dp[i + 1][j + 1] + 1
          : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }
  const edits: Edit[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      edits.push({ op: " ", line: a[i] });
      i++;
      j++;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      edits.push({ op: "-", line: a[i++] });
    } else {
      edits.push({ op: "+", line: b[j++] });
    }
  }
  while (i < n) edits.push({ op: "-", line: a[i++] });
  while (j < m) edits.push({ op: "+", line: b[j++] });
  return edits;
}

/** Keep CONTEXT lines around each changed run; drop the rest (caller shows truncation). */
function withContext(edits: Edit[]): string[] {
  if (!edits.some((e) => e.op !== " ")) return []; // no changes → no hunk
  const keep = new Array<boolean>(edits.length).fill(false);
  edits.forEach((e, idx) => {
    if (e.op === " ") return;
    for (
      let k = Math.max(0, idx - CONTEXT);
      k <= Math.min(edits.length - 1, idx + CONTEXT);
      k++
    )
      keep[k] = true;
  });
  const out: string[] = [];
  let skipped = false;
  edits.forEach((e, idx) => {
    if (keep[idx]) {
      if (skipped) {
        out.push("…");
        skipped = false;
      }
      out.push(e.op + e.line);
    } else {
      skipped = true;
    }
  });
  return out;
}
