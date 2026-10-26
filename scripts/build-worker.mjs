// Bundles the server-side services into dist/:
//   worker.mjs, seed.mjs, launcher.mjs, egress.mjs, runner/entry.mjs, runner/reporter.mjs
// node_modules stay external (native/wasm deps, and the runner's Playwright install).
import { build } from "esbuild";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));

const common = {
  bundle: true,
  platform: "node",
  target: "node24",
  format: "esm",
  packages: "external",
  sourcemap: true,
  tsconfig: `${root}tsconfig.json`,
  outExtension: { ".js": ".mjs" },
  banner: {
    js: "import { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);",
  },
  // `server-only` throws outside React Server Components; these are server processes by definition.
  alias: { "server-only": `${root}scripts/empty-module.mjs` },
  loader: { ".tpl": "text" },
  logLevel: "info",
};

await build({
  ...common,
  entryPoints: {
    worker: `${root}worker/index.ts`,
    seed: `${root}prisma/seed.ts`,
    launcher: `${root}launcher/index.ts`,
    egress: `${root}egress/index.ts`,
  },
  outdir: `${root}dist`,
});

// The runner is shipped into the sandbox image on its own: keep it free of server code.
await build({
  ...common,
  entryPoints: { entry: `${root}runner/entry.ts`, reporter: `${root}runner/reporter.ts` },
  outdir: `${root}dist/runner`,
});
