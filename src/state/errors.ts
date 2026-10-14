import { ApiError, ConnectionError } from "../api/client";
export function errText(e: unknown): string {
  if (e instanceof ApiError)
    return e.status === 404 ? "Not found on the OpenCode server" : e.detail;
  if (e instanceof ConnectionError) return e.message;
  if (e instanceof Error) return e.message;
  return String(e);
}
