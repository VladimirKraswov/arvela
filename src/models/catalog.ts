/**
 * Shared model catalog received from Arvela Hub and merged into the local engine
 * configuration. The catalog is the source of truth for common models; the local
 * machine keeps only its choice (selection, exclusions) and its own extra providers.
 */

export interface OpencodeEngine {
  providerId: string;
  name?: string;
  provider: Record<string, unknown>;
}

export interface PiEngine {
  providerId: string;
  provider: Record<string, unknown>;
}

export interface HubModel {
  id: string;
  label: string;
  note?: string;
  opencode?: OpencodeEngine;
  pi?: PiEngine;
}

export interface HubCatalog {
  version: number;
  updatedAt?: number;
  updatedBy?: string;
  note?: string;
  models: HubModel[];
}

export interface HubModelsPrefs {
  /** When false the catalog is shown but never written into engine configs. */
  enabled: boolean;
  /** Catalog model ids excluded on this device only. */
  excluded: string[];
  /** The published version last applied to this machine, 0 when never. */
  appliedVersion: number;
  /** Provider ids written into opencode config by the catalog. */
  appliedOpencode: string[];
  /** Provider ids written into Pi models.json by the catalog. */
  appliedPi: string[];
}

export function hubModelsState(prefs: {
  hubModels?: Partial<HubModelsPrefs> | null;
}): HubModelsPrefs {
  const raw = prefs.hubModels ?? {};
  const list = (value: unknown) =>
    Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
  return {
    enabled: raw.enabled === true,
    excluded: list(raw.excluded),
    appliedVersion:
      typeof raw.appliedVersion === "number" && raw.appliedVersion > 0
        ? Math.trunc(raw.appliedVersion)
        : 0,
    appliedOpencode: list(raw.appliedOpencode),
    appliedPi: list(raw.appliedPi),
  };
}

export interface CatalogPlan {
  opencode: Record<string, Record<string, unknown>>;
  pi: Record<string, Record<string, unknown>>;
  removeOpencode: string[];
  removePi: string[];
}

/** Models of the catalog that this device wants active (not excluded). */
export function effectiveModels(catalog: HubCatalog, prefs: HubModelsPrefs): HubModel[] {
  return catalog.models.filter((model) => !prefs.excluded.includes(model.id));
}

export function planCatalog(catalog: HubCatalog, prefs: HubModelsPrefs): CatalogPlan {
  const opencode: CatalogPlan["opencode"] = {};
  const pi: CatalogPlan["pi"] = {};
  for (const model of effectiveModels(catalog, prefs)) {
    if (model.opencode) {
      if (model.opencode.providerId in opencode)
        throw new Error(`Двойной providerId в каталоге: ${model.opencode.providerId}`);
      opencode[model.opencode.providerId] = model.opencode.provider;
    }
    if (model.pi) {
      if (model.pi.providerId in pi)
        throw new Error(`Двойной providerId в каталоге: ${model.pi.providerId}`);
      pi[model.pi.providerId] = model.pi.provider;
    }
  }
  return {
    opencode,
    pi,
    removeOpencode: prefs.appliedOpencode.filter((id) => !(id in opencode)),
    removePi: prefs.appliedPi.filter((id) => !(id in pi)),
  };
}

interface MergeResult {
  text: string;
  changed: boolean;
  added: string[];
  replaced: string[];
  removed: string[];
  error?: string;
}

function equalJson(a: string, b: unknown): boolean {
  try {
    return JSON.stringify(JSON.parse(a)) === JSON.stringify(b);
  } catch {
    return false;
  }
}

/** Removes // and /* * / comments outside strings so JSONC fragments can be parsed. */
export function stripComments(input: string): string {
  let out = "",
    i = 0;
  while (i < input.length) {
    const ch = input[i];
    if (ch === '"') {
      const end = stringEnd(input, i);
      if (end < 0) return input;
      out += input.slice(i, end + 1);
      i = end + 1;
      continue;
    }
    if (ch === "/" && input[i + 1] === "/") {
      const end = input.indexOf("\n", i);
      i = end < 0 ? input.length : end;
      continue;
    }
    if (ch === "/" && input[i + 1] === "*") {
      const end = input.indexOf("*/", i + 2);
      i = end < 0 ? input.length : end + 2;
      continue;
    }
    out += ch;
    i += 1;
  }
  return out;
}

