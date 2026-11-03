/**
 * Download every item icon referenced by the dataset into public/icons/ so the
 * app is fully self-standing (zero external requests at runtime).
 *
 * Local filename is derived deterministically from the icon path; the same
 * function is used by the app (src/tools/planner/lib/data.ts -> lib/iconName.ts) so URLs line up
 * without needing a stored mapping.
 *
 * Prereq: data/dataset.json must exist (npm run build:dataset).
 * Run: npm run fetch:icons
 */
import { execFile } from "node:child_process";
import { mkdir, rm } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { planIconJobs, prepareIconDir, readDataset, validateDownloads, writeCurlConfig } from "./iconPlan.ts";

const execFileAsync = promisify(execFile);
const __dirname = dirname(fileURLToPath(import.meta.url));
const ICON_DIR = resolve(__dirname, "../public/icons");
const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36";

async function main() {
  const ds = readDataset(resolve(__dirname, "../data/dataset.json"));
  const jobs = planIconJobs(ds, ICON_DIR);

  await mkdir(ICON_DIR, { recursive: true });

  const { todo, repaired } = await prepareIconDir(jobs, ICON_DIR);
  if (repaired) console.log(`discarded ${repaired} previously-corrupt icon file(s) for re-download.`);
  console.log(`${jobs.size} unique icons; ${todo.length} to download.`);
  if (todo.length === 0) return;

  // One curl invocation with a config file, downloading in parallel.
  const cfgPath = await writeCurlConfig(todo);
  try {
    await execFileAsync(
      "curl",
      // --fail: no output file for an HTTP error, so a 404 body is never saved
      // as an icon. curl exits non-zero if any URL failed, hence the catch —
      // individual failures are reported from the validation pass below.
      [
        "-sS", "--fail", "--parallel", "--parallel-max", "24",
        "-A", UA, "--retry", "2", "-K", cfgPath,
      ],
      { maxBuffer: 64 * 1024 * 1024 },
    ).catch(() => undefined);
  } finally {
    await rm(dirname(cfgPath), { recursive: true, force: true });
  }

  const failed = await validateDownloads(todo);
  console.log(`Downloaded ${todo.length - failed.length}/${todo.length}.`);
  if (failed.length) {
    console.log(`  ${failed.length} failed (icons will fall back to a placeholder):`);
    for (const url of failed.slice(0, 10)) console.log(`    ${url}`);
    if (failed.length > 10) console.log(`    … and ${failed.length - 10} more`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
