export function safeExternalUrl(href: string | null): string | null {
  if (!href) return null;
  try {
    const u = new URL(href, "http://invalid.local");
    if (u.protocol === "https:" || u.protocol === "http:") return u.toString();
    return null;
  } catch {
    return null;
  }
}
