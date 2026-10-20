import type { OpenCodeClient } from '../api/client';
import type { PermissionRequest } from '../api/types';
import { accessMode } from '../state/access';

// OpenCode 1.18.x's processor evaluates doom_loop against agent rules only.
// Honor the user's explicit full-session policy through the official reply API.
// Keep this compatibility exception out of UI components and global agent config.
export class FullAccessLoop {
  private attempts = new Map<string, Promise<boolean>>();
  constructor(private client: OpenCodeClient) {}

  resolve(request: PermissionRequest, directory: string | null, signal?: AbortSignal): Promise<boolean> {
    if (request.permission !== 'doom_loop' || !directory || !request.id || !request.sessionID)
      return Promise.resolve(false);
    const key = JSON.stringify([directory, request.sessionID, request.id]);
    const previous = this.attempts.get(key);
    if (previous) return previous;
    const policySignal = AbortSignal.any([signal ?? new AbortController().signal, AbortSignal.timeout(10000)]);
    const headers = this.client.headers;
    let posted = false;
    const current = () => !policySignal.aborted && headers === this.client.headers;
    const attempt = (async () => {
      try {
        const seen = new Set<string>();
        let id = request.sessionID;
        for (let depth = 0; depth < 32 && current(); depth++) {
          if (seen.has(id)) return false;
          seen.add(id);
          const session = await this.client.getSession(id, directory, policySignal);
          if (!current() || session.id !== id || session.directory !== directory) return false;
          if (session.parentID) { id = session.parentID; continue; }
          if (accessMode(session.permission) !== 'full') return false;
          posted = true;
          await this.client.replyPermission(request.id, 'once', directory);
          return true;
        }
      } catch {
        // Stale request, unavailable policy or ambiguous reply: leave manual UI.
        // Never retry, replay a tool, or install a global "always" grant.
      }
      return false;
    })().then(result => {
      // A later mode change can authorize a still-pending request. Only replies
      // with a potentially delivered POST must remain deduplicated.
      if (!posted) this.attempts.delete(key);
      return result;
    });
    this.attempts.set(key, attempt);
    if (this.attempts.size > 256) this.attempts.delete(this.attempts.keys().next().value!);
    return attempt;
  }
}
