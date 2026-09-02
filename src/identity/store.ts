import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { hashPassword, hashToken, newId, randomToken, verifyPassword } from "./crypto.js";
import type { IdentityStore, Membership, Principal, Project, ProjectRole, Session, User } from "./types.js";

const SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 7;

interface IdentityDump {
  users: User[];
  sessions: Session[];
  projects: Project[];
  memberships: Membership[];
}

export class MemoryIdentityStore implements IdentityStore {
  protected users = new Map<string, User>();
  protected sessions = new Map<string, Session>();
  protected projects = new Map<string, Project>();
  protected memberships: Membership[] = [];

  constructor(private readonly bootstrapAdminEmail?: string) {}

  async createUser(input: {
    email: string;
    password: string;
    platform_admin?: boolean;
  }): Promise<User> {
    const email = normalizeEmail(input.email);
    if (!email || !email.includes("@")) throw new Error("Invalid email.");
    if (!input.password || input.password.length < 8) {
      throw new Error("Password must be at least 8 characters.");
    }
    if ([...this.users.values()].some((user) => user.email === email)) {
      throw new Error("Email already registered.");
    }
    const bootstrap = this.bootstrapAdminEmail
      ? normalizeEmail(this.bootstrapAdminEmail) === email
      : false;
    const user: User = {
      id: newId("usr"),
      email,
      password_hash: hashPassword(input.password),
      platform_admin: Boolean(input.platform_admin) || bootstrap,
      created_at: new Date().toISOString(),
    };
    this.users.set(user.id, user);
    this.persist();
    return user;
  }

  async authenticate(email: string, password: string): Promise<User | null> {
    const normalized = normalizeEmail(email);
    const user = [...this.users.values()].find((item) => item.email === normalized);
    if (!user) return null;
    if (!verifyPassword(password, user.password_hash)) return null;
    return user;
  }

  async createSession(userId: string): Promise<{ token: string; session: Session }> {
    if (!this.users.has(userId)) throw new Error("Unknown user.");
    const token = randomToken();
    const now = Date.now();
    const session: Session = {
      id: newId("ses"),
      user_id: userId,
      token_hash: hashToken(token),
      created_at: new Date(now).toISOString(),
      expires_at: new Date(now + SESSION_TTL_MS).toISOString(),
    };
    this.sessions.set(session.id, session);
    this.persist();
    return { token, session };
  }

  async getPrincipal(token: string | null): Promise<Principal | null> {
    if (!token) return null;
    const tokenHash = hashToken(token);
    const session = [...this.sessions.values()].find((item) => item.token_hash === tokenHash);
    if (!session) return null;
    if (Date.parse(session.expires_at) <= Date.now()) {
      this.sessions.delete(session.id);
      this.persist();
      return null;
    }
    const user = this.users.get(session.user_id);
    if (!user) return null;
    const memberships = this.memberships.filter((item) => item.user_id === user.id);
    const projectIds = new Set(memberships.map((item) => item.project_id));
    const projects = [...this.projects.values()].filter(
      (item) => user.platform_admin || projectIds.has(item.id),
    );
    return { user, memberships, projects };
  }

  async revokeSession(token: string): Promise<void> {
    const tokenHash = hashToken(token);
    for (const [id, session] of this.sessions) {
      if (session.token_hash === tokenHash) this.sessions.delete(id);
    }
    this.persist();
  }

  async createProject(input: {
    name: string;
    repository: string;
    ownerId: string;
  }): Promise<Project> {
    if (!this.users.has(input.ownerId)) throw new Error("Unknown user.");
    const repository = input.repository.trim();
    if (!repository.includes("/")) throw new Error("Repository must be owner/name.");
    const project: Project = {
      id: newId("prj"),
      name: input.name.trim() || repository,
      repository,
      created_by: input.ownerId,
      created_at: new Date().toISOString(),
    };
    this.projects.set(project.id, project);
    this.memberships.push({ user_id: input.ownerId, project_id: project.id, role: "owner" });
    this.persist();
    return project;
  }

  async addMembership(input: {
    userId: string;
    projectId: string;
    role: ProjectRole;
  }): Promise<Membership> {
    if (!this.users.has(input.userId) || !this.projects.has(input.projectId)) {
      throw new Error("Unknown user or project.");
    }
    const existing = this.memberships.find(
      (item) => item.user_id === input.userId && item.project_id === input.projectId,
    );
    if (existing) {
      existing.role = input.role;
      this.persist();
      return existing;
    }
    const membership: Membership = {
      user_id: input.userId,
      project_id: input.projectId,
      role: input.role,
    };
    this.memberships.push(membership);
    this.persist();
    return membership;
  }

  async getProject(id: string): Promise<Project | null> {
    return this.projects.get(id) ?? null;
  }

  protected persist(): void {
    /* memory store */
  }

  protected load(dump: IdentityDump): void {
    this.users = new Map(dump.users.map((item) => [item.id, item]));
    this.sessions = new Map(dump.sessions.map((item) => [item.id, item]));
    this.projects = new Map(dump.projects.map((item) => [item.id, item]));
    this.memberships = dump.memberships;
  }

  dump(): IdentityDump {
    return {
      users: [...this.users.values()],
      sessions: [...this.sessions.values()],
      projects: [...this.projects.values()],
      memberships: [...this.memberships],
    };
  }
}

export class FileIdentityStore extends MemoryIdentityStore {
  constructor(
    private readonly filePath: string,
    bootstrapAdminEmail?: string,
  ) {
    super(bootstrapAdminEmail);
    if (existsSync(this.filePath)) {
      try {
        const parsed = JSON.parse(readFileSync(this.filePath, "utf8")) as IdentityDump;
        this.load({
          users: parsed.users ?? [],
          sessions: parsed.sessions ?? [],
          projects: parsed.projects ?? [],
          memberships: parsed.memberships ?? [],
        });
      } catch {
        /* start empty */
      }
    }
  }

  protected override persist(): void {
    mkdirSync(dirname(this.filePath), { recursive: true });
    writeFileSync(this.filePath, `${JSON.stringify(this.dump(), null, 2)}\n`, "utf8");
  }
}

export function defaultIdentityPath(root: string): string {
  return resolve(root, ".guardian", "identity.json");
}

export function createIdentityStore(options: {
  root: string;
  env?: NodeJS.ProcessEnv;
}): IdentityStore {
  return new FileIdentityStore(
    defaultIdentityPath(options.root),
    options.env?.GUARDIAN_BOOTSTRAP_ADMIN_EMAIL,
  );
}

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}
