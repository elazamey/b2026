const DEFAULT_MAX = 5;
const DEFAULT_WINDOW_MS = 1000 * 60 * 15;
const DEFAULT_IP_MAX = 20;

export class LoginLimiter {
  private readonly hits = new Map<string, number[]>();

  constructor(
    private readonly max = DEFAULT_MAX,
    private readonly windowMs = DEFAULT_WINDOW_MS,
    private readonly ipMax = DEFAULT_IP_MAX,
  ) {}

  blocked(ip: string, email: string, now = Date.now()): boolean {
    const normalized = email.trim().toLowerCase();
    return this.tooMany(`ip:${ip || "local"}`, this.ipMax, now) || this.tooMany(`id:${ip || "local"}:${normalized}`, this.max, now);
  }

  tooMany(key: string, max = this.max, now = Date.now()): boolean {
    const start = now - this.windowMs;
    const stamps = (this.hits.get(key) ?? []).filter((stamp) => stamp > start);
    if (stamps.length >= max) {
      this.hits.set(key, stamps);
      return true;
    }
    stamps.push(now);
    this.hits.set(key, stamps);
    return false;
  }
}

export function clientIp(headers?: Record<string, string | string[] | undefined>): string {
  if (!headers) return "local";
  const forwarded = headers["x-forwarded-for"] ?? headers["X-Forwarded-For"];
  const value = Array.isArray(forwarded) ? forwarded[0] : forwarded;
  if (value) return value.split(",")[0]?.trim() || "local";
  const real = headers["x-real-ip"] ?? headers["X-Real-Ip"];
  const realValue = Array.isArray(real) ? real[0] : real;
  return realValue?.trim() || "local";
}
