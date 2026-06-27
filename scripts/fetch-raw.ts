/**
 * Step 1 of the data pipeline: download the raw source files from gaming.tools
 * and rehydrate the devalue-encoded master recipe file into plain JSON.
 *
 * Outputs (gitignored cache):
 *   scripts/.cache/recipes.raw.json  - array of 1698 rehydrated recipe objects
 *   scripts/.cache/items.market.json - the market items.json catalog
 *
 * Run: npm run fetch:raw
 */
import { parse as devalueParse } from "devalue";
import { execFile } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const __dirname = dirname(fileURLToPath(import.meta.url));
const CACHE = resolve(__dirname, ".cache");

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36";

const SOURCES = {
  recipes: "https://cdn-hosted.gaming.tools/paxdei/data/en/recipes.d.json",
  marketItems: "https://data-cdn.gaming.tools/paxdei/market/items.json",
};

/**
 * Fetch via the system `curl`. Node's built-in fetch (undici) is 403'd by the
 * gaming.tools CDN — it appears to fingerprint/block non-browser HTTP clients —
 * whereas curl with a browser User-Agent returns 200.
 */
async function fetchText(url: string): Promise<string> {
  const { stdout } = await execFileAsync(
    "curl",
    ["-sSL", "--fail", "-A", UA, url],
    { maxBuffer: 64 * 1024 * 1024 },
  );
  return stdout;
}

async function main() {
  await mkdir(CACHE, { recursive: true });

  console.log("Fetching master recipe file…");
  const recipesText = await fetchText(SOURCES.recipes);
  // The .d.json files are devalue-encoded (flat array; element 0 is the root value).
  const recipes = devalueParse(recipesText) as unknown[];
  console.log(`  rehydrated ${Array.isArray(recipes) ? recipes.length : "?"} recipes`);
  await writeFile(resolve(CACHE, "recipes.raw.json"), JSON.stringify(recipes, null, 0));

  console.log("Fetching market items catalog…");
  const itemsText = await fetchText(SOURCES.marketItems);
  await writeFile(resolve(CACHE, "items.market.json"), itemsText);

  console.log("Done. Cached to scripts/.cache/");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
