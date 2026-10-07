import { useRef, useState } from "react";
import { FloatingPopover } from "./FloatingPopover";
import { Icon } from "./Icon";
export function SelectMenu({
  label,
  className,
  value,
  options,
  onChange,
  disabled = false,
}: {
  label: string;
  className?: string;
  value: string;
  options: {
    value: string;
    label: string;
    detail?: string;
    /** Shown but not selectable; `detail` explains why. */
    disabled?: boolean;
  }[];
  onChange: (value: string) => void;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false),
    [query, setQuery] = useState("");
  const ref = useRef<HTMLDivElement>(null);
  const popupRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const selected = options.find((o) => o.value === value);
  const filtered = options.filter((o) =>
    (o.label + " " + (o.detail ?? ""))
      .toLowerCase()
      .includes(query.toLowerCase()),
  );
  return (
    <div
      className={`select-menu ${className ?? ""}`}
      ref={ref}
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          setOpen(false);
          e.stopPropagation();
          ref.current?.querySelector("button")?.focus();
        }
        if (e.key === "ArrowDown" || e.key === "ArrowUp") {
          e.preventDefault();
          const rows = [
            ...(popupRef.current?.querySelectorAll<HTMLButtonElement>(
              "[role=option]",
            ) ?? []),
          ];
          const i = rows.indexOf(document.activeElement as HTMLButtonElement);
          if (!open) { setOpen(true); return; }
          rows[i < 0 ? (e.key === "ArrowDown" ? 0 : rows.length - 1) :
            (i + (e.key === "ArrowDown" ? 1 : rows.length - 1)) % rows.length]?.focus();
        }
      }}
    >
      <button
        type="button"
        ref={buttonRef}
        className="select-trigger"
        aria-label={label}
        aria-haspopup="listbox"
        aria-expanded={open}
        title={selected ? [selected.label, selected.detail].filter(Boolean).join(" · ") : value || label}
        disabled={disabled}
        onClick={() => {
          setOpen(!open);
          setQuery("");
        }}
      >
        <span>
          {selected?.label ?? value ?? label}
        </span>
        <Icon name="down" size={13} />
      </button>
      {open && (
        <FloatingPopover anchor={buttonRef.current} contentRef={popupRef}
          className="select-popover" role="listbox" label={label}
          width={options.some((o) => o.detail) ? 360 : 240}
          onClose={() => setOpen(false)}>
          {options.length > 8 && (
            <input
              autoFocus
              placeholder="Поиск…"
              aria-label={`Поиск: ${label}`}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          )}
          <div className="select-options">
            {filtered.map((o) => (
              <button
                role="option"
                aria-selected={o.value === value}
                aria-disabled={o.disabled || undefined}
                disabled={o.disabled}
                key={o.value}
                onClick={() => {
                  if (o.disabled) return;
                  onChange(o.value);
                  setOpen(false);
                  ref.current?.querySelector("button")?.focus();
                }}
              >
                <span>
                  {o.label}
                  {o.detail && <small>{o.detail}</small>}
                </span>
                {o.value === value && <Icon name="check" size={15} />}
              </button>
            ))}
          </div>
        </FloatingPopover>
      )}
    </div>
  );
}
