# Public product UI (v0.7.1)

The user product and the engineering Control Plane share one Vercel deployment. They do not share authority.

```text
/            public marketing
/login       local session (MVP)
/register    local session (MVP)
/app/*       authenticated users
/settings    account
/admin/*     owners only — existing Control Plane
```

## Roles

| Role | Sees | Cannot |
| --- | --- | --- |
| User | Projects and scan health | Admin, override, merge |
| Developer | That, plus PR/commit hashes | Admin, override, merge |
| Owner | `/admin` Control Plane | Change a sealed decision |

Guardian stays outside every role:

```text
User / Developer / Owner → Application UI → READ
Guardian → DECIDE
GitHub → ENFORCE
```

There is no **Override** or **Approve anyway** control.

## Session

v0.7.1 uses a local `guardian_role` cookie so the product shell can be designed without a paid identity provider. GitHub OAuth can replace this later. The cookie cannot rewrite `result`, `contract_hash`, or `evidence_hash`.

## Same host, no extra server

`ai-guardian plane` and the Vercel function serve this tree. No second VPS.

```text
/            public
/app/*       users and developers
/admin/*     owners — Control Plane
```
