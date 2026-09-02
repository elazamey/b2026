export type ProjectRole = "user" | "developer" | "owner";

export const SESSION_COOKIE = "guardian_session";

export const IDENTITY_CAPABILITIES = {
  may_decide: false,
  may_merge: false,
  may_override: false,
  may_edit_contract: false,
  may_rewrite_decision: false,
} as const;

export interface User {
  id: string;
  email: string;
  password_hash: string;
  platform_admin: boolean;
  created_at: string;
}

export interface Session {
  id: string;
  user_id: string;
  token_hash: string;
  created_at: string;
  expires_at: string;
}

export interface Project {
  id: string;
  name: string;
  repository: string;
  created_by: string;
  created_at: string;
}

export interface Membership {
  user_id: string;
  project_id: string;
  role: ProjectRole;
}

export interface Principal {
  user: User;
  memberships: Membership[];
  projects: Project[];
}

export interface IdentityStore {
  createUser(input: {
    email: string;
    password: string;
    platform_admin?: boolean;
  }): Promise<User>;
  authenticate(email: string, password: string): Promise<User | null>;
  createSession(userId: string): Promise<{ token: string; session: Session }>;
  getPrincipal(token: string | null): Promise<Principal | null>;
  revokeSession(token: string): Promise<void>;
  createProject(input: {
    name: string;
    repository: string;
    ownerId: string;
  }): Promise<Project>;
  addMembership(input: {
    userId: string;
    projectId: string;
    role: ProjectRole;
  }): Promise<Membership>;
  getProject(id: string): Promise<Project | null>;
}

export function publicUser(user: User): Omit<User, "password_hash"> {
  const { password_hash: _secret, ...rest } = user;
  void _secret;
  return rest;
}
