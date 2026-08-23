import { describe, expect, it } from "vitest";
import { Hono } from "hono";
import { CONTENT_SECURITY_POLICY, securityHeaders } from "./securityHeaders.ts";

const app = new Hono();
app.use("*", securityHeaders());
app.get("/", (c) => c.html("<p>hi</p>"));
app.get("/api/thing", (c) => c.json({ ok: true }));

const get = (path: string) => app.request(`http://x${path}`);

/** Parse the CSP into directive -> sources. */
function directives(csp: string): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const part of csp.split(";")) {
    const [name, ...sources] = part.trim().split(/\s+/);
    if (name) out[name] = sources;
  }
  return out;
}

describe("securityHeaders", () => {
  it("sets the full set on HTML responses", async () => {
    const res = await get("/");
    expect(res.headers.get("content-security-policy")).toBe(CONTENT_SECURITY_POLICY);
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    expect(res.headers.get("referrer-policy")).toBe("strict-origin-when-cross-origin");
    expect(res.headers.get("x-frame-options")).toBe("DENY");
  });

  it("applies to API responses too", async () => {
    const res = await get("/api/thing");
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    expect(res.headers.get("content-security-policy")).toBeTruthy();
  });

  it("does not allow inline or eval'd SCRIPT", async () => {
    // The relaxation the app needs is for styles only. If this ever loosens,
    // the CSP has stopped being worth having.
    const d = directives(CONTENT_SECURITY_POLICY);
    expect(d["script-src"]).toEqual(["'self'"]);
    expect(d["script-src"]).not.toContain("'unsafe-inline'");
    expect(d["script-src"]).not.toContain("'unsafe-eval'");
  });

  it("allows inline STYLE, which the recipe tooltip needs to position itself", async () => {
    const d = directives(CONTENT_SECURITY_POLICY);
    expect(d["style-src"]).toContain("'unsafe-inline'");
  });

  it("keeps everything same-origin, since the app loads no third-party assets", async () => {
    const d = directives(CONTENT_SECURITY_POLICY);
    expect(d["default-src"]).toEqual(["'self'"]);
    expect(d["connect-src"]).toEqual(["'self'"]);
    // data: is needed for any inlined image the bundler emits.
    expect(d["img-src"]).toEqual(["'self'", "data:"]);
  });

  it("refuses to be framed and blocks plugins and base-tag injection", async () => {
    const d = directives(CONTENT_SECURITY_POLICY);
    expect(d["frame-ancestors"]).toEqual(["'none'"]);
    expect(d["object-src"]).toEqual(["'none'"]);
    expect(d["base-uri"]).toEqual(["'self'"]);
    expect(d["form-action"]).toEqual(["'self'"]);
  });
});