function stringEnd(text: string, start: number): number {
  let i = start + 1;
  while (i < text.length) {
    if (text[i] === "\\") i += 2;
    else if (text[i] === '"') return i;
    else i += 1;
  }
  return -1;
}

function skipTrivia(text: string, i: number): number {
  for (;;) {
    while (i < text.length && /\s/.test(text[i])) i += 1;
    if (text[i] === "/" && text[i + 1] === "/") {
      const end = text.indexOf("\n", i);
      if (end < 0) return text.length;
      i = end + 1;
      continue;
    }
    if (text[i] === "/" && text[i + 1] === "*") {
      const end = text.indexOf("*/", i + 2);
      if (end < 0) return text.length;
      i = end + 2;
      continue;
    }
    return i;
  }
}

/** Returns the index just past a JSON value that starts at `i`, or -1. */
function skipValue(text: string, i: number): number {
  i = skipTrivia(text, i);
  const ch = text[i];
  if (ch === '"' || ch === "[") {
    if (ch === "[") {
      let depth = 0;
      for (; i < text.length; i += 1) {
        const c = text[i];
        if (c === '"') {
          const end = stringEnd(text, i);
          if (end < 0) return -1;
          i = end;
        } else if (c === "[") depth += 1;
        else if (c === "]" && --depth === 0) return i + 1;
      }
      return -1;
    }
    const end = stringEnd(text, i);
    return end < 0 ? -1 : end + 1;
  }
  if (ch === "{") {
    const end = objectEnd(text, i);
    return end < 0 ? -1 : end + 1;
  }
  // Literal: number/true/false/null up to the next delimiter.
  let j = i;
  while (j < text.length && !",}]\n\r".includes(text[j])) j += 1;
  return j;
}

/** Returns the index of the closing brace of the object starting at `i`, or -1. */
function objectEnd(text: string, i: number): number {
  if (text[skipTrivia(text, i)] !== "{") return -1;
  let depth = 0;
  for (; i < text.length; i += 1) {
    const c = text[i];
    if (c === '"') {
      const end = stringEnd(text, i);
      if (end < 0) return -1;
      i = end;
    } else if (c === "{") depth += 1;
    else if (c === "}" && --depth === 0) return i;
  }
  return -1;
}

interface Entry {
  key: string;
  start: number;
  valueStart: number;
  valueEnd: number;
}

/** Lists direct string-keyed entries of the object whose opening brace is at `i`. */
function objectEntries(text: string, i: number): Entry[] | null {
  const entries: Entry[] = [];
  let pos = skipTrivia(text, i + 1);
  for (;;) {
    if (text[pos] === "}") return entries;
    if (text[pos] !== '"') return null;
    const keyEnd = stringEnd(text, pos);
    if (keyEnd < 0) return null;
    const key = JSON.parse(text.slice(pos, keyEnd + 1));
    const colon = skipTrivia(text, keyEnd + 1);
    if (text[colon] !== ":") return null;
    const valueStart = skipTrivia(text, colon + 1);
    const valueEnd = skipValue(text, valueStart);
    if (valueEnd < 0) return null;
    entries.push({ key, start: pos, valueStart, valueEnd });
    pos = skipTrivia(text, valueEnd);
    if (text[pos] === ",") pos = skipTrivia(text, pos + 1);
  }
}

function findTopLevelKey(text: string, wanted: string): Entry | null {
  const open = skipTrivia(text, text.indexOf("{"));
  const entries = objectEntries(text, open);
  if (!entries) return null;
  return entries.find((entry) => entry.key === wanted) ?? null;
}

function nextTriviaIndex(text: string, i: number): number {
  for (;;) {
    while (i < text.length && /\s/.test(text[i])) i += 1;
    if (text[i] === "/" && text[i + 1] === "/") {
      const end = text.indexOf("\n", i);
      i = end < 0 ? text.length : end + 1;
      continue;
    }
    if (text[i] === "/" && text[i + 1] === "*") {
      const end = text.indexOf("*/", i + 2);
      i = end < 0 ? text.length : end + 2;
      continue;
    }
    return i;
  }
}

