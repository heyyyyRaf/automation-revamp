// Bundles the worker (dist/worker.mjs) and the admin seed (dist/seed.mjs). node_modules stay external (native/wasm deps).
import { build } from "esbuild";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));

await build({
  entryPoints: { worker: `${root}worker/index.ts`, seed: `${root}prisma/seed.ts` },
  outdir: `${root}dist`,
  outExtension: { ".js": ".mjs" },
  bundle: true,
  platform: "node",
  target: "node24",
  format: "esm",
  packages: "external",
  sourcemap: true,
  tsconfig: `${root}tsconfig.json`,
  banner: {
    js: "import { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);",
  },
  // `server-only` throws outside React Server Components; the worker is server code by definition.
  alias: { "server-only": `${root}scripts/empty-module.mjs` },
  logLevel: "info",
});
