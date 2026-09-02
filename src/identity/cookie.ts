import { CSRF_COOKIE, SESSION_COOKIE } from "./types.js";

export interface CookieFlags {
  secure?: boolean;
  maxAgeSeconds?: number;
}

export function readSessionToken(cookieHeader: string | null): string | null {
  return readCookie(cookieHeader, SESSION_COOKIE);
}

export function readCsrfToken(cookieHeader: string | null): string | null {
  return readCookie(cookieHeader, CSRF_COOKIE);
}

export function readCookie(cookieHeader: string | null, name: string): string | null {
  if (!cookieHeader) return null;
  for (const part of cookieHeader.split(";")) {
    const [rawName, ...rest] = part.trim().split("=");
    if (rawName === name) {
      const value = rest.join("=").trim();
      return value || null;
    }
  }
  return null;
}

export function sessionCookie(token: string, flags: CookieFlags = {}): string {
  return serializeCookie(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "Lax",
    path: "/",
    maxAgeSeconds: flags.maxAgeSeconds ?? 60 * 60 * 24 * 7,
    secure: flags.secure,
  });
}

export function csrfCookie(token: string, flags: CookieFlags = {}): string {
  return serializeCookie(CSRF_COOKIE, token, {
    httpOnly: true,
    sameSite: "Lax",
    path: "/",
    maxAgeSeconds: flags.maxAgeSeconds ?? 60 * 60 * 8,
    secure: flags.secure,
  });
}

export function clearSessionCookie(flags: CookieFlags = {}): string {
  return serializeCookie(SESSION_COOKIE, "", {
    httpOnly: true,
    sameSite: "Lax",
    path: "/",
    maxAgeSeconds: 0,
    secure: flags.secure,
  });
}

export function serializeCookie(
  name: string,
  value: string,
  options: {
    httpOnly: boolean;
    sameSite: "Lax" | "Strict";
    path: string;
    maxAgeSeconds: number;
    secure?: boolean;
  },
): string {
  const parts = [
    `${name}=${value}`,
    `Path=${options.path}`,
    options.httpOnly ? "HttpOnly" : "",
    `SameSite=${options.sameSite}`,
    `Max-Age=${options.maxAgeSeconds}`,
    options.secure ? "Secure" : "",
  ].filter(Boolean);
  return parts.join("; ");
}

export function requestIsSecure(headers?: Record<string, string | string[] | undefined>): boolean {
  const proto = firstHeader(headers, "x-forwarded-proto") || firstHeader(headers, "x-forwarded-protocol");
  return proto.split(",")[0]?.trim().toLowerCase() === "https";
}

function firstHeader(
  headers: Record<string, string | string[] | undefined> | undefined,
  name: string,
): string {
  if (!headers) return "";
  const raw = headers[name] ?? headers[name.toLowerCase()];
  if (Array.isArray(raw)) return raw[0] ?? "";
  return raw ?? "";
}
