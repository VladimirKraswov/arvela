import { marked } from "marked";
import DOMPurify from "dompurify";

marked.setOptions({ gfm: true, breaks: false });

/** Render untrusted model Markdown to sanitized HTML. Raw HTML is stripped, links get safe schemes only. */
export function renderMarkdown(source: string): string {
  const raw = marked.parse(source, { async: false }) as string;
  const clean = DOMPurify.sanitize(raw, {
    USE_PROFILES: { html: true },
    FORBID_TAGS: ["style", "script", "iframe", "form", "input", "button", "link", "meta"],
    FORBID_ATTR: ["style", "srcdoc"],
    ALLOWED_URI_REGEXP: /^(?:https?:|mailto:|#|\/)/i,
    ADD_ATTR: ["target", "rel"],
  });
  return clean;
}

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
