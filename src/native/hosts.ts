export interface RemoteHost {
  id: string;
  name: string;
  target: string;
  port: number;
}
export interface ChatWorkspace {
  directory: string;
  root: string;
}
export const LOCAL_HOST = "local";
export function remoteKey(host: RemoteHost): string {
  return `ssh:${host.target}:${host.port}`;
}
export function validRemote(
  host: Pick<RemoteHost, "target" | "port">,
): boolean {
  return (
    /^[a-zA-Z0-9_][a-zA-Z0-9_.@:%\[\]-]{0,252}$/.test(host.target) &&
    Number.isInteger(host.port) &&
    host.port > 0 &&
    host.port <= 65535
  );
}
export async function sshAliases(): Promise<string[]> {
  if (!("__TAURI_INTERNALS__" in window)) return [];
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke("ssh_aliases");
}
export async function connectSsh(host: RemoteHost): Promise<string> {
  if (!validRemote(host))
    throw new Error(
      "Укажите SSH-алиас или user@host и корректный порт OpenCode.",
    );
  if (!("__TAURI_INTERNALS__" in window))
    throw new Error(
      "SSH-подключения доступны в установленном Arvela.",
    );
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke("connect_ssh", { target: host.target, port: host.port });
}
export async function prepareChat(
  host: RemoteHost | undefined,
  serverHome: string,
): Promise<ChatWorkspace> {
  if (!("__TAURI_INTERNALS__" in window))
    throw new Error(
      "Для создания отдельной рабочей папки чата откройте установленный Arvela.",
    );
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke("prepare_chat_workspace", {
    id: crypto.randomUUID(),
    sshTarget: host?.target ?? null,
    serverHome,
  });
}
// OpenCode HTTP passwords stay only in memory, never in preferences or URLs.
const credentials = new Map<string, string>();
export function setHostPassword(key: string, password: string) {
  if (!password) {
    credentials.delete(key);
    return;
  }
  const bytes = new TextEncoder().encode(`opencode:${password}`);
  credentials.set(key, `Basic ${btoa(String.fromCharCode(...bytes))}`);
}
export function hostHeaders(key: string): Record<string, string> {
  const auth = credentials.get(key);
  return auth ? { Authorization: auth } : {};
}
