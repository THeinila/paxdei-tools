/** Bundle the sharing backend to plain JS for production.
 *
 * `npm start` used to be `tsx server/index.ts`, which put a devDependency on the
 * production start path. That is what made an on-host deploy dangerous: `npm ci`
 * removes node_modules before reinstalling, so a build that ran out of memory
 * partway left the box with no `tsx` and a service that could not start, with no
 * rollback. Compiling ahead of time means production only needs `dependencies`.
 *
 * Plain .mjs on purpose — the thing that removes tsx from the runtime should not
 * itself need tsx to run.
 */
import { build } from "esbuild";
import { rm } from "node:fs/promises";

const OUT_DIR = "dist-server";

await rm(OUT_DIR, { recursive: true, force: true });

await build({
  entryPoints: ["server/index.ts"],
  outfile: `${OUT_DIR}/index.js`,
  bundle: true,
  platform: "node",
  // package.json is "type": "module", so the output must be ESM to match.
  format: "esm",
  target: "node22",
  // Keep everything in node_modules external. better-sqlite3 is a native
  // addon and cannot be bundled; hono and @hono/node-server are runtime
  // `dependencies` anyway, so there is nothing to gain by inlining them.
  packages: "external",
  sourcemap: true,
  // Surface the same "which file" information in stack traces as tsx did.
  sourcesContent: false,
  logLevel: "info",
});

console.log(`built ${OUT_DIR}/index.js — run with: node ${OUT_DIR}/index.js`);