/** Moves left over whitespace and comments; returns the last meaningful index (or -1). */
function skipBackTrivia(text: string, i: number): number {
  for (;;) {
    while (i >= 0 && /\s/.test(text[i])) i -= 1;
    if (i >= 1 && text[i] === "/" && text[i - 1] === "/") {
      const line = text.lastIndexOf("\n", i - 1);
      i = line - 1;
      continue;
    }
    if (i >= 1 && text[i] === "/" && text[i - 1] === "*") {
      const start = text.lastIndexOf("/*", i - 1);
      if (start < 0) return -1;
      i = start - 1;
      continue;
    }
    return i;
  }
}

function objectTailIndent(text: string, close: number): string {
  return text.slice(0, close).match(/\n([ \t]*)$/)?.[1] ?? "  ";
}

function serializeEntry(id: string, value: unknown, pad: string): string {
  return `${pad}${JSON.stringify(id)}: ${JSON.stringify(value, null, 2).split("\n").join("\n" + pad)}`;
}

/** Inserts serialized entry bodies before the closing brace, keeping comma integrity. */
function appendEntries(
  text: string,
  open: number,
  close: number,
  entries: Entry[],
  bodies: string[],
): string {
  const body = bodies.join(",\n");
  if (!entries.length) return `${text.slice(0, open + 1)}\n${body}\n${objectTailIndent(text, close)}${text.slice(close)}`;
  const last = entries[entries.length - 1];
  if (text[nextTriviaIndex(text, last.valueEnd)] === ",")
    return `${text.slice(0, close)}${body}\n${objectTailIndent(text, close)}${text.slice(close)}`;
  return `${text.slice(0, last.valueEnd)},${text.slice(last.valueEnd, close)}${body}\n${objectTailIndent(text, close)}${text.slice(close)}`;
}

/**
 * Adds/replaces the given providers inside the top-level `provider` object of a
 * JSONC configuration and removes only `remove` ids. Everything else — other
 * providers, other keys, comments — is preserved; comma integrity is kept so the
 * result parses in both JSONC and plain JSON (no dangling trailing commas).
 */
