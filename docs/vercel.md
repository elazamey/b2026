# Free Vercel hosting (v0.7)

Vercel hosts the **Control Plane** only. It does not run Guardian and it is not the merge gate.

```text
Browser → Vercel → Control Plane → Turso   (read)
GitHub Actions → Guardian → ai-guardian    (decide / enforce)
```

`ai-guardian check` must keep working when Vercel, Turso, Arena, and Gemini are all off.

## Production readiness

```bash
npm run build
node dist/cli.js check
node dist/cli.js plane --host 0.0.0.0 --port 4173
```

GET is allowed. POST / PUT / PATCH / DELETE return **405**. A down Turso/Vercel degrades the dashboard (503) and does **not** change `SAFE_TO_MERGE` / `REJECTED`.

## Environment isolation

Set these in the Vercel project **Environment Variables** UI, never in Git:

```text
TURSO_DATABASE_URL
TURSO_AUTH_TOKEN
```

They must not appear in `architecture.yaml`, the decision ledger, or the PR comment. Local `.env` is gitignored. `.env.example` stays empty.

## Deploy (Hobby / free)

1. Import `elazamey/b2026` into Vercel
2. Framework preset: **Other**
3. Build command: `npm run build` (from `vercel.json`)
4. Add the two Turso env vars
5. Deploy

Root Directory stays the repository root. Do not set Guardian as a Vercel build check.

## What this is not

- Not a Vercel deploy gate for merge
- Not an always-on VPS
- Not a place to approve PRs
- Not required for `ai-guardian check`
