export type PopoverPlacement = "top" | "bottom";

/** Viewport coordinates, independent of any scrolling/clipping ancestor. */
export function placePopover(
  anchor: { left: number; right: number; top: number; bottom: number },
  panel: { width: number; height: number },
  viewport: { width: number; height: number },
  preferred: PopoverPlacement = "top",
  align: "start" | "end" = "start",
) {
  const margin = 10, gap = 8;
  const width = Math.min(panel.width, Math.max(0, viewport.width - margin * 2));
  const above = Math.max(0, anchor.top - gap - margin);
  const below = Math.max(0, viewport.height - margin - anchor.bottom - gap);
  const preferredSpace = preferred === "top" ? above : below;
  const otherSpace = preferred === "top" ? below : above;
  const placement = preferredSpace >= panel.height || preferredSpace >= otherSpace
    ? preferred : preferred === "top" ? "bottom" : "top";
  const maxHeight = Math.min(viewport.height - margin * 2, placement === "top" ? above : below);
  const height = Math.max(0, Math.min(panel.height, maxHeight));
  const left = Math.max(margin, Math.min(
    align === "end" ? anchor.right - width : anchor.left,
    viewport.width - width - margin,
  ));
  const top = Math.max(margin, Math.min(
    placement === "top" ? anchor.top - gap - height : anchor.bottom + gap,
    viewport.height - height - margin,
  ));
  return { left, top, width, maxHeight: Math.max(0, maxHeight), placement };
}
