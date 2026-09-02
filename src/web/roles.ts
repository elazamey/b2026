import { IDENTITY_CAPABILITIES } from "../identity/types.js";

/** Display-only. Never an authorization source. */
export type Role = "anonymous" | "user" | "developer" | "owner";

export const ROLE_CAPABILITIES = IDENTITY_CAPABILITIES;

export function parseForm(body: string): Record<string, string> {
  const params = new URLSearchParams(body);
  const out: Record<string, string> = {};
  for (const [key, value] of params.entries()) {
    out[key] = value;
  }
  return out;
}

export function headerValue(
  headers: Record<string, string | string[] | undefined> | undefined,
  name: string,
): string {
  if (!headers) return "";
  const raw = headers[name] ?? headers[name.toLowerCase()];
  if (Array.isArray(raw)) return raw.join(";");
  return raw ?? "";
}
