import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

/** Builds dist/runner so the local sandbox runs the same bundle the runner image ships. */
export default function setup(): void {
  const root = fileURLToPath(new URL("../..", import.meta.url));
  execFileSync(process.execPath, [`${root}scripts/build-worker.mjs`], { cwd: root, stdio: "pipe" });
}
