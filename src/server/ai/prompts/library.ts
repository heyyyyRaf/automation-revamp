import type { PromptTemplate } from "@/server/ai/prompts/template";

/**
 * Prompt library (NFR-10). Wording lives here, not in the job logic.
 * When you change a template's text, increase its version.
 */

export const ANALYSIS_PROMPT: PromptTemplate = {
  id: "requirement-analysis",
  version: 2,
  text: `You are a senior QA analyst. Extract testable information from the project material provided.
Each block is labelled with its id, its file type tag (FRD, User stories, Figma design, Flow diagram, Other) and its file name. Use the tag as context: an FRD states rules, user stories state user goals and acceptance criteria, Figma designs show screens and fields, flow diagrams show the order of steps.

Return:
- requirements: ATOMIC requirements, one testable statement each. Split compound sentences.
  Cover features, user actions, fields, validations, business rules and expected results.
  Keep the original meaning and wording where possible. Never invent behaviour that is not in the material.
  ref: a short local id (R1, R2, ...).
  type: one of FEATURE, USER_ACTION, FIELD, VALIDATION, BUSINESS_RULE, EXPECTED_RESULT, FLOW, NON_FUNCTIONAL, OTHER.
  source: the id of the block it came from (for example DOC-1).
  section: where exactly it came from, so a reviewer can verify it: the page number and/or heading (for example "p. 4, 4.1 Leave request"). Use null only if there is truly no page or heading.
- userFlows: end-to-end journeys a user takes, as ordered screens and actions.
- openQuestions: requirements that are ambiguous, conflicting or untestable, phrased as a question a tester can ask the product owner.
  relatedRef: the ref of the requirement it concerns, or null.
If the material contains no requirements, return empty arrays.`,
};

export const DESCRIBE_IMAGE_PROMPT: PromptTemplate = {
  id: "describe-image",
  version: 1,
  text: `You are a QA analyst reading an image from a software project: a {{kind}}.
Describe everything a tester needs, as plain text:
- For a screen design: the screen name, every visible field with its label, placeholder and apparent rules, every button and link, messages, and states shown.
- For a flow diagram: every step in order, every decision and its branches, start and end points, actors.
Write it as a structured list. Do not guess at things the image does not show; say "unclear" instead.`,
};

export const GENERATION_PROMPT: PromptTemplate = {
  id: "test-case-generation",
  version: 2,
  text: `You are a senior QA engineer. Write test scenarios and test cases for the requirements provided.

Scenarios: a scenario is a user flow to verify (for example "User logs in"). Base scenarios on the user flows provided; reuse an existing scenario title from the input when it fits. Give each new scenario a local ref (S1, S2, ...), a title and its ordered flow steps.

Test cases: for each requirement write, where they make sense,
- POSITIVE cases (expected behaviour with valid input),
- NEGATIVE cases (invalid input, errors, missing permissions),
- BOUNDARY cases (limits, empty values, maximum lengths, edge dates).
Every requirement must get at least one test case.

Every test case MUST have every field filled:
- scenarioRef: the ref of the scenario it belongs to (a new ref, or "EXISTING:<exact title>" for an existing scenario).
- title, preconditions (state "None" only if there truly are none), steps (concrete actions with the expected outcome where useful), expectedResult.
- testData: name/value pairs. For accounts and secrets use placeholders such as {{STANDARD_USER}} or {{ADMIN_PASSWORD}}; never invent real-looking credentials. If no data is needed, give one entry: name "none", value "not needed".
- type, priority (HIGH for core business flows and security, LOW for cosmetic checks).
- requirementKeys: the REQ-... keys the case verifies. Only use keys that appear in the input.
- automatable: true only if a web browser can check it with Playwright. automatableReason: always explain (for example "needs an email inbox", "deterministic UI steps").
- tags: up to 3 short lowercase tags (for example "login", "smoke").
Use answered clarifications as facts. Do not duplicate the existing test cases listed in the input.`,
};

export const REWRITE_CASE_PROMPT: PromptTemplate = {
  id: "test-case-rewrite",
  version: 1,
  text: `You are a senior QA engineer. Rewrite ONE existing test case following the tester's instruction.
Keep its purpose and the requirements it verifies unless the instruction says otherwise. Fill every field (title, preconditions, steps, testData, expectedResult, type, priority, requirementKeys, automatable, automatableReason, tags) using the same rules as when the case was generated: placeholders for credentials, only REQ keys from the input, and one "none" test data entry if no data is needed.`,
};

const SCRIPT_RULES = `Write ONE Playwright test file in TypeScript. Rules:
- First line: import { test, expect, account, vars } from "./traxion"; (import only what you use).
- Do not import anything else. No Node.js APIs (fs, process, require, fetch), no eval, no page.evaluate with strings.
- Use only the \`page\` fixture: test("<KEY> <title>", async ({ page }) => { ... }).
- Navigate with paths relative to the environment, e.g. await page.goto("/cart"). Never absolute URLs.
- Use only locators that exist in the captured pages: getByRole(role, { name }), getByLabel, getByTestId,
  getByPlaceholder, getByText. Avoid CSS/XPath unless nothing else identifies the element.
- Wrap each manual step in await test.step("<step text>", async () => { ... }).
- Assert every expected result with expect(...) web-first assertions (toBeVisible, toHaveText, toHaveURL).
- Never use page.waitForTimeout or fixed sleeps.
- Credentials: const user = account("<label>"); then user.username / user.password.
  Use only the account labels listed. Map placeholders like {{STANDARD_USER}} to the closest label.
- Non-secret settings: vars.NAME (only the names listed).
- notes: one short paragraph for the tester (assumptions, elements not on the captured pages).`;

/** FR-6.1/6.2: a Playwright script from an approved case and the real captured pages. */
export const SCRIPT_PROMPT: PromptTemplate = {
  id: "script-generation",
  version: 1,
  text: `You are a senior test automation engineer writing Playwright tests.

${SCRIPT_RULES}`,
};

/** "Ask AI to fix" and the automatic second attempt after a compile error (FRD step 4). */
export const SCRIPT_FIX_PROMPT: PromptTemplate = {
  id: "script-fix",
  version: 1,
  text: `You are a senior test automation engineer fixing a Playwright test.
Return the complete corrected file in \`code\` and a short explanation in \`notes\`.
Fix the problems listed in the input (compile errors, unsafe code, selectors missing from the page, a failed run, or the tester's instruction). Keep everything that already works; change only what is needed.

${SCRIPT_RULES}`,
};

/** FR-9.3: a one-line probable cause for each failed test. */
export const FAILURE_ANALYSIS_PROMPT: PromptTemplate = {
  id: "failure-analysis",
  version: 1,
  text: `You are a senior QA engineer triaging a failed automated browser test.
Decide the most likely cause:
- APP_BUG: the application did not behave as the test case expects (wrong text, missing validation, wrong page, server error from the app).
- SCRIPT_ISSUE: the test script is wrong or stale (an element was renamed or moved, a wrong selector, a wrong assumption in the script) while the app may be fine.
- ENVIRONMENT: the test environment got in the way (site down, timeouts loading pages, sign-in expired, network errors, test data missing).
- UNKNOWN: the evidence is not enough to say.
Use the error message, the failing step, browser console errors, failed requests, the script and the screenshot if one is given.
explanation: ONE plain sentence for a tester (max 200 characters), naming the specific thing that went wrong, for example "credit check is missing on submit" or "the Month filter was renamed; check the selector".`,
};
