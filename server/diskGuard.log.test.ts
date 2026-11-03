/** Disk-guard logging, with statfs faked (a boundary we don't own) so free space
 * can cross the floor and come back. Kept apart from diskGuard.test.ts, which
 * measures the real volume. */
import { describe, expect, it, vi } from "vitest";

const free = { bytes: 0 };
vi.mock("node:fs/promises", async (importOriginal) => {
  const real = await importOriginal<typeof import("node:fs/promises")>();
  return { ...real, statfs: vi.fn(async () => ({ bavail: free.bytes, bsize: 1 })) };
});

const { createDiskGuard } = await import("./diskGuard.ts");

describe("disk guard logging", () => {
  it("ABU-10: logs once when free space falls below the floor and once when it recovers", async () => {
    const log = vi.fn();
    const guard = createDiskGuard({ path: "/data/db.sqlite", minFreeBytes: 100, log });
    free.bytes = 50;
    await guard.refresh();
    await guard.refresh(); // still low: nothing new
    expect(log).toHaveBeenCalledTimes(1);
    expect(log.mock.calls[0]![0]).toMatch(/refusing new lists/);

    free.bytes = 500;
    await guard.refresh();
    await guard.refresh();
    expect(log).toHaveBeenCalledTimes(2);
    expect(log.mock.calls[1]![0]).toMatch(/space recovered/);
  });

  it("ABU-8: a failed measurement is logged and treated as not low", async () => {
    const { statfs } = await import("node:fs/promises");
    vi.mocked(statfs).mockRejectedValue(new Error("EACCES"));
    const log = vi.fn();
    const guard = createDiskGuard({ path: "/data/db.sqlite", minFreeBytes: 100, log });
    const s = await guard.refresh();
    expect(s.low).toBe(false);
    expect(log).toHaveBeenCalledWith(expect.stringContaining("check failed: EACCES"));
  });
});
