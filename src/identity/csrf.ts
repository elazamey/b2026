import { randomToken } from "./crypto.js";
import { readCsrfToken } from "./cookie.js";

export function newCsrfToken(): string {
  return randomToken();
}

export function csrfFromCookie(cookieHeader: string | null): string | null {
  const token = readCsrfToken(cookieHeader);
  if (!token || token.length < 16) return null;
  return token;
}

export function csrfMatches(cookieToken: string | null, formToken: string | undefined): boolean {
  if (!cookieToken || !formToken) return false;
  if (cookieToken.length !== formToken.length) return false;
  let diff = 0;
  for (let i = 0; i < cookieToken.length; i += 1) {
    diff |= cookieToken.charCodeAt(i) ^ formToken.charCodeAt(i);
  }
  return diff === 0;
}

export function originAllowed(
  headers: Record<string, string | string[] | undefined> | undefined,
  requestUrl: URL,
): boolean {
  const origin = header(headers, "origin");
  if (!origin) return true;
  try {
    const parsed = new URL(origin);
    const forwarded = header(headers, "x-forwarded-host");
    const host = forwarded || header(headers, "host");
    if (host) {
      return parsed.host === host.split(",")[0]?.trim();
    }
    return parsed.host === requestUrl.host;
  } catch {
    return false;
  }
}

function header(
  headers: Record<string, string | string[] | undefined> | undefined,
  name: string,
): string {
  if (!headers) return "";
  const raw = headers[name] ?? headers[name.toLowerCase()];
  if (Array.isArray(raw)) return raw[0] ?? "";
  return raw ?? "";
}
