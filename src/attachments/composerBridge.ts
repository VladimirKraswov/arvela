// Typed, scoped requests from other panels to the mounted composer, replacing an
// untyped window event. The caller learns whether a composer accepted the request,
// and chosen files always land in the draft of the chat that asked for them.

export interface ComposerHandle {
  /** Attachment scope (server, directory, chat) the composer is editing now. */
  scope(): string;
  /** Open the composer's own file chooser; false when it cannot accept files now. */
  openFiles(): boolean;
  focus(): void;
}

let composer: ComposerHandle | null = null;

export function registerComposer(handle: ComposerHandle): () => void {
  composer = handle;
  return () => { if (composer === handle) composer = null; };
}

/** Must run inside the user's click handler: WebViews only open choosers on user activation. */
export function requestComposerFiles(scope: string): boolean {
  return !!composer && composer.scope() === scope && composer.openFiles();
}

export function focusComposer(scope: string): void {
  if (composer?.scope() === scope) composer.focus();
}

// ---- native file chooser state ----
//
// While a native chooser is open the window is in a modal state. Large periodic
// work (browser frame projection) pauses meanwhile so the UI process does not keep
// receiving multi-megabyte frames that nobody can see.

let chooserOpen = false;
const listeners = new Set<() => void>();
function setChooserOpen(open: boolean) {
  if (chooserOpen === open) return;
  chooserOpen = open;
  listeners.forEach(listener => listener());
}
export function subscribeFileChooser(listener: () => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}
export function fileChooserOpen(): boolean { return chooserOpen; }

/**
 * Open the chooser of a file input and track it until it settles. `change` and
 * `cancel` are authoritative; focus returning to the window or any user input in
 * it are fallbacks for WebViews that fire no `cancel` event.
 */
export function openFileInput(input: HTMLInputElement | null): boolean {
  if (!input || input.disabled) return false;
  const settle = () => {
    input.removeEventListener("change", settle);
    input.removeEventListener("cancel", settle);
    window.removeEventListener("focus", settle);
    window.removeEventListener("pointerdown", settle, true);
    window.removeEventListener("keydown", settle, true);
    setChooserOpen(false);
  };
  input.addEventListener("change", settle);
  input.addEventListener("cancel", settle);
  window.addEventListener("focus", settle);
  window.addEventListener("pointerdown", settle, true);
  window.addEventListener("keydown", settle, true);
  setChooserOpen(true);
  try { input.click(); } catch { settle(); return false; }
  return true;
}
