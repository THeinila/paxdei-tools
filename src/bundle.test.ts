/** Properties of the production bundle (ADR 0004): the landing page never loads
 * the item catalogue, and a code-only change keeps the catalogue's file name so
 * returning users keep their cached copy. Builds the app twice into temporary
 * folders, the second time with a small code change, and reads Vite's manifest.
 * About 5 s, the slowest test in the suite. */
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { build, type Plugin } from "vite";

interface Chunk {
  file: string;
  imports?: string[];
  dynamicImports?: string[];
  isEntry?: boolean;
}
type Manifest = Record<string, Chunk>;

const outDirs: string[] = [];

async function buildInto(plugins: Plugin[] = []): Promise<{ dir: string; manifest: Manifest }> {
  const dir = mkdtempSync(join(tmpdir(), "pax-bundle-"));
  outDirs.push(dir);
  await build({
    logLevel: "silent",
    plugins,
    build: { outDir: dir, emptyOutDir: true, manifest: true },
  });
  return { dir, manifest: JSON.parse(readFileSync(join(dir, ".vite", "manifest.json"), "utf8")) as Manifest };
}

/** Every chunk the entry loads before anything is dynamically imported. */
function staticClosure(manifest: Manifest, key: string, seen = new Set<string>()): Set<string> {
  if (seen.has(key)) return seen;
  seen.add(key);
  for (const dep of manifest[key]?.imports ?? []) staticClosure(manifest, dep, seen);
  return seen;
}

/** Changes the landing page's code only, as a code-only deploy would. */
const codeChange: Plugin = {
  name: "code-only-change",
  transform(code, id) {
    if (id.replace(/\\/g, "/").endsWith("src/shell/Home.tsx"))
      return code.replace("A growing suite of fan-made tools", "A growing suite of fan-made tools!");
    return undefined;
  },
};

let base: Awaited<ReturnType<typeof buildInto>>;
let changed: Awaited<ReturnType<typeof buildInto>>;

beforeAll(async () => {
  [base, changed] = await Promise.all([buildInto(), buildInto([codeChange])]);
}, 120_000);

afterAll(() => {
  for (const dir of outDirs) rmSync(dir, { recursive: true, force: true });
});

describe("production bundle", () => {
  it("SRCH-N1: the landing page's code never includes or statically loads the catalogue", () => {
    const { manifest, dir } = base;
    const dataset = manifest["data/dataset.json"];
    expect(dataset).toBeDefined(); // the catalogue is its own chunk
    const entryKey = Object.keys(manifest).find((k) => manifest[k]!.isEntry)!;
    expect(entryKey).toBe("index.html");
    expect(staticClosure(manifest, entryKey).has("data/dataset.json")).toBe(false);
    expect(manifest[entryKey]!.dynamicImports).toContain("data/dataset.json"); // loaded on demand only
    const html = readFileSync(join(dir, "index.html"), "utf8");
    expect(html).not.toContain(dataset!.file);
    const entryCode = readFileSync(join(dir, manifest[entryKey]!.file), "utf8");
    expect(entryCode).not.toContain('"recipes":'); // no inlined catalogue
  });

  it("SRV-N2: a code-only change keeps the dataset chunk's file name", () => {
    const entry = (m: Manifest) => m["index.html"]!.file;
    expect(entry(changed.manifest)).not.toBe(entry(base.manifest)); // the change did reach the code
    expect(changed.manifest["data/dataset.json"], "the dataset must stay a chunk of its own").toBeDefined();
    expect(changed.manifest["data/dataset.json"]!.file).toBe(base.manifest["data/dataset.json"]!.file);
  });
});
