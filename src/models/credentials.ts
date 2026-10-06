import { invoke } from "@tauri-apps/api/core";
export interface CredentialStore {
  get(endpoint: string): Promise<string | null>;
  set(endpoint: string, value: string): Promise<void>;
  delete(endpoint: string): Promise<void>;
}
const native = () => typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
export const systemCredentials: CredentialStore = {
  get: (endpoint) => native() ? invoke("model_service_key", { endpoint, action: "get", value: null }) : Promise.resolve(null),
  set: async (endpoint, value) => {
    if (native()) await invoke("model_service_key", { endpoint, action: "set", value });
  },
  delete: async (endpoint) => {
    if (native()) await invoke("model_service_key", { endpoint, action: "delete", value: null });
  },
};
