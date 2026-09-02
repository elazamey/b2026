# Identity & authorization (v0.7.2)

Authentication is not a role cookie. Changing a cookie cannot promote a user to platform admin.

```text
Authentication  →  User identity  →  Session  →  Authorization  →  Resource ownership
```

## Entities

| Entity | Meaning |
| --- | --- |
| User | Email + scrypt password hash. Optional `platform_admin`. |
| Session | Opaque `guardian_session` cookie. Server stores only the SHA-256 of the token. |
| Project | A named repository the user linked. |
| Membership | `user` / `developer` / `owner` **on that project**. |
| Role | Permission on a resource. Not identity. Not platform admin. |

Owner of Project A is not a platform administrator unless `platform_admin` is set on the user.

## What the cookie is

`guardian_session` is an unguessable token. The product **ignores** `guardian_role`. There is no role picker on `/login` or `/register`.

The first platform admin is bootstrapped with `GUARDIAN_BOOTSTRAP_ADMIN_EMAIL` (env only) or a store API call. Never a form field.

## What identity cannot do

```text
User / Developer / Owner / platform_admin  →  Application UI  →  READ
Guardian  →  DECIDE
GitHub    →  ENFORCE
```

Identity cannot:

- emit `SAFE_TO_MERGE`
- rewrite a sealed `result`
- edit `architecture.yaml`
- grant `/admin` by cookie tampering

`/admin` is checked server-side against `platform_admin` on the session's user.

## Scope of this release

A signed-in user can create a project, keep a membership, and see Guardian results for repositories they belong to. That is the product loop. GitHub OAuth and team invites come later.
