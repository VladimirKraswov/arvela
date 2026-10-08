import type { AppState } from './types';
import type { ModelInfo, Session } from '../api/types';
import type { PiHealth } from '../agent/pi/backend';
import { PI_BACKEND_ID } from '../agent/pi/backend';
import { modelScope } from './engines';
export interface ModelChoice { providerID: string; modelID: string; variant?: string | null }
/** Selection policy on already-normalized data. No network, probes, writes or fallback to another engine. */
export function chooseOpenCodeModel(state: AppState, context: {
  projectless: boolean; activeModel?: Session['model']; agentName: string | null;
  defaultVariant: (providerID: string, modelID: string) => string | null;
}): ModelChoice | null {
    const dir = context.projectless ? "@chats" : (state.directory ?? "");
    const sessionId = state.activeSessionId;
    const sessionChoice = sessionId
      ? state.prefs.modelChoice[`session:${sessionId}`]
      : undefined;
    if (sessionChoice && state.connectedProviderIds.includes(sessionChoice.providerID))
      return sessionChoice;
    const active = sessionId
      ? context.activeModel
      : undefined;
    if (active?.id && state.connectedProviderIds.includes(active.providerID)) {
      return {
        providerID: active.providerID,
        modelID: active.id,
        variant: active.variant ?? null,
      };
    }
    const stored =
      state.prefs.modelChoice[dir] ?? state.prefs.modelChoice["*"];
    if (stored && state.connectedProviderIds.includes(stored.providerID))
      return stored;
    const agent = state.agents.find(
      (a) => a.name === context.agentName,
    );
    if (
      agent?.model &&
      state.connectedProviderIds.includes(agent.model.providerID)
    ) {
      return {
        ...agent.model,
        variant:
          agent.variant ??
          context.defaultVariant(agent.model.providerID, agent.model.modelID),
      };
    }
    const configured = state.configModel?.split("/");
    if (
      configured &&
      configured.length > 1 &&
      state.connectedProviderIds.includes(configured[0])
    ) {
      return {
        providerID: configured[0],
        modelID: configured.slice(1).join("/"),
        variant: context.defaultVariant(
          configured[0],
          configured.slice(1).join("/"),
        ),
      };
    }
    const defaults = state.providerDefaults;
    if (defaults) {
      for (const [pid, mid] of Object.entries(defaults)) {
        if (state.connectedProviderIds.includes(pid))
          return {
            providerID: pid,
            modelID: mid,
            variant: context.defaultVariant(pid, mid),
          };
      }
    }
    for (const pid of state.connectedProviderIds) {
      const provider = state.providers.find((p) => p.id === pid);
      const first = provider && Object.values(provider.models)[0];
      if (first)
        return {
          providerID: pid,
          modelID: first.id,
          variant: context.defaultVariant(pid, first.id),
        };
    }
    return null;
}

/** Pi catalog entries require existing access evidence; never reuse OpenCode's provider defaults. */
export function choosePiModel(state: AppState, directory: string | null): ModelChoice | null {
    const models = state.piHealth?.models ?? [];
    const custom = parseModelId(state.prefs.pi?.customModel);
    const verified = (choice: { providerID: string; modelID: string }) => {
      const id = `${choice.providerID}/${choice.modelID}`;
      return state.prefs.pi?.verifiedModel === id ||
        Boolean(state.prefs.pi?.verifiedModels?.[id]);
    };
    const usable = (choice: { providerID: string; modelID: string } | undefined) => {
      return choice?.providerID && choice.modelID && verified(choice) ? choice : undefined;
    };
    const sessionId = state.activeSessionId;
    const keys = [
      sessionId ? modelScope(PI_BACKEND_ID, `session:${sessionId}`) : undefined,
      modelScope(PI_BACKEND_ID, directory ?? "@chats"),
      modelScope(PI_BACKEND_ID, "*"),
    ].filter((k): k is string => Boolean(k));
    for (const key of keys) {
      const stored = usable(state.prefs.modelChoice[key]);
      if (stored) return stored;
    }
    if (custom && verified(custom))
      return { ...custom, variant: state.prefs.pi?.thinking ?? null };
    const configured = usable(parseModelId(state.prefs.pi?.model) ?? undefined);
    if (configured)
      return { ...configured, variant: state.prefs.pi?.thinking ?? null };
    const first = models.find((m) => verified({ providerID: m.provider, modelID: m.id }));
    return first
      ? { providerID: first.provider, modelID: first.id, variant: null }
      : null;
}

export function parseModelId(
  value: string | undefined | null,
): { providerID: string; modelID: string } | null {
  const parts = (value ?? "").trim().split("/");
  if (parts.length < 2 || !parts[0] || !parts.slice(1).join("/")) return null;
  return { providerID: parts[0], modelID: parts.slice(1).join("/") };
}

export function piModelInfo(
  health: PiHealth | null,
  choice: { providerID: string; modelID: string },
): ModelInfo | null {
  const model = health?.models.find(
    (m) => m.provider === choice.providerID && m.id === choice.modelID,
  );
  // A custom model Pi accepts but does not describe still needs *some*
  // metadata, or the attachment pipeline would refuse the whole prompt. Assume
  // the conservative shape: text only.
  if (!model)
    return {
      id: choice.modelID,
      name: choice.modelID,
      attachment: false,
      reasoning: false,
      input: ["text"],
      limit: {},
    } as unknown as ModelInfo;
  return {
    id: model.id,
    providerID: model.provider,
    name: model.name ?? model.id,
    attachment: (model.input ?? []).includes("image"),
    reasoning: Boolean(model.reasoning),
    input: model.input ?? ["text"],
    limit: { context: model.contextWindow, output: model.maxTokens },
  } as unknown as ModelInfo;
}