export function mergeOpencodeProviders(
  text: string,
  desired: Record<string, Record<string, unknown>>,
  remove: string[],
): MergeResult {
  const base = { text, changed: false, added: [] as string[], replaced: [] as string[], removed: [] as string[] };
  if (!Object.keys(desired).length && !remove.length) return base;
  try {
    if (!text.trim()) {
      if (!Object.keys(desired).length) return base;
      const body = Object.entries(desired)
        .map(([id, value]) => serializeEntry(id, value, "  "))
        .join(",\n");
      return {
        text: `{\n  "provider": {\n${body}\n  }\n}\n`,
        changed: true,
        added: Object.keys(desired),
        replaced: [],
        removed: [],
      };
    }
    let work = text;
    const added: string[] = [], replaced: string[] = [], removed: string[] = [];
    let provider = findTopLevelKey(work, "provider");
    if (provider) {
      if (work[provider.valueStart] !== "{")
        return { ...base, error: "Блок provider должен быть объектом" };
      const entries = objectEntries(work, provider.valueStart);
      if (!entries) return { ...base, error: "Не удалось разобрать блок provider" };
      const drifted = entries
        .filter(
          (entry) =>
            entry.key in desired &&
            !equalJson(stripComments(work.slice(entry.valueStart, entry.valueEnd)), desired[entry.key]),
        )
        .sort((a, b) => b.valueStart - a.valueStart);
      for (const entry of drifted) {
        const lineIndent = work.slice(0, entry.start).match(/\n([ \t]*)$/)?.[1] ?? "    ";
        const value = JSON.stringify(desired[entry.key], null, 2)
          .split("\n")
          .join("\n" + lineIndent);
        work = `${work.slice(0, entry.valueStart)}${value}${work.slice(entry.valueEnd)}`;
        replaced.push(entry.key);
      }
    }
    for (const id of remove) {
      provider = findTopLevelKey(work, "provider");
      if (!provider || work[provider.valueStart] !== "{") continue;
      const entries = objectEntries(work, provider.valueStart);
      const entry = entries?.find((candidate) => candidate.key === id);
      if (!entry) continue;
      let from = entry.start;
      let to = entry.valueEnd;
      if (work[nextTriviaIndex(work, entry.valueEnd)] === ",") {
        to = nextTriviaIndex(work, entry.valueEnd) + 1;
      } else {
        const before = skipBackTrivia(work, entry.start - 1);
        if (work[before] === ",") from = before;
      }
      work = `${work.slice(0, from)}${work.slice(to)}`;
      removed.push(id);
    }
    provider = findTopLevelKey(work, "provider");
    if (!provider) {
      if (!Object.keys(desired).length) return base;
      const open = skipTrivia(work, work.indexOf("{"));
      const close = objectEnd(work, open);
      if (work[open] !== "{" || close < 0)
        return { ...base, error: "Не удалось найти корневой объект конфигурации" };
      const rootEntries = objectEntries(work, open) ?? [];
      const pad = `${objectTailIndent(work, close)}  `;
      const inner = Object.entries(desired)
        .map(([id, value]) => serializeEntry(id, value, `${pad}  `))
        .join(",\n");
      work = appendEntries(
        work,
        open,
        close,
        rootEntries,
        [`"provider": {\n${inner}\n${objectTailIndent(work, close)}}`],
      );
      added.push(...Object.keys(desired));
    } else {
      const entries = objectEntries(work, provider.valueStart) ?? [];
      const missing = Object.entries(desired).filter(([id]) => !entries.some((entry) => entry.key === id));
      if (missing.length) {
        const close = objectEnd(work, provider.valueStart);
        const pad = `${objectTailIndent(work, close)}  `;
        work = appendEntries(
          work,
          provider.valueStart,
          close,
          entries,
          missing.map(([id, value]) => serializeEntry(id, value, pad)),
        );
        added.push(...missing.map(([id]) => id));
      }
      const close = objectEnd(work, provider.valueStart);
      const survivors = objectEntries(work, provider.valueStart) ?? [];
      if (survivors.length) {
        const last = survivors[survivors.length - 1];
        const comma = work.indexOf(",", last.valueEnd);
        if (comma >= 0 && comma < close && skipTrivia(work, comma + 1) === close)
          work = `${work.slice(0, comma)}${work.slice(comma + 1)}`;
      }
    }
    const changed = added.length > 0 || replaced.length > 0 || removed.length > 0;
    return { text: changed ? work : text, changed, added, replaced, removed };
  } catch (error) {
    return { ...base, error: `Не удалось разобрать конфигурацию: ${String(error)}` };
  }
}

/** Applies the catalog to Pi `models.json` (pure JSON), preserving unrelated fields. */
export function mergePiModels(
  content: string,
  desired: Record<string, Record<string, unknown>>,
  remove: string[],
): MergeResult {
  const base = { text: content, changed: false, added: [] as string[], replaced: [] as string[], removed: [] as string[] };
  if (!Object.keys(desired).length && !remove.length) return base;
  let root: Record<string, unknown>;
  try {
    root = content.trim() ? JSON.parse(content) : {};
    if (!root || typeof root !== "object" || Array.isArray(root)) throw new Error("нужен объект");
  } catch (error) {
    return { ...base, error: `models.json Pi не разобран: ${String(error)}` };
  }
  const providers =
    root.providers && typeof root.providers === "object" && !Array.isArray(root.providers)
      ? (root.providers as Record<string, unknown>)
      : {};
  const added: string[] = [],
    replaced: string[] = [],
    removed: string[] = [];
  for (const [id, value] of Object.entries(desired)) {
    if (id in providers) {
      if (JSON.stringify(providers[id]) === JSON.stringify(value)) continue;
      replaced.push(id);
    } else added.push(id);
    providers[id] = value;
  }
  for (const id of remove) {
    if (id in providers) {
      delete providers[id];
      removed.push(id);
    }
  }
  if (!added.length && !replaced.length && !removed.length) return base;
  return {
    text: `${JSON.stringify({ ...root, providers }, null, 2)}\n`,
    changed: true,
    added,
    replaced,
    removed,
  };
}
