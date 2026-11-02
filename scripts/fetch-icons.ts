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
import { existsSync, readFileSync, statSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { localIconName } from "../src/tools/planner/lib/iconName.ts";
import type { Dataset } from "../src/tools/planner/engine/types.ts";

const execFileAsync = promisify(execFile);
const __dirname = dirname(fileURLToPath(import.meta.url));
const ICON_DIR = resolve(__dirname, "../public/icons");
// Icons live on cdn-hosted.gaming.tools. The older gtcdn.info host now answers
// every icon path with a 404 whose body is the 6-byte string "Error", so it must
// not be used — see `rebaseOntoIconHost` for why the dataset still mentions it.
const ICON_BASE = "https://cdn-hosted.gaming.tools/paxdei";
const DEAD_ICON_HOSTS = [/^https?:\/\/gtcdn\.info\/paxdei/, /^https?:\/\/gtcdn\.info/];
const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36";

/** Point an absolute icon URL at the live host.
 *
 * A few dozen items come from the market feed with a fully-qualified gtcdn.info
 * URL baked in rather than a site-relative path. That host is dead, so fetching
 * it verbatim yields an "Error" body. Only the *fetch* URL is rewritten — the
 * local filename still derives from the dataset's `iconPath` via
 * `localIconName`, exactly as the app derives it, so already-downloaded files
 * keep matching and the icon cache stays valid. */
function rebaseOntoIconHost(url: string): string {
  for (const dead of DEAD_ICON_HOSTS) {
    if (dead.test(url)) return url.replace(dead, ICON_BASE);
  }
  return url;
}

function iconSourceUrl(iconPath: string): string {
  return iconPath.startsWith("http") ? rebaseOntoIconHost(iconPath) : ICON_BASE + iconPath;
}

/** A real WebP file starts with "RIFF" and carries "WEBP" at offset 8.
 *
 * Needed because curl is told to write one file per URL: without this an error
 * page or a truncated response is indistinguishable from an icon by existence
 * alone, which is how 126 six-byte "Error" files reached production unnoticed. */
async function isWebp(file: string): Promise<boolean> {
  try {
    if (statSync(file).size < 12) return false;
    const head = await readFile(file);
    return head.subarray(0, 4).toString("latin1") === "RIFF" &&
      head.subarray(8, 12).toString("latin1") === "WEBP";
  } catch {
    return false;
  }
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

  // Earlier versions wrote the curl config here, so it was copied into
  // dist/icons/ and served. Deployments keep a shared icon cache that is seeded
  // into every release, so the stale file has to be cleared or it is republished
  // forever.
  await rm(resolve(ICON_DIR, "_curl.cfg"), { force: true });

  // Drop anything on disk that is not a valid WebP so it is fetched again. Past
  // runs saved 404 bodies as .webp files, and deployments seed every release
  // from a shared icon cache, so a bad file otherwise persists indefinitely.
  let repaired = 0;
  for (const job of jobs.values()) {
    if (!existsSync(job.dest)) continue;
    if (await isWebp(job.dest)) continue;
    await rm(job.dest, { force: true });
    repaired++;
  }
  if (repaired) console.log(`discarded ${repaired} previously-corrupt icon file(s) for re-download.`);

  const todo = [...jobs.values()].filter((j) => !existsSync(j.dest));
  console.log(`${jobs.size} unique icons; ${todo.length} to download.`);
  if (todo.length === 0) return;

  // One curl invocation with a config file, downloading in parallel.
  // curl config treats backslashes as escapes, so use forward slashes for paths.
  const config = todo
    .map((j) => `url = "${j.url}"\noutput = "${j.dest.replace(/\\/g, "/")}"`)
    .join("\n");
  // Keep the config OUT of ICON_DIR: everything in public/icons/ is copied into
  // dist/icons/ by the build and served publicly, so a leftover config file ends
  // up downloadable — and it lists absolute build paths. Write it to the system
  // temp dir instead and remove it once curl is done.
  const cfgPath = join(await mkdtemp(join(tmpdir(), "pax-icons-")), "curl.cfg");
  await writeFile(cfgPath, config);
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

  // Validate rather than just checking existence, and delete anything invalid so
  // the app's missing-icon placeholder takes over instead of a broken image.
  const failed: string[] = [];
  for (const job of todo) {
    if (await isWebp(job.dest)) continue;
    await rm(job.dest, { force: true });
    failed.push(job.url);
  }
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
