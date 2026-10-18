// IO layer for the shared Hub model catalog: fetch/publish over the Hub command
// and apply to the two engine configuration files through their native CAS writers.

import { capabilityNative } from "../capabilities/integration";
import {
  mergeOpencodeProviders,
  mergePiModels,
  planCatalog,
  type HubCatalog,
  type HubModel,
  type HubModelsPrefs,
} from "../models/catalog";

export const fetchCatalog = () =>
  capabilityNative<HubCatalog>("hub_model_catalog", {
    action: "get",
    models: null,
    adminKey: null,
  });

export const publishCatalog = (models: HubModel[], adminKey?: string, expectedVersion?: number) =>
  capabilityNative<HubCatalog>("hub_model_catalog", {
    action: "publish",
    models: { models, ...(expectedVersion === undefined ? {} : {expectedVersion}) },
    adminKey: adminKey?.trim() ? adminKey.trim() : null,
  });

export interface ApplyReport {
  opencodeChanged: boolean;
  piChanged: boolean;
  added: string[];
  replaced: string[];
  removed: string[];
}

/** Writes the effective catalog into opencode.jsonc and Pi models.json, then
 * returns the applied provider ids so the caller can persist them as `applied`. */
export async function applyCatalog(
  catalog: HubCatalog,
  prefs: HubModelsPrefs,
  onOpencodeApplied?: (appliedOpencode: string[]) => void,
): Promise<{ report: ApplyReport; appliedOpencode: string[]; appliedPi: string[] }> {
  if (!prefs.enabled) throw new Error("Применение каталога выключено на этом устройстве.");
  const plan = planCatalog(catalog, prefs);
  const { invoke } = await import("@tauri-apps/api/core");
  const oc = await invoke<{ content: string }>("read_opencode_config", {
    scope: "global",
    directory: null,
  });
  const pi = await invoke<{ content: string }>("read_pi_models");
  const ocMerge = mergeOpencodeProviders(oc.content, plan.opencode, plan.removeOpencode);
  const piMerge = mergePiModels(pi.content, plan.pi, plan.removePi);
  // Validate both before either write. CAS still guards each file against an
  // external edit; after a partial write persist ownership for a safe retry.
  if (ocMerge.error) throw new Error(ocMerge.error);
  if (piMerge.error) throw new Error(piMerge.error);
  if (ocMerge.changed)
    await invoke("write_opencode_config", {
      scope: "global",
      directory: null,
      expected: oc.content,
      content: ocMerge.text,
    });
  onOpencodeApplied?.(Object.keys(plan.opencode));
  if (piMerge.changed) {
    try {
      await invoke("write_pi_models", { expected: pi.content, content: piMerge.text });
    } catch (error) {
      throw new Error(`Настройки OpenCode применены; Pi не обновлён. Повторите применение после проверки models.json. ${String(error)}`);
    }
  }
  return {
    report: {
      opencodeChanged: ocMerge.changed,
      piChanged: piMerge.changed,
      added: [...new Set([...ocMerge.added, ...piMerge.added])],
      replaced: [...new Set([...ocMerge.replaced, ...piMerge.replaced])],
      removed: [...new Set([...ocMerge.removed, ...piMerge.removed])],
    },
    appliedOpencode: Object.keys(plan.opencode),
    appliedPi: Object.keys(plan.pi),
  };
}
