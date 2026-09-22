import type { CSSProperties } from "react";
const paths: Record<string, string> = {
  mic: "M9 5a3 3 0 0 1 6 0v7a3 3 0 0 1-6 0zM5 10v2a7 7 0 0 0 14 0v-2M12 19v3M8 22h8",
  plus: "M12 5v14M5 12h14",
  new: "M12 4H5a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2h13a2 2 0 0 0 2-2v-7M16 3l5 5M10 14l2-6 7-7 5 5-7 7z",
  search: "M21 21l-5-5M18 10a8 8 0 1 1-16 0 8 8 0 0 1 16 0",
  folder: "M3 7V5h6l2 2h10v13H3z",
  chevron: "m9 5 7 7-7 7",
  down: "m6 9 6 6 6-6",
  terminal: "m4 6 6 6-6 6M13 18h7",
  panel: "M3 4h18v16H3zM15 4v16",
  sidebar: "M3 4h18v16H3zM9 4v16",
  code: "m8 6-6 6 6 6m8-12 6 6-6 6m-3-15-2 18",
  arrow: "M12 20V4m-6 6 6-6 6 6",
  stop: "M6 6h12v12H6z",
  settings:
    "M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8M9 3h6l1 3 3 1 2 5-2 5-3 1-1 3H9l-1-3-3-1-2-5 2-5 3-1z",
  branch: "M6 3v12a4 4 0 0 0 4 4h4M6 7h8a4 4 0 0 0 4-4M4 3h4M16 3h4M14 17v4",
  close: "m6 6 12 12M6 18 18 6",
  refresh: "M20 7a9 9 0 1 0 1 9M20 3v5h-5",
  check: "m4 12 5 5L20 6",
  archive: "M3 3h18v5H3zM5 8v13h14V8M9 12h6",
  chat: "M3 4h18v14H8l-5 3z",
  dots: "M5 12h.01M12 12h.01M19 12h.01",
  file: "M5 2h9l5 5v15H5zM14 2v6h5",
  sun: "M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8M12 2v2m0 16v2M2 12h2m16 0h2M5 5l1 1m12 12 1 1M5 19l1-1M18 6l1-1",
  pin: "m8 3 8 0-1 6 4 4H5l4-4zM12 13v8",
  keyboard: "M2 5h20v14H2zM6 9h.01M10 9h.01M14 9h.01M18 9h.01M6 14h12",
};
export function Icon({
  name,
  size = 18,
  style,
}: {
  name: string;
  size?: number;
  style?: CSSProperties;
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.65"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      style={{ flexShrink: 0, ...style }}
    >
      <path d={paths[name] ?? paths.code} />
    </svg>
  );
}
