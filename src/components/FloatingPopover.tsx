import { useLayoutEffect, useRef, type ReactNode, type RefObject } from "react";
import { createPortal } from "react-dom";
import { placePopover, type PopoverPlacement } from "../util/popover";

/** Portals escape composer/sidebar overflow; placement keeps the whole menu in view. */
export function FloatingPopover({
  anchor, children, className, onClose, width = 300, placement = "top",
  align = "start", role, label, contentRef,
}: {
  anchor: HTMLElement | null;
  children: ReactNode;
  className: string;
  onClose: () => void;
  width?: number;
  placement?: PopoverPlacement;
  align?: "start" | "end";
  role?: "listbox" | "menu" | "dialog";
  label?: string;
  contentRef?: RefObject<HTMLDivElement | null>;
}) {
  const ownRef = useRef<HTMLDivElement>(null);
  const ref = contentRef ?? ownRef;
  const close = useRef(onClose);
  close.current = onClose;
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || !anchor) return;
    const update = () => {
      // Measure unconstrained content before applying available viewport space.
      el.style.maxHeight = "";
      el.style.width = `${Math.min(width, window.innerWidth - 20)}px`;
      const p = placePopover(anchor.getBoundingClientRect(),
        { width, height: el.getBoundingClientRect().height },
        { width: window.innerWidth, height: window.innerHeight }, placement, align);
      Object.assign(el.style, { left: `${p.left}px`, top: `${p.top}px`,
        width: `${p.width}px`, maxHeight: `${p.maxHeight}px`, visibility: "visible" });
    };
    const outside = (event: Event) => {
      if (!el.contains(event.target as Node) && !anchor.contains(event.target as Node)) close.current();
    };
    const keyboard = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.stopPropagation();
        close.current();
        anchor.focus();
      }
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(el);
    observer.observe(anchor);
    window.addEventListener("resize", update);
    document.addEventListener("scroll", update, true);
    document.addEventListener("pointerdown", outside, true);
    document.addEventListener("focusin", outside);
    document.addEventListener("keydown", keyboard, true);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", update);
      document.removeEventListener("scroll", update, true);
      document.removeEventListener("pointerdown", outside, true);
      document.removeEventListener("focusin", outside);
      document.removeEventListener("keydown", keyboard, true);
    };
  }, [anchor, width, placement, align, ref]);
  return createPortal(
    <div ref={ref} className={`floating-popover ${className}`} role={role}
      aria-label={label} style={{ visibility: "hidden" }}>{children}</div>, document.body,
  );
}
