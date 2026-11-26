/** MET-N2 on its own: node:crypto's timingSafeEqual is wrapped (a boundary we
 * don't own) to see how the stats token is compared. */
import { Hono } from "hono";
import { describe, expect, it, vi } from "vitest";

const compare = vi.hoisted(() => vi.fn());
vi.mock("node:crypto", async (importOriginal) => {
  const real = await importOriginal<typeof import("node:crypto")>();
  return {
    ...real,
    timingSafeEqual: (a: NodeJS.ArrayBufferView, b: NodeJS.ArrayBufferView) => {
      compare(a.byteLength, b.byteLength);
      return real.timingSafeEqual(a, b);
    },
  };
});

const { openDb } = await import("./db.ts");
const { createStatsRouter } = await import("./metrics.ts");

describe("stats token check", () => {
  it("MET-N2: compares fixed-length digests in constant time, whatever the token's length", async () => {
    const app = new Hono().route("/api", createStatsRouter(openDb(":memory:"), { token: "the-real-token" }));
    for (const given of ["x", "the-real-tokem", "a much longer wrong token than the real one", "the-real-token"]) {
      compare.mockClear();
      const res = await app.request("/api/stats", { headers: { authorization: `Bearer ${given}` } });
      expect(res.status).toBe(given === "the-real-token" ? 200 : 401);
      expect(compare).toHaveBeenCalledTimes(1);
      expect(compare).toHaveBeenCalledWith(32, 32); // SHA-256 of both sides
    }
  });
});
