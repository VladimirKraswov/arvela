import {
  Children, cloneElement, isValidElement, useEffect, useId, useRef, useState,
  type LabelHTMLAttributes, type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { hasSettingHelp } from "../settings/helpTopics";
import type { SettingExplanation } from "../settings/help";

type HelpProps = { topic: string; title?: string; description?: string };

/** Help stays available for disabled controls and never changes their values. */
export function SettingHelp({ topic, title, description }: HelpProps) {
  const supported = hasSettingHelp(topic) || !!description?.trim() && description.trim() !== "—";
  const [loaded, setLoaded] = useState<{ topic: string; help?: SettingExplanation; error?: string }>();
  const help = loaded?.topic === topic ? loaded.help : undefined;
  const error = loaded?.topic === topic ? loaded.error : undefined;
  const label = title ?? topic;
  const [open, setOpen] = useState(false);
  const dialog = useRef<HTMLDialogElement>(null), trigger = useRef<HTMLButtonElement>(null);
  const heading = useId();

  useEffect(() => {
    if (!open) return;
    const node = dialog.current;
    node?.showModal();
    return () => {
      node?.close();
      if (trigger.current?.isConnected) trigger.current.focus();
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    let active = true;
    void import("../settings/help").then(module => {
      if (active) setLoaded({ topic, help: module.settingHelp(topic, label, description) });
    }).catch(() => {
      if (active) setLoaded({ topic, error: "Не удалось загрузить справку. Перезапустите интерфейс и попробуйте снова." });
    });
    return () => { active = false; };
  }, [open, topic, label, description]);

  if (!supported) return null;
  return <>
    <button ref={trigger} type="button" className="setting-help-trigger"
      aria-label={`Справка: ${label}`} aria-haspopup="dialog" aria-expanded={open}
      onClick={event => { event.preventDefault(); event.stopPropagation(); setOpen(true); }}>?</button>
    {open && createPortal(
      <dialog ref={dialog} className="setting-help-dialog" aria-labelledby={heading}
        onKeyDown={event => {
          // Escape must not reach the parent settings screen. This text-only
          // dialog has one focusable control; keep Tab inside the WebView.
          if (event.key === "Escape") event.stopPropagation();
          if (event.key === "Tab") {
            event.preventDefault();
            dialog.current?.querySelector<HTMLButtonElement>("button")?.focus();
          }
        }}
        onCancel={event => { event.preventDefault(); setOpen(false); }}
        onClick={event => {
          if (event.target !== event.currentTarget) return;
          const box = event.currentTarget.getBoundingClientRect();
          if (event.clientX < box.left || event.clientX > box.right || event.clientY < box.top || event.clientY > box.bottom) setOpen(false);
        }}>
        <header><h2 id={heading}>{label}</h2><button type="button" className="btn small" autoFocus onClick={() => setOpen(false)}>Закрыть</button></header>
        <div className="setting-help-body">
          {help ? <>
            <p>{help.summary}</p>
            {help.values && <dl>{help.values.map(([value, meaning]) => <div key={value}><dt>{value}</dt><dd>{meaning}</dd></div>)}</dl>}
            {help.note && <p className="setting-help-note">{help.note}</p>}
          </> : error ? <p role="alert">{error}</p> : <p role="status">Загружаю справку…</p>}
        </div>
      </dialog>, document.body,
    )}
  </>;
}

type ControlProps = { id?: string; type?: string };
/** A labelled form field, with the help button outside the HTML label. */
export function SettingField({ label, topic, children, ...props }: LabelHTMLAttributes<HTMLLabelElement> & { label: string; topic?: string; children: ReactNode }) {
  const generatedId = useId();
  const nodes = Children.toArray(children);
  const control = nodes.find(child => isValidElement<ControlProps>(child) && typeof child.type === "string" && ["input", "select", "textarea"].includes(child.type));
  const toggle = isValidElement<ControlProps>(control) && control.props.type === "checkbox";
  const id = isValidElement<ControlProps>(control) ? control.props.id ?? props.htmlFor ?? generatedId : generatedId;
  return <div className={`setting-help-field${toggle ? " setting-help-toggle" : ""}`}>
    {toggle ? <>
      <label {...props}>{children}{label}</label><SettingHelp topic={topic ?? label} title={label}/>
    </> : <>
      <div className="setting-field-heading"><label {...props} htmlFor={id}>{label}</label><SettingHelp topic={topic ?? label} title={label}/></div>
      <div className="setting-field-control">{nodes.map(child => child === control && isValidElement<ControlProps>(child) ? cloneElement(child, {id}) : child)}</div>
    </>}
  </div>;
}
