/** The icon step's rules (scripts/fetch-icons.ts), split out so they can be
 * tested without downloading: where an icon is fetched from, what counts as a
 * valid icon, which icons still need fetching, and the curl configuration.
 * The download itself stays in fetch-icons.ts. */
import { existsSync, readFileSync, statSync } from "node:fs";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { localIconName } from "../src/tools/planner/lib/iconName.ts";
import type { Dataset } from "../src/tools/planner/engine/types.ts";

// Icons live on cdn-hosted.gaming.tools. The older gtcdn.info host now answers
// every icon path with a 404 whose body is the 6-byte string "Error", so it must
// not be used — see `rebaseOntoIconHost` for why the dataset still mentions it.
export const ICON_BASE = "https://cdn-hosted.gaming.tools/paxdei";
const DEAD_ICON_HOSTS = [/^https?:\/\/gtcdn\.info\/paxdei/, /^https?:\/\/gtcdn\.info/];
/** Point an absolute icon URL at the live host.
 *
 * A few dozen items come from the market feed with a fully-qualified gtcdn.info
 * URL baked in rather than a site-relative path. That host is dead, so fetching
 * it verbatim yields an "Error" body. Only the *fetch* URL is rewritten — the
 * local filename still derives from the dataset's `iconPath` via
 * `localIconName`, exactly as the app derives it, so already-downloaded files
 * keep matching and the icon cache stays valid. */
export function rebaseOntoIconHost(url: string): string {
  for (const dead of DEAD_ICON_HOSTS) {
    if (dead.test(url)) return url.replace(dead, ICON_BASE);
  }
  return url;
}

export function iconSourceUrl(iconPath: string): string {
  return iconPath.startsWith("http") ? rebaseOntoIconHost(iconPath) : ICON_BASE + iconPath;
}

/** A real WebP file starts with "RIFF" and carries "WEBP" at offset 8.
 *
 * Needed because curl is told to write one file per URL: without this an error
 * page or a truncated response is indistinguishable from an icon by existence
 * alone, which is how 126 six-byte "Error" files reached production unnoticed. */
export async function isWebp(file: string): Promise<boolean> {
  try {
    if (statSync(file).size < 12) return false;
    const head = await readFile(file);
    return head.subarray(0, 4).toString("latin1") === "RIFF" &&
      head.subarray(8, 12).toString("latin1") === "WEBP";
  } catch {
    return false;
  }
}

export interface IconJob {
  url: string;
  dest: string;
}

/** One job per unique local filename, in dataset order. */
export function planIconJobs(ds: Dataset, iconDir: string): Map<string, IconJob> {
  const jobs = new Map<string, IconJob>();
  for (const item of Object.values(ds.items)) {
    if (!item.iconPath) continue;
    const name = localIconName(item.iconPath);
    if (jobs.has(name)) continue;
    jobs.set(name, { url: iconSourceUrl(item.iconPath), dest: resolve(iconDir, name) });
  }
  return jobs;
}

/** Clean the icon folder and return what still needs downloading, plus how
 * many corrupt files were removed. */
export async function prepareIconDir(
  jobs: Map<string, IconJob>,
  iconDir: string,
): Promise<{ todo: IconJob[]; repaired: number }> {
  // Earlier versions wrote the curl config here, so it was copied into
  // dist/icons/ and served. Deployments keep a shared icon cache that is seeded
  // into every release, so the stale file has to be cleared or it is republished
  // forever.
  await rm(resolve(iconDir, "_curl.cfg"), { force: true });

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
  const todo = [...jobs.values()].filter((j) => !existsSync(j.dest));
  return { todo, repaired };
}

/** Write the curl config for `todo` to a fresh temp folder and return its path.
 *
 * Keep the config OUT of the icon folder: everything in public/icons/ is copied
 * into dist/icons/ by the build and served publicly, so a leftover config file
 * ends up downloadable, and it lists absolute build paths. The caller removes
 * the folder once curl is done. */
export async function writeCurlConfig(todo: IconJob[]): Promise<string> {
  // curl config treats backslashes as escapes, so use forward slashes for paths.
  const config = todo
    .map((j) => `url = "${j.url}"\noutput = "${j.dest.replace(/\\/g, "/")}"`)
    .join("\n");
  const cfgPath = join(await mkdtemp(join(tmpdir(), "pax-icons-")), "curl.cfg");
  await writeFile(cfgPath, config);
  return cfgPath;
}

/** Validate rather than just checking existence, and delete anything invalid so
 * the app's missing-icon placeholder takes over instead of a broken image.
 * Returns the URLs that failed. */
export async function validateDownloads(todo: IconJob[]): Promise<string[]> {
  const failed: string[] = [];
  for (const job of todo) {
    if (await isWebp(job.dest)) continue;
    await rm(job.dest, { force: true });
    failed.push(job.url);
  }
  return failed;
}

/** Read the dataset the icons are planned from. */
export function readDataset(path: string): Dataset {
  return JSON.parse(readFileSync(path, "utf8")) as Dataset;
}
