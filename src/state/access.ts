import type { PermissionRule } from "../api/types";
export type AccessMode = "inherit" | "ask" | "read" | "full";
export const accessOptions = [
  {
    value: "inherit",
    label: "Как в OpenCode",
    detail: "Разрешения выбранного агента и проекта",
  },
  {
    value: "ask",
    label: "С подтверждением",
    detail: "Чтение разрешено; остальные инструменты спрашивают",
  },
  {
    value: "read",
    label: "Только чтение",
    detail: "Чтение и поиск файлов; команды и изменения запрещены",
  },
  {
    value: "full",
    label: "Полный доступ",
    detail: "Инструменты без подтверждения, в том числе вне проекта",
  },
];
export function accessRules(mode: AccessMode): PermissionRule[] {
  if (mode === "inherit") return [];
  if (mode === "full")
    return [
      { permission: "*", pattern: "*", action: "allow" },
      { permission: "doom_loop", pattern: "*", action: "ask" },
    ];
  return [
    { permission: "*", pattern: "*", action: mode === "read" ? "deny" : "ask" },
    ...["read", "glob", "grep", "list", "question", "todowrite"].map(
      (permission) => ({ permission, pattern: "*", action: "allow" as const }),
    ),
  ];
}
export function accessMode(
  rules: PermissionRule[] | undefined,
): AccessMode | "custom" {
  if (!rules?.length) return "inherit";
  return (
    (["ask", "read", "full"] as const).find(
      (mode) => JSON.stringify(accessRules(mode)) === JSON.stringify(rules),
    ) ?? "custom"
  );
}
