import { SESSION_COOKIE } from "./types.js";

export function readSessionToken(cookieHeader: string | null): string | null {
  if (!cookieHeader) return null;
  for (const part of cookieHeader.split(";")) {
    const [rawName, ...rest] = part.trim().split("=");
    if (rawName === SESSION_COOKIE) {
      const value = rest.join("=").trim();
      return value || null;
    }
  }
  return null;
}

export function sessionCookie(token: string, maxAgeSeconds = 60 * 60 * 24 * 7): string {
  return [
    `${SESSION_COOKIE}=${token}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    `Max-Age=${maxAgeSeconds}`,
  ].join("; ");
}

export function clearSessionCookie(): string {
  return `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`;
}
