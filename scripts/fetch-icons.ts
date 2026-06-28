/**
 * Download every item icon referenced by the dataset into public/icons/ so the
 * app is fully self-standing (zero external requests at runtime).
 *
 * Local filename is derived deterministically from the icon path; the same
 * function is used by the app (src/lib/data.ts -> localIconName) so URLs line up
 * without needing a stored mapping.
 *
 * Prereq: data/dataset.json must exist (npm run build:dataset).
 * Run: npm run fetch:icons
 */
import { execFile } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { localIconName } from "../src/tools/planner/lib/iconName.ts";
import type { Dataset } from "../src/tools/planner/engine/types.ts";

const execFileAsync = promisify(execFile);
const __dirname = dirname(fileURLToPath(import.meta.url));
const ICON_DIR = resolve(__dirname, "../public/icons");
const ICON_BASE = "https://gtcdn.info/paxdei";
const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36";

function iconSourceUrl(iconPath: string): string {
  return iconPath.startsWith("http") ? iconPath : ICON_BASE + iconPath;
}

async function main() {
  const ds = JSON.parse(
    readFileSync(resolve(__dirname, "../data/dataset.json"), "utf8"),
  ) as Dataset;

  // Unique icon paths -> {url, dest}.
  const jobs = new Map<string, { url: string; dest: string }>();
  for (const item of Object.values(ds.items)) {
    if (!item.iconPath) continue;
    const name = localIconName(item.iconPath);
    if (jobs.has(name)) continue;
    jobs.set(name, { url: iconSourceUrl(item.iconPath), dest: resolve(ICON_DIR, name) });
  }

  await mkdir(ICON_DIR, { recursive: true });
  const todo = [...jobs.values()].filter((j) => !existsSync(j.dest));
  console.log(`${jobs.size} unique icons; ${todo.length} to download.`);
  if (todo.length === 0) return;

  // One curl invocation with a config file, downloading in parallel.
  // curl config treats backslashes as escapes, so use forward slashes for paths.
  const config = todo
    .map((j) => `url = "${j.url}"\noutput = "${j.dest.replace(/\\/g, "/")}"`)
    .join("\n");
  const cfgPath = resolve(ICON_DIR, "_curl.cfg");
  await writeFile(cfgPath, config);
  await execFileAsync(
    "curl",
    ["-sS", "--parallel", "--parallel-max", "24", "-A", UA, "--retry", "2", "-K", cfgPath],
    { maxBuffer: 64 * 1024 * 1024 },
  );

  const missing = todo.filter((j) => !existsSync(j.dest));
  console.log(`Downloaded ${todo.length - missing.length}/${todo.length}.`);
  if (missing.length) console.log(`  ${missing.length} failed (icons will fall back to a placeholder).`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
