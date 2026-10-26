import { strToU8, zipSync } from "fflate";

/**
 * FR-6.5 / design "Download scripts (.zip)": the approved scripts as a standalone Playwright
 * project that runs with `npx playwright test`. Credentials are never included: the
 * downloader fills in a local secrets.json (git-ignored).
 */
const HARNESS = `// Traxion QA harness for running these tests outside the platform.
// Scripts import { test, expect, account, vars } from "./traxion".
import { test, expect } from "@playwright/test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const file = join(__dirname, "..", "secrets.json");
const secrets: {
  accounts: Record<string, { username: string; password: string }>;
  vars: Record<string, string>;
} = existsSync(file)
  ? JSON.parse(readFileSync(file, "utf8"))
  : { accounts: {}, vars: {} };

/** A test account by its label, from secrets.json. */
export function account(label: string): { username: string; password: string } {
  const found = secrets.accounts[label];
  if (!found) throw new Error(\`Add an account named "\${label}" to secrets.json.\`);
  return found;
}

/** Non-secret settings, from secrets.json. */
export const vars: Readonly<Record<string, string>> = Object.freeze({ ...secrets.vars });

export { test, expect };
`;

const CONFIG = `import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./tests",
  timeout: 120_000,
  retries: 0,
  reporter: [["list"], ["html", { open: "never" }]],
  use: {
    baseURL: process.env.BASE_URL,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});
`;

function slug(s: string): string {
  return (
    s
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 50) || "test"
  );
}

export function standaloneProject(
  projectName: string,
  scripts: { key: string; title: string; code: string }[],
): Buffer {
  const accountLabels = new Set<string>();
  const varNames = new Set<string>();
  for (const s of scripts) {
    for (const m of s.code.matchAll(/account\(\s*["'`]([^"'`]+)["'`]\s*\)/g))
      accountLabels.add(m[1] ?? "");
    for (const m of s.code.matchAll(/vars\.([A-Z][A-Z0-9_]*)/g)) varNames.add(m[1] ?? "");
  }
  const example = {
    accounts: Object.fromEntries(
      [...accountLabels].filter(Boolean).map((l) => [l, { username: "", password: "" }]),
    ),
    vars: Object.fromEntries([...varNames].filter(Boolean).map((v) => [v, ""])),
  };
  const readme = `# ${projectName} — Playwright tests

Exported from Traxion QA (${scripts.length} approved script${scripts.length === 1 ? "" : "s"}).

1. \`npm install\`
2. \`npx playwright install chromium\`
3. Copy \`secrets.example.json\` to \`secrets.json\` and fill in the test accounts. Never commit it.
4. \`BASE_URL=https://your-test-environment npx playwright test\`
`;
  const files: Record<string, Uint8Array> = {
    "package.json": strToU8(
      `${JSON.stringify(
        {
          name: slug(projectName),
          private: true,
          scripts: { test: "playwright test" },
          devDependencies: { "@playwright/test": "1.64.1", "@types/node": "24.19.2" },
        },
        null,
        2,
      )}\n`,
    ),
    "playwright.config.ts": strToU8(CONFIG),
    "tests/traxion.ts": strToU8(HARNESS),
    "secrets.example.json": strToU8(`${JSON.stringify(example, null, 2)}\n`),
    ".gitignore": strToU8("node_modules/\nsecrets.json\ntest-results/\nplaywright-report/\n"),
    "README.md": strToU8(readme),
  };
  for (const s of scripts) {
    files[`tests/${s.key.toLowerCase()}-${slug(s.title)}.spec.ts`] = strToU8(s.code);
  }
  return Buffer.from(zipSync(files, { level: 6 }));
}
