import type { Principal, Project } from "./types.js";
import { IDENTITY_CAPABILITIES } from "./types.js";

export { IDENTITY_CAPABILITIES };

export function canAccessApp(principal: Principal | null): boolean {
  return principal !== null;
}

export function canAccessAdmin(principal: Principal | null): boolean {
  return Boolean(principal?.user.platform_admin);
}

export function canReadProject(principal: Principal | null, project: Project): boolean {
  if (!principal) return false;
  if (principal.user.platform_admin) return true;
  return principal.memberships.some((item) => item.project_id === project.id);
}

export function visibleRepositories(principal: Principal | null): Set<string> {
  if (!principal) return new Set();
  if (principal.user.platform_admin) return new Set(principal.projects.map((item) => item.repository));
  const ids = new Set(principal.memberships.map((item) => item.project_id));
  return new Set(principal.projects.filter((item) => ids.has(item.id)).map((item) => item.repository));
}

export function canSeeHashes(principal: Principal | null): boolean {
  if (!principal) return false;
  if (principal.user.platform_admin) return true;
  return principal.memberships.some((item) => item.role === "developer" || item.role === "owner");
}

export function assertCannotDecide(): void {
  if (IDENTITY_CAPABILITIES.may_decide || IDENTITY_CAPABILITIES.may_override) {
    throw new Error("Identity layer cannot decide or override Guardian.");
  }
}
