// Registry of available agent backends.
//
// OpenCode is registered here and is the default. Adding another agent runtime
// means implementing `AgentBackend` and registering its descriptor — no change to
// the store, components or preference schema. Nothing else is implemented today;
// `listBackendDescriptors()` returning a single entry is the honest current state.

import type { AgentBackend, AgentBackendDescriptor } from "./backend";
import { openCodeDescriptor } from "./opencode";

export const DEFAULT_BACKEND_ID = openCodeDescriptor.id;

const descriptors = new Map<string, AgentBackendDescriptor>([
  [openCodeDescriptor.id, openCodeDescriptor],
]);

export function registerBackendDescriptor(
  descriptor: AgentBackendDescriptor,
): void {
  descriptors.set(descriptor.id, descriptor);
}

export function listBackendDescriptors(): AgentBackendDescriptor[] {
  return [...descriptors.values()];
}

/** Exact lookup. Returns undefined so a caller can refuse instead of guessing. */
export function findBackendDescriptor(
  id?: string | null,
): AgentBackendDescriptor | undefined {
  return id ? descriptors.get(id) : undefined;
}

/**
 * Lenient lookup for start-up, where the app must end up with *some* backend.
 * Never use it to re-create an already active backend: falling back there would
 * silently move a live workspace onto a different agent runtime.
 */
export function backendDescriptor(id?: string | null): AgentBackendDescriptor {
  return findBackendDescriptor(id) ?? descriptors.get(DEFAULT_BACKEND_ID)!;
}

export function createBackend(
  id: string | null | undefined,
  endpoint: string,
): AgentBackend {
  return backendDescriptor(id).create(endpoint);
}
