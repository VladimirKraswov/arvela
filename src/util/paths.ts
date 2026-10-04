/** Path helpers for values returned by a local engine on any desktop platform. */
export function isAbsoluteLocalPath(value: string): boolean {
  return /^(?:[A-Za-z]:[\\/]|\\\\[^\\/]+[\\/][^\\/]+|\/)/.test(value.trim());
}

export function normalizeLocalPath(value: string): string {
  const normalized = value.replace(/\\/g, "/");
  if (/^[A-Za-z]:\/+$/u.test(normalized)) return `${normalized.slice(0, 2)}/`;
  return normalized.length > 1 ? normalized.replace(/\/+$/, "") : normalized;
}

export function pathBasename(value: string): string {
  const normalized = normalizeLocalPath(value);
  return normalized.split("/").filter(Boolean).pop() ?? value;
}

export function pathDirname(value: string): string {
  const normalized = normalizeLocalPath(value);
  const index = normalized.lastIndexOf("/");
  if (index === 0) return "/";
  if (index === 2 && /^[A-Za-z]:\//u.test(normalized)) return normalized.slice(0, 3);
  return index > 0 ? normalized.slice(0, index) : "";
}

export function pathIsWithin(value: string, root: string): boolean {
  if (!root) return false;
  // A remote engine may use a different path syntax from the local desktop.
  // Only drive/UNC syntax permits case folding; POSIX paths stay case-sensitive.
  const windows = /^(?:[A-Za-z]:[\\/]|[\\/]{2}[^\\/]+[\\/][^\\/]+)/u.test(root);
  const compare = (path: string) => windows ? normalizeLocalPath(path).toLowerCase() : normalizeLocalPath(path);
  const candidate = compare(value);
  const parent = compare(root);
  return candidate === parent || candidate.startsWith(parent.endsWith("/") ? parent : `${parent}/`);
}
