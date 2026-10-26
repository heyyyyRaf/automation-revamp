# Traxion QA

AI-assisted QA platform: upload requirements → AI analysis → test cases → Playwright scripts →
sandboxed runs with a live view → reports. **Nothing runs against a target app until a tester has
approved the test case and its script.**

Status: **Phase 4 (reports)** — the whole FRD flow, steps 1–8: uploads with text extraction /
OCR and Figma frames, AI requirement analysis and questions, test case generation, review and
approval, environments with a verified sign-in, Playwright script generation / editing /
approval, sandboxed runs (up to 5 in parallel) with a live view, and run reports with
requirement coverage, the AI's likely cause per failure, "Re-run failed", defects, PDF / HTML
export, share links and an audit log viewer. See `docs/TRACEABILITY.md` for every FRD
requirement and the test that proves it.

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

## AI configuration

| Variable                         | Purpose                                                                             |
| -------------------------------- | ----------------------------------------------------------------------------------- |
| `AI_PROVIDER`                    | `openai` (default) or `fake` — an offline, deterministic generator for demos and CI |
| `OPENAI_API_KEY`, `OPENAI_MODEL` | Server-side only. The model must support image input and structured outputs         |
| `OPENAI_BASE_URL`                | Optional OpenAI-compatible gateway                                                  |
| `AI_MONTHLY_TOKEN_CAP`           | Default monthly token cap per project; Admins can override it per project           |
| `FIGMA_ACCESS_TOKEN`             | Server-side only. Lets the worker export frames from linked Figma files             |

How AI is used safely:

- Uploaded content is wrapped in per-call random markers and the model is told it is data, not
  instructions. Every response is validated with Zod before anything is saved; invalid output is
  retried once, then the job fails without saving partial results.
- Running analysis again only **adds** new findings. Tester edits and deletions are never undone.
- Generated test cases start as **Draft**. Editing an approved case sends it back to Draft.
- Token usage is recorded per call and the monthly cap is checked before every call.
- Requests are sent with `store: false`; API keys never reach the browser or the logs.

## Roles

| Role            | Can                                                                                                                                |
| --------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| Admin / QA Lead | Everything: users, all projects, members, archive, URL allowlist, AI settings, shared environments, public report links, audit log |
| QA Tester       | Upload, generate, review, script, run, log defects — only in projects they are a member of                                         |
| Viewer          | Read, comment and export — only in projects they are a member of                                                                   |

## Reports and sharing

- Each finished run has a report: pass rate, failures with screenshot, error and the AI's
  likely cause (app bug, script issue or environment), manual-only cases, and requirement
  coverage as of that run.
- **Re-run failed** starts a new run of the failed cases on the same environment and options.
- **Log defect** records a failed case as a defect (BUG-001…) with an optional tracker link.
- **Export PDF / HTML**: a self-contained page (no scripts, no external requests). The PDF is
  printed by Chromium inside a sandbox that is granted no network at all.
- **Share link**: every member can copy the members-only link. Only the Admin / QA Lead can turn
  on a public, read-only link that expires after 1, 7 or 30 days. The link is shown once; only
  its SHA-256 is stored. It can be turned off at any time, shows no internal addresses, is
  `noindex`, and unknown links are rate-limited per IP.

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
- Every change is written to the audit log with before/after values (never secrets); the
  Admin / QA Lead reads it under Settings → Audit log.
- Production: put the app behind a reverse proxy that terminates TLS, appends `X-Forwarded-For`
  and limits request bodies to ~26 MB; set `TRUSTED_PROXY_HOPS` accordingly.
