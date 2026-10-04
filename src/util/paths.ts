/** Path helpers for values returned by a local engine on any desktop platform. */
export function isAbsoluteLocalPath(value: string): boolean {
  return /^(?:[A-Za-z]:[\\/]|\\\\[^\\/]+[\\/][^\\/]+|\/)/.test(value.trim());
}

export function normalizeLocalPath(value: string): string {
  const normalized = value.replace(/\\/g, "/");
  return normalized.length > 1 ? normalized.replace(/\/+$/, "") : normalized;
}

export function pathBasename(value: string): string {
  const normalized = normalizeLocalPath(value);
  return normalized.split("/").filter(Boolean).pop() ?? value;
}

export function pathDirname(value: string): string {
  const normalized = normalizeLocalPath(value);
  const index = normalized.lastIndexOf("/");
  return index > 0 ? normalized.slice(0, index) : "";
}

export function pathIsWithin(value: string, root: string): boolean {
  const candidate = normalizeLocalPath(value).toLocaleLowerCase();
  const parent = normalizeLocalPath(root).toLocaleLowerCase();
  return candidate === parent || candidate.startsWith(`${parent}/`);
}
