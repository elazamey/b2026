# Public product UI (v0.7.3)

The user product and the engineering Control Plane share one Vercel deployment. They do not share authority.

```text
/            public marketing
/login       email + password → server session
/register    email + password → server session
/app/*       authenticated users (own projects)
/settings    account
/admin/*     platform_admin only — existing Control Plane
```

## Identity vs role vs ownership

See [`docs/identity.md`](identity.md).

| Actor | Sees | Cannot |
| --- | --- | --- |
| Signed-out | Marketing | `/app`, `/admin` |
| User with project membership | Own project health | Other projects, `/admin`, override, merge |
| Project owner | That project | Platform admin unless `platform_admin` |
| `platform_admin` | `/admin` Control Plane | Change a sealed decision |

Guardian stays outside every identity:

```text
User / Developer / Owner / platform_admin → Application UI → READ
Guardian → DECIDE
GitHub → ENFORCE
```

There is no **Override** or **Approve anyway** control.

## Session

v0.7.3 uses an opaque `guardian_session` cookie (HttpOnly, SameSite=Lax, Path=/, Secure on HTTPS). The previous `guardian_role` cookie is ignored. POST forms require a CSRF token. Tampering with either cookie cannot grant Admin. The session cannot rewrite `result`, `contract_hash`, or `evidence_hash`.

## Same host, no extra server

`ai-guardian plane` and the Vercel function serve this tree. No second VPS.

```text
/            public
/app/*       signed-in users, scoped to memberships
/admin/*     platform_admin — Control Plane
```
