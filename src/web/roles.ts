export type Role = "anonymous" | "user" | "developer" | "owner";

export const SESSION_COOKIE = "guardian_role";

export const ROLE_CAPABILITIES = {
  may_decide: false,
  may_merge: false,
  may_override: false,
  may_edit_contract: false,
  may_rewrite_decision: false,
} as const;

export function readRole(
  headers?: Record<string, string | string[] | undefined>,
): Role {
  const cookie = headerValue(headers, "cookie");
  const match = cookie.match(/(?:^|;\s*)guardian_role=(user|developer|owner)(?:;|$)/);
  const role = match?.[1];
  if (role === "user" || role === "developer" || role === "owner") return role;
  return "anonymous";
}

export function parseRole(value: string | undefined): Role | null {
  if (value === "user" || value === "developer" || value === "owner") return value;
  return null;
}

export function sessionCookie(role: Role): string {
  if (role === "anonymous") {
    return `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`;
  }
  return `${SESSION_COOKIE}=${role}; Path=/; HttpOnly; SameSite=Lax`;
}

export function canAccessApp(role: Role): boolean {
  return role === "user" || role === "developer" || role === "owner";
}

export function canAccessAdmin(role: Role): boolean {
  return role === "owner";
}

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
