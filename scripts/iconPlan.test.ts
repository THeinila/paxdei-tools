/** The icon step's rules (scripts/iconPlan.ts) on temp folders. No network: the
 * curl download itself stays in fetch-icons.ts and isn't run here. */
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { item } from "../src/tools/planner/engine/testFixtures.ts";
import type { Dataset } from "../src/tools/planner/engine/types.ts";
import { iconUrl } from "../src/tools/planner/lib/data.ts";
import { localIconName } from "../src/tools/planner/lib/iconName.ts";
import {
  ICON_BASE,
  iconSourceUrl,
  isWebp,
  planIconJobs,
  prepareIconDir,
  validateDownloads,
  writeCurlConfig,
} from "./iconPlan.ts";

const WEBP = Buffer.concat([Buffer.from("RIFF"), Buffer.from([0x10, 0, 0, 0]), Buffer.from("WEBPVP8 ")]);

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "pax-icons-test-"));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

function dataset(icons: Record<string, string | null>): Dataset {
  const items = Object.fromEntries(Object.entries(icons).map(([id, iconPath]) => [id, { ...item(id, true), iconPath }]));
  return { items, recipes: {}, meta: { generatedAt: "", source: "", recipeCount: 0, itemCount: 0 } };
}

describe("icon rules", () => {
  it("DAT-10: local icon names drop the scheme and replace other characters with _", () => {
    expect(localIconName("/paxdei/icons/Wood Log.webp")).toBe("_paxdei_icons_Wood_Log.webp");
    expect(localIconName("https://gtcdn.info/paxdei/icons/a-b.c.webp")).toBe("gtcdn.info_paxdei_icons_a-b.c.webp");
    expect(localIconName("http://x/ä?q=1")).toBe("x___q_1");
  });

  it("DAT-10: the planned file is the one the app asks for", () => {
    const ds = dataset({ wood: "/paxdei/icons/Wood Log.webp", gt: "https://gtcdn.info/paxdei/icons/x.webp" });
    for (const [name, job] of planIconJobs(ds, dir)) {
      const item = Object.values(ds.items).find((i) => localIconName(i.iconPath!) === name)!;
      expect(`/icons/${basename(job.dest)}`).toBe(iconUrl(item)); // the URL the app requests
      expect(dirname(job.dest)).toBe(dir);
    }
  });

  it("DAT-11: site paths go to the live host, and the dead host is rebased onto it", () => {
    expect(iconSourceUrl("/icons/wood.webp")).toBe(`${ICON_BASE}/icons/wood.webp`);
    expect(iconSourceUrl("https://gtcdn.info/paxdei/icons/wood.webp")).toBe(`${ICON_BASE}/icons/wood.webp`);
    expect(iconSourceUrl("http://gtcdn.info/other/wood.webp")).toBe(`${ICON_BASE}/other/wood.webp`);
    expect(iconSourceUrl("https://elsewhere.example/wood.webp")).toBe("https://elsewhere.example/wood.webp");
  });

  it("DAT-11: a rebased icon keeps the filename of its original path", () => {
    const original = "https://gtcdn.info/paxdei/icons/wood.webp";
    const [job] = [...planIconJobs(dataset({ wood: original }), dir).values()];
    expect(job!.url).toBe(`${ICON_BASE}/icons/wood.webp`);
    expect(basename(job!.dest)).toBe(localIconName(original));
  });

  it("DAT-12: only a file starting RIFF with WEBP at byte 8 counts as an icon", async () => {
    const file = (name: string, data: Buffer | string) => {
      writeFileSync(join(dir, name), data);
      return join(dir, name);
    };
    expect(await isWebp(file("ok.webp", WEBP))).toBe(true);
    expect(await isWebp(file("error.webp", "Error"))).toBe(false); // a 404 body, under 12 bytes
    expect(await isWebp(file("html.webp", "<!doctype html><p>404</p>"))).toBe(false);
    expect(await isWebp(file("riff.webp", Buffer.concat([Buffer.from("RIFF"), Buffer.alloc(4), Buffer.from("WAVE")])))).toBe(false);
    expect(await isWebp(join(dir, "missing.webp"))).toBe(false);
  });

  it("DAT-12: invalid icons are deleted before and after a download, so they're fetched again", async () => {
    const ds = dataset({ good: "/i/good.webp", bad: "/i/bad.webp" });
    const jobs = planIconJobs(ds, dir);
    writeFileSync(jobs.get(localIconName("/i/good.webp"))!.dest, WEBP);
    writeFileSync(jobs.get(localIconName("/i/bad.webp"))!.dest, "Error");
    const { todo, repaired } = await prepareIconDir(jobs, dir);
    expect(repaired).toBe(1);
    expect(todo.map((j) => j.url)).toEqual([`${ICON_BASE}/i/bad.webp`]);
    expect(existsSync(todo[0]!.dest)).toBe(false);

    writeFileSync(todo[0]!.dest, "<html>still broken</html>"); // what a failed download might leave
    expect(await validateDownloads(todo)).toEqual([`${ICON_BASE}/i/bad.webp`]);
    expect(existsSync(todo[0]!.dest)).toBe(false);
  });

  it("DAT-13: fetches each missing icon once, skipping valid ones and items without icons", async () => {
    const ds = dataset({
      a: "/i/shared.webp",
      b: "/i/shared.webp", // same file as a
      c: "/i/present.webp",
      d: null,
      e: "/i/new.webp",
    });
    const jobs = planIconJobs(ds, dir);
    expect(jobs.size).toBe(3);
    writeFileSync(jobs.get(localIconName("/i/present.webp"))!.dest, WEBP);
    const { todo } = await prepareIconDir(jobs, dir);
    expect(todo.map((j) => j.url)).toEqual([`${ICON_BASE}/i/shared.webp`, `${ICON_BASE}/i/new.webp`]);
  });

  it("DAT-13: a failed icon is reported without stopping the others", async () => {
    const jobs = [...planIconJobs(dataset({ a: "/i/a.webp", b: "/i/b.webp" }), dir).values()];
    writeFileSync(jobs[1]!.dest, WEBP); // b arrived; a didn't
    expect(await validateDownloads(jobs)).toEqual([`${ICON_BASE}/i/a.webp`]);
    expect(existsSync(jobs[1]!.dest)).toBe(true);
  });

  it("DAT-14: the curl config lives outside the icon folder, and a leftover one is removed", async () => {
    writeFileSync(join(dir, "_curl.cfg"), "url = old");
    const jobs = planIconJobs(dataset({ a: "/i/a.webp" }), dir);
    const { todo } = await prepareIconDir(jobs, dir);
    expect(existsSync(join(dir, "_curl.cfg"))).toBe(false);

    const cfg = await writeCurlConfig(todo);
    try {
      expect(cfg.startsWith(dir)).toBe(false);
      expect(dirname(cfg).startsWith(tmpdir())).toBe(true);
      expect(readFileSync(cfg, "utf8")).toBe(
        `url = "${ICON_BASE}/i/a.webp"\noutput = "${todo[0]!.dest.replace(/\\/g, "/")}"`,
      );
    } finally {
      rmSync(dirname(cfg), { recursive: true, force: true });
    }
  });
});
