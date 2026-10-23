# Traxion QA

AI-assisted QA platform: upload requirements → AI analysis → test cases → Playwright scripts →
sandboxed runs with a live view → reports. **Nothing runs against a target app until a tester has
approved the test case and its script.**

Status: **Phase 1 (Foundation)** — auth & roles, projects, uploads with text extraction / OCR,
background jobs, security headers, CI. AI features arrive in Phase 2.

## Requirements

- Node.js **24 LTS** (see `.nvmrc`; Prisma 7 does not support Node 23)
- Docker Desktop (for Postgres, Redis, SeaweedFS and the app/worker containers)

## Quick start (everything in Docker)

```bash
cp .env.example .env            # then replace every "change-me" value
docker compose up -d --build --wait app worker
docker compose run --rm -e SEED_ADMIN_EMAIL -e SEED_ADMIN_NAME -e SEED_ADMIN_PASSWORD \
  --env-file .env migrate node dist/seed.mjs     # creates the first Admin from .env
```

Open http://localhost:3000 and sign in with `SEED_ADMIN_EMAIL` / `SEED_ADMIN_PASSWORD`.
There is no public sign-up: Admins create every account on the **Users** page.

## Local development (app on your machine, services in Docker)

```bash
npm ci
docker compose up -d postgres redis seaweedfs storage-init
npm run db:deploy && npm run db:seed
npm run dev            # http://localhost:3000
npm run dev:worker     # background jobs (text extraction, OCR)
```

## Checks

| Command                    | What it does                                                     |
| -------------------------- | ---------------------------------------------------------------- |
| `npm run typecheck`        | TypeScript strict mode                                           |
| `npm run lint`             | ESLint, zero warnings allowed                                    |
| `npm run format:check`     | Prettier                                                         |
| `npm run test:unit`        | Validators, upload checks, extraction + OCR, security units      |
| `npm run test:integration` | API + authorization + upload + job tests on `TEST_DATABASE_URL`  |
| `npm run test:e2e`         | Playwright against a running stack (`E2E_EMAIL`, `E2E_PASSWORD`) |
| `npm run build`            | Next.js production build + worker bundle                         |

Integration tests **wipe** `TEST_DATABASE_URL`; it must differ from `DATABASE_URL`.

## Roles

| Role            | Can                                                                   |
| --------------- | --------------------------------------------------------------------- |
| Admin / QA Lead | Everything: users, all projects, members, archive, URL allowlist      |
| QA Tester       | Upload, generate, review, run — only in projects they are a member of |
| Viewer          | Read-only — only in projects they are a member of                     |

## Security notes

- Sessions: random token in an HttpOnly, SameSite=Lax cookie (`__Host-`/Secure over HTTPS);
  only its SHA-256 is stored. Passwords use argon2id. Login is rate-limited per email+IP,
  per email and per IP.
- CSRF: same-origin check plus a per-session token header on every state-changing request.
- Every project query goes through `requireProjectAccess`; other teams' data returns 404.
- Uploads: magic-byte detection, 25 MB limit enforced while streaming, random storage keys,
  PDFs with scripts/attachments and macro/ActiveX Word files are rejected, images are re-encoded
  (metadata and appended payloads stripped), downloads are always `attachment` + `nosniff`.
- Strict nonce-based CSP and hardening headers on every page; API responses use `default-src 'none'`.
- Logs are structured (pino) with request IDs; secrets are redacted.
- Production: put the app behind a reverse proxy that terminates TLS, appends `X-Forwarded-For`
  and limits request bodies to ~26 MB; set `TRUSTED_PROXY_HOPS` accordingly.
