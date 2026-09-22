import { applyEdits, modify, parse, type ParseError } from "jsonc-parser";

export type ConfigValue = Record<string, unknown>;

export function parseConfig(source: string): ConfigValue {
  if (!source.trim()) return {};
  const errors: ParseError[] = [];
  const value: unknown = parse(source, errors, { allowTrailingComma: true });
  if (errors.length || !value || typeof value !== "object" || Array.isArray(value))
    throw new Error("Файл конфигурации содержит ошибки JSON/JSONC. Исправьте их перед сохранением.");
  return value as ConfigValue;
}

/** Edits one field without discarding unrelated OpenCode settings or JSONC comments. */
export function updateConfig(source: string, path: (string | number)[], value: unknown): string {
  const base = source.trim() ? source : "{}\n";
  parseConfig(base);
  const edited = applyEdits(base, modify(base, path, value, {
    formattingOptions: { insertSpaces: true, tabSize: 2, eol: "\n" },
  }));
  parseConfig(edited);
  return edited;
}

export const PERMISSION_VALUES = ["allow", "ask", "deny"] as const;
export type PermissionValue = (typeof PERMISSION_VALUES)[number];

export function permissionValue(config: ConfigValue, name: string): PermissionValue | "custom" | "inherit" {
  const rules = config.permission;
  if (!rules || typeof rules !== "object" || Array.isArray(rules)) return "inherit";
  const value = (rules as Record<string, unknown>)[name];
  if (value === undefined) return "inherit";
  return PERMISSION_VALUES.includes(value as PermissionValue) ? value as PermissionValue : "custom";
}

export function npmPluginName(name: string): boolean {
  // Published package or scoped package, optionally pinned to a version; no URL/path/command.
  return /^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*(?:@[a-z0-9][a-z0-9.+_-]*)?$/i.test(name);
}

export function remoteMcpUrl(raw: string): boolean {
  try {
    const url = new URL(raw);
    const local = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
    return !url.username && !url.password && !url.hash && (url.protocol === "https:" || (local && url.protocol === "http:"));
  } catch { return false; }
}
