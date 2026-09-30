import { isNative } from "./platform";

/** Browser preview cannot launch the separately installed CLI. */
export async function startLocalServerIfNative(endpoint: string, program?: string): Promise<boolean> {
  if (!isNative()) return false;
  const { invoke } = await import("@tauri-apps/api/core");
  await invoke("ensure_local_opencode", { endpoint, program: program ?? null });
  return true;
}

/** null means the browser preview cannot inspect the local installation. */
export async function detectLocalOpenCode(program?: string): Promise<boolean | null> {
  if (!isNative()) return null;
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<boolean>("detect_local_opencode", { program: program ?? null });
}
