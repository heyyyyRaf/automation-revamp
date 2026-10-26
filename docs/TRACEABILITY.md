# Traceability — FRD v0.1 → code → tests

Source: "Traxion QA Platform — Requirements & System Flow" v0.1. Status as of 2026-10-26, after
realignment step 2 (FR-1 to FR-8 and the matching NFRs). FR-9 (reports) is step 3 (Phase 4).

Status: **Done** = built and tested · **Partial** = built, one part left (see Notes) ·
**Step 2 / Step 3** = planned in that step · **Later** = FRD priority "Later", not in the MVP.

Test files: `ai` = tests/integration/ai-generation.test.ts · `realign` =
tests/integration/realign.test.ts · `authz` = tests/security/authorization.test.ts · `authz2` =
tests/security/phase2-authorization.test.ts · `uploads` = tests/security/uploads.test.ts ·
`units` = tests/unit/security-units.test.ts · `prompts` = tests/unit/prompts.test.ts ·
`p3` = tests/integration/phase3.test.ts · `sandbox` = tests/sandbox/runner.test.ts (real Chromium) ·
`p3sec` = tests/unit/phase3-security.test.ts · `checks` = tests/unit/script-checks.test.ts.

## Functional requirements

| ID | Requirement (short) | Status | Where | Proven by |
| --- | --- | --- | --- | --- |
| FR-1.1 | Create, rename, archive a project (name, description, owner) | Done | services/projects.ts, projects page, project settings | authz "testers create projects they own…", realign "projects dashboard" |
| FR-1.2 | Each project keeps its own data | Done | authz/guards.ts (`requireProjectAccess`, 404 for non-members) | authz, authz2 (ID swapping, cross-project reads/writes) |
| FR-1.3 | Users log in; actions attributed to a user | Done | auth/*, services/audit.ts (before/after), `updatedBy` on requirements and cases | authz "writes an audit record…", realign "an edit records who changed what" |
| FR-1.4 | Roles: Tester, Lead, Viewer (Later in FRD, built now) | Done | lib/permissions.ts, owner-or-Admin guard | units "permissions matrix", authz2 "viewers can read and export…" |
| FR-2.1 | Upload PDF, DOCX, MD, TXT, CSV, PNG/JPG; reject others | Done | uploads/validate.ts (magic bytes), project-files.tsx | uploads |
| FR-2.2 | Extract text; read images with a vision model; text viewable per file | Done | extraction/*, ai/tasks/describe-image.ts, documents/[documentId] page | uploads "queues images for the vision description" |
| FR-2.3 | Tag each file by type; tag used as analysis context | Done | services/documents.ts (`defaultTag`, `updateDocumentTag`), tag select in file list | realign "file tags" (both tests) |
| FR-2.4 | New document version + diff (Later) | Later | — | — |
| FR-2.5 | Import frames from a Figma link (Later in FRD, built in Phase 2) | Done | figma/*, processors/import-figma.ts (frames now get vision descriptions) | authz2 "imports frames as re-encoded PNG documents…" |
| FR-3.1 | Atomic requirements with ID, text, type, source file + section | Done | processors/analyze-requirements.ts, prompts/library.ts | ai "extracts requirements, flows and questions…" |
| FR-3.2 | User flows with steps | Done | analysis output `userFlows`, requirements/flows-panel.tsx | ai "extracts requirements, flows and questions…" |
| FR-3.3 | Ambiguities as questions; answer or dismiss | Done | open questions + Needs review flag, Upload page "A few things to confirm" | realign "flags requirements the AI asks about…", ai "testers can add requirements and answer questions" |
| FR-3.4 | Edit, merge, delete, add requirements | Done | services/requirements.ts (`mergeRequirements`), requirements-workspace.tsx | realign "merges duplicates…", ai "testers can add requirements…" |
| FR-4.1 | Scenarios per flow, cases per scenario; every requirement covered | Done | processors/generate-test-cases.ts (scenarios + `notCovered` report) | realign "groups generated cases into scenarios…", ai "generates linked DRAFT test cases…" |
| FR-4.2 | Positive, negative, boundary; type filter | Done | generation prompt, Review screen type chips | realign "filters cases by scenario, type, tag and Manual only" |
| FR-4.3 | Every field required (ID, title, preconditions, steps, data, expected, priority, type, requirements) | Done | ai/tasks/generation.ts schema, validation.ts `testCaseCreateSchema` | ai "manual test cases must link…" (missing field → 422) |
| FR-4.4 | Automatable or Manual-only, with a reason | Done | `automatable` + required reason; "Manual-only" filter | realign "filters cases…" |
| FR-4.5 | Regenerate a single case or scenario with an instruction (Later) | Partial | single case: rewrite proposal → accept; rejected cases: rewrite with the rejection reason | realign "proposes a rewrite…", "writes replacements using the rejection reason" |
| FR-4.6 | Export cases to CSV/Excel, all fields as columns | Done | services/test-cases.ts `exportTestCases`, Review → Download | realign "downloads every field as CSV and Excel, formula-safe" |
| FR-5.1 | Cases start as Draft; only Approved get scripts | Done | lifecycle in services/test-cases.ts; services/scripts.ts refuses Draft cases; editing a case withdraws its script approval | p3 "writes scripts only for approved, automatable cases…", "an edit is a new version…" |
| FR-5.2 | Edit any field, approve, reject, bulk-approve; status changes logged | Done | Review screen ("Approve all shown", side panel), audit before/after | realign lifecycle test (audit before/after), authz2 "a review batch mixing own and foreign IDs…" |
| FR-6.1 | Playwright script per approved case; compiles; code viewer | Done | processors/generate-scripts.ts (type check; compile error → one regeneration → "needs edit"), Scripts screen | p3 "writes scripts only…", "regenerates once on a compile error…", checks |
| FR-6.2 | Real selectors from a crawl of the target (DOM snapshot) | Done | capture of up to 5 pages of the flow (runner capture mode), selector check per version | sandbox "captures every page of the flow…", p3 "writes scripts only…" (paths), checks |
| FR-6.3 | View and edit before running; the edited script runs | Done | edits are new versions; only the approved version runs (pinned per run) | p3 "an edit is a new version that must be approved again…" |
| FR-6.4 | Self-heal selector proposals (Later) | Partial | "Ask AI to fix" fixes missing selectors / a failed run as a new version to review | p3 "regenerates once…" (fix job) |
| FR-6.5 | Download as a standalone Playwright project (Later in FRD, in the design) | Done | scripts/standalone.ts, Download scripts (.zip) | p3 "downloads approved scripts as a Playwright project without credentials" |
| FR-7.1 | Environments: base URL, test accounts, variables | Done | services/environments.ts (project and shared), Environments screen | p3 "environments" tests |
| FR-7.2 | Credentials encrypted; masked in UI and logs | Done | crypto/secrets.ts (AES-256-GCM), masked usernames, scrubbed events | p3 "is Unverified until… stored encrypted", sandbox "credentials never leak", p3sec |
| FR-7.3 | Log in once, reuse the session | Done | processors/verify-environment.ts saves the encrypted storage state used by runs | p3 "is Unverified until the sign-in check passes…" |
| FR-7.4 | Test data sets per environment (Later) | Later | variables cover simple values | — |
| FR-8.1 | Select cases (all / scenario / tag) and an environment; live status | Done | services/runs.ts selection, Run dialog, Live run screen (server-sent events) | p3 "selects cases by tag or scenario…", "runs approved scripts in parallel…" |
| FR-8.2 | Runs in a queue, isolated from the web app | Done | "runs" queue, fresh sandbox per session (launcher), egress proxy | sandbox tests, p3 "a crashed worker aborts the run…" |
| FR-8.3 | Per case: status, duration, error, failure screenshot, console log, trace | Done | execute-run.ts stores trace, screenshot, runner log, browser console, network | p3 "runs approved scripts…" (artifacts), sandbox "records the browser console…" |
| FR-8.4 | Configurable timeout and retries; timeout → Error | Done | run options; timedOut → ERROR | p3 "runs approved scripts…" (ERROR, attempts), sandbox "retries a failed test…" |
| FR-8.5 | Firefox/WebKit (Later) | Later | Chromium only | — |
| FR-9.x | Reporting and traceability | Step 3 | test scope export (traceability matrix) exists | ai "exports the test scope as Excel…" |

## Non-functional requirements

| ID | Requirement (short) | Status | Where | Proven by |
| --- | --- | --- | --- | --- |
| NFR-1 | Credentials encrypted (AES-256), masked, never in AI prompts | Done | crypto/secrets.ts, write-only account API, `forbidden` scrub in ai/run.ts | p3 "writes scripts only…" (no credentials in prompt), p3sec |
| NFR-2 | Documents go only to the approved AI provider | Done | ai/provider.ts (one provider, `store:false`); key is server-only | — (configuration) |
| NFR-3 | Runs only against Lead-approved URLs | Done | addresses (project + global), net/url-guard.ts, egress proxy grants only the approved origin | p3 "only approved addresses can back an environment…", p3sec, sandbox |
| NFR-4 | 30-page FRD analysed in < 3 min, with progress | Done (design) | 4 chunks in parallel, "Reading file X of N · about N min left" | ai "keeps what it found…" (progress result); timing not load-tested |
| NFR-5 | UI responsive during runs (background workers) | Done | BullMQ queues, worker process | tests/integration/jobs.test.ts |
| NFR-6 | Failed AI call never loses work; jobs retryable | Done | ai/pool.ts (per-part retries), partial results + "Retry failed parts" | ai "keeps what it found when one part fails…", "rejects malformed AI output…" |
| NFR-7 | Every requirement and case cites source document + section | Done | `sourceDocument`/`sourceSection`; case `sources` in side panel and export | realign "an edit records who changed what…" (sources) |
| NFR-8 | ≥ 5 parallel test workers; 30+ projects | Done | up to 5 sandbox sessions per run (execute-run.ts) | p3 "runs approved scripts in parallel…" |
| NFR-9 | Non-developer can go from upload to first run | Done | Upload → Requirements → Review → Environments → Scripts → Run screens | UI walkthrough (screenshots) |
| NFR-10 | Prompts as versioned templates | Done | ai/prompts/library.ts, `AiUsage.promptVersion` | prompts, ai "rejects malformed AI output…" (promptVersion recorded) |
| NFR-11 | Token usage per project; Lead sets the cap | Done | ai/budget.ts, AI settings (default cap), project settings (override) | ai "enforces the monthly token cap", realign "stores the model and default cap…" |
