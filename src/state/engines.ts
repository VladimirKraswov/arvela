// Which agent engine drives a given folder or chat.
//
// Resolution is deliberately boring and explicit, because getting it wrong means
// a prompt goes to the wrong agent:
//
//   per-chat override  →  folder preference  →  OpenCode
//
// OpenCode is the default everywhere. Projects and chats created before engine
// selection existed simply have no entry, which resolves to OpenCode — that is
// the whole migration, and it is verified by tests rather than a data rewrite.

import { OPENCODE_BACKEND_ID } from "../agent/opencode";
import { PI_BACKEND_ID } from "../agent/pi/backend";
import type { Prefs } from "./prefs";

export type EngineId = string;

export const DEFAULT_ENGINE: EngineId = OPENCODE_BACKEND_ID;

export interface EngineOption {
  id: EngineId;
  label: string;
  /** False when the engine cannot run here; the picker explains why. */
  available: boolean;
  reason?: string;
}

export function engineForDirectory(
  prefs: Pick<Prefs, "projectEngine">,
  directory: string | null,
): EngineId {
  if (!directory) return DEFAULT_ENGINE;
  return prefs.projectEngine?.[directory] ?? DEFAULT_ENGINE;
}

/**
 * A chat keeps the engine it was started with, decided from **durable evidence**
 * about the chat itself — never from the folder's current preference.
 *
 * This matters: every chat that existed before engine selection has no
 * `sessionEngine` entry. If the folder preference were the fallback, switching a
 * project to Pi would silently reinterpret the whole OpenCode history as Pi
 * chats, sending their ids to an engine that has never seen them. So the folder
 * preference governs **new** chats only (`sessionId === null`), and an existing
 * chat resolves to OpenCode unless something durable says otherwise:
 *
 *   explicit per-chat override  →  Pi session metadata exists  →  OpenCode
 */
export function engineForSession(
  prefs: Pick<Prefs, "projectEngine" | "sessionEngine" | "piSessions">,
  sessionId: string | null,
  directory: string | null,
): EngineId {
  // No chat yet: this is the composer for a new one, so the folder decides.
  if (!sessionId) return engineForDirectory(prefs, directory);
  const override = prefs.sessionEngine?.[sessionId];
  if (override) return override;
  // Pi owns a transcript for this id: that is durable, app-owned evidence.
  if (prefs.piSessions?.[sessionId]) return PI_BACKEND_ID;
  return DEFAULT_ENGINE;
}

/** Pi is a local CLI: with a remote OpenCode host the working tree is elsewhere. */
export function piAvailability(prefs: Pick<Prefs, "activeHost">): {
  available: boolean;
  reason?: string;
} {
  const host = prefs.activeHost ?? "local";
  return host === "local"
    ? { available: true }
    : {
        available: false,
        reason:
          "Pi выполняется на этом компьютере, а выбран удалённый сервер OpenCode. Переключитесь на «Этот компьютер».",
      };
}

export function engineOptions(
  prefs: Pick<Prefs, "activeHost">,
  piInstalled: boolean,
): EngineOption[] {
  const local = piAvailability(prefs);
  return [
    { id: OPENCODE_BACKEND_ID, label: "OpenCode", available: true },
    {
      id: PI_BACKEND_ID,
      label: "Pi",
      available: piInstalled && local.available,
      reason: !piInstalled
        ? "Pi CLI не найден. Установите его и укажите путь в настройках."
        : local.reason,
    },
  ];
}

/** Model preferences are per engine: switching engines must not reuse the other's model. */
export function modelScope(engine: EngineId, key: string): string {
  return engine === DEFAULT_ENGINE ? key : `${engine}::${key}`;
}
