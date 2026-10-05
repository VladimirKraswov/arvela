export interface BrowserFrame {
  browserOpen: boolean; busy: boolean;
  tabs: { index: number; url: string; title: string; active: boolean }[];
  url?: string; title?: string; image?: string; width?: number; height?: number;
  pageId?: string; revision?: number;
  cursor?: { x: number; y: number; owner: "agent" | "user"; action: string; at: number } | null;
}
export function parseFrame(value: unknown): BrowserFrame {
  if (!value || typeof value !== "object") throw new Error("Некорректный кадр браузера.");
  const f = value as BrowserFrame;
  if (typeof f.browserOpen !== "boolean" || typeof f.busy !== "boolean" || !Array.isArray(f.tabs)
      || f.tabs.length > 128 || f.tabs.some(t => !t || !Number.isInteger(t.index) || t.index < 0 || t.index >= 128 || typeof t.title !== "string" || typeof t.url !== "string" || typeof t.active !== "boolean")
      || new Set(f.tabs.map(t => t.index)).size !== f.tabs.length)
    throw new Error("Некорректные вкладки браузера.");
  if (f.image !== undefined && (typeof f.image !== "string" || f.image.length > 8_000_000 || !/^[A-Za-z0-9+/=]+$/.test(f.image)
      || !Number.isFinite(f.width) || !Number.isFinite(f.height) || f.width! < 1 || f.width! > 1920 || f.height! < 1 || f.height! > 1200))
    throw new Error("Некорректное изображение браузера.");
  if (f.url !== undefined && typeof f.url !== "string") throw new Error("Некорректный адрес.");
  if (f.title !== undefined && typeof f.title !== "string") throw new Error("Некорректный заголовок.");
  if (f.pageId !== undefined && (typeof f.pageId !== "string" || !Number.isSafeInteger(f.revision) || f.revision! < 0)) throw new Error("Некорректное состояние страницы.");
  if (f.cursor && (!Number.isFinite(f.cursor.x) || !Number.isFinite(f.cursor.y) || !["agent", "user"].includes(f.cursor.owner)))
    throw new Error("Некорректный курсор.");
  return f;
}
export function browserPoint(clientX: number, clientY: number, rect: { left: number; top: number; width: number; height: number }, frame: BrowserFrame) {
  if (!frame.width || !frame.height || rect.width <= 0 || rect.height <= 0) return null;
  const x = (clientX - rect.left) * frame.width / rect.width;
  const y = (clientY - rect.top) * frame.height / rect.height;
  return x >= 0 && y >= 0 && x < frame.width && y < frame.height ? { x, y } : null;
}
