# Traceability — FRD v0.1 → code → tests

Source: "Traxion QA Platform — Requirements & System Flow" v0.1. Status as of 2026-10-26, after
realignment step 1 (FR-1 to FR-5 and the matching NFRs). FR-6 to FR-9 are built in step 2
(Phase 3: environments, scripts, runs) and step 3 (Phase 4: reports).

Status: **Done** = built and tested · **Partial** = built, one part left (see Notes) ·
**Step 2 / Step 3** = planned in that step · **Later** = FRD priority "Later", not in the MVP.

Test files: `ai` = tests/integration/ai-generation.test.ts · `realign` =
tests/integration/realign.test.ts · `authz` = tests/security/authorization.test.ts · `authz2` =
tests/security/phase2-authorization.test.ts · `uploads` = tests/security/uploads.test.ts ·
`units` = tests/unit/security-units.test.ts · `prompts` = tests/unit/prompts.test.ts.

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
| FR-5.1 | Cases start as Draft; only Approved get scripts | Partial | lifecycle in services/test-cases.ts; script gate is step 2 | ai "approve / reject / edit lifecycle", realign "never downgrades scripted or run cases…" |
| FR-5.2 | Edit any field, approve, reject, bulk-approve; status changes logged | Done | Review screen ("Approve all shown", side panel), audit before/after | realign lifecycle test (audit before/after), authz2 "a review batch mixing own and foreign IDs…" |
| FR-6.x | Script generation | Step 2 | Phase 3 back-end exists; screens + FRD alignment in step 2 | tests/unit/script-checks.test.ts, tests/sandbox/runner.test.ts |
| FR-7.x | Environment configuration | Step 2 | services/environments.ts, services/targets.ts | tests/unit/phase3-security.test.ts |
| FR-8.x | Execution | Step 2 | sandbox/*, runner/*, launcher/*, egress/* | tests/sandbox/runner.test.ts |
| FR-9.x | Reporting and traceability | Step 3 | test scope export (traceability matrix) exists | ai "exports the test scope as Excel…" |

## Non-functional requirements

| ID | Requirement (short) | Status | Where | Proven by |
| --- | --- | --- | --- | --- |
| NFR-1 | Credentials encrypted (AES-256), masked, never in AI prompts | Done (store) / Step 2 (screens) | crypto/secrets.ts, `forbidden` scrub in ai/run.ts | tests/unit/phase3-security.test.ts |
| NFR-2 | Documents go only to the approved AI provider | Done | ai/provider.ts (one provider, `store:false`); key is server-only | — (configuration) |
| NFR-3 | Runs only against Lead-approved URLs | Step 2 | net/url-guard.ts, egress proxy | tests/unit/phase3-security.test.ts |
| NFR-4 | 30-page FRD analysed in < 3 min, with progress | Done (design) | 4 chunks in parallel, "Reading file X of N · about N min left" | ai "keeps what it found…" (progress result); timing not load-tested |
| NFR-5 | UI responsive during runs (background workers) | Done | BullMQ queues, worker process | tests/integration/jobs.test.ts |
| NFR-6 | Failed AI call never loses work; jobs retryable | Done | ai/pool.ts (per-part retries), partial results + "Retry failed parts" | ai "keeps what it found when one part fails…", "rejects malformed AI output…" |
| NFR-7 | Every requirement and case cites source document + section | Done | `sourceDocument`/`sourceSection`; case `sources` in side panel and export | realign "an edit records who changed what…" (sources) |
| NFR-8 | ≥ 5 parallel test workers; 30+ projects | Step 2 | — | — |
| NFR-9 | Non-developer can go from upload to first run | Partial | step 1 screens; run screens in step 2 | UI walkthrough (screenshots) |
| NFR-10 | Prompts as versioned templates | Done | ai/prompts/library.ts, `AiUsage.promptVersion` | prompts, ai "rejects malformed AI output…" (promptVersion recorded) |
| NFR-11 | Token usage per project; Lead sets the cap | Done | ai/budget.ts, AI settings (default cap), project settings (override) | ai "enforces the monthly token cap", realign "stores the model and default cap…" |
