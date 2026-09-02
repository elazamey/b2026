# Identity & authorization (v0.7.3)

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

## Session cookie

`guardian_session` is HttpOnly, Path=/, SameSite=Lax, Max-Age=7d, and **Secure** on HTTPS (`x-forwarded-proto`). The product ignores `guardian_role`. Sessions expire and can be revoked on logout.

## CSRF

POST `/login`, `/register`, `/logout`, and `/app/projects` require a matching `guardian_csrf` cookie and form field. A mismatching `Origin` is rejected. SameSite=Lax is not the only control.

## Resource authorization

```text
authenticated user
      ↓
load project by id
      ↓
membership lookup
      ↓
allowed? → return resource
otherwise → 404
```

`/admin` is `platform_admin` only. Membership is not admin. Admin is not membership.

## Admin bootstrap

`GUARDIAN_BOOTSTRAP_ADMIN_EMAIL` grants `platform_admin` **once**, only if no platform admin exists yet. The used bootstrap is persisted. Later registers with that email do not become admin (and the email is unique anyway). Never a form field.

## Login abuse

Failed and repeated sign-in/register POSTs are rate-limited per IP and per IP+email so scrypt cannot be used as a cheap CPU weapon.

## What identity cannot do

```text
User / Developer / Owner / platform_admin  →  Application UI  →  READ
Guardian  →  DECIDE
GitHub    →  ENFORCE
```
