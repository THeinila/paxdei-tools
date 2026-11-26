// @vitest-environment jsdom
/** The suite shell through the app's real router (src/routes.tsx): header,
 * footer, unknown paths, the loading state, switching lists, and the registry.
 * Each test sets the URL, then imports a fresh router, because routes.tsx builds
 * its routes from the registry when it's first imported. */
import { act, cleanup, render, screen, within } from "@testing-library/react";
import { createElement } from "react";
import { RouterProvider } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import pkg from "../../package.json" with { type: "json" };

/** Holds the dataset chunk back while a test wants the loading state. */
const gate = vi.hoisted(() => ({ wait: Promise.resolve() as Promise<void>, open: () => {} }));
vi.mock("../../data/dataset.json", async () => {
  await gate.wait;
  return (await import("../tools/planner/engine/testFixtures.ts")).datasetModule();
});

beforeEach(() => {
  vi.resetModules();
});

afterEach(() => {
  cleanup();
  current?.dispose(); // stop it listening to window history
  current = undefined;
  vi.useRealTimers();
  vi.unstubAllGlobals();
  localStorage.clear();
  gate.wait = Promise.resolve();
});

let current: { dispose(): void } | undefined;

async function openApp(path: string, before?: (registry: typeof import("../tools/registry.tsx")) => void) {
  window.history.replaceState(null, "", path);
  const registry = await import("../tools/registry.tsx");
  before?.(registry);
  const { router } = await import("../routes.tsx");
  current = router;
  render(<RouterProvider router={router} />);
  await act(async () => {});
  return router;
}

const header = () => document.querySelector(".site-header") as HTMLElement;
const footer = () => document.querySelector(".footer") as HTMLElement;

// Each test imports a fresh router graph (resetModules), and the first one cold. Under a
// full parallel run, with src/bundle.test.ts building at the same time, that took over
// vitest's 5 s default once, and the timed-out test then broke the ones after it.
describe("suite shell", { timeout: 30_000 }, () => {
  it("SHL-2: the header links home, every tool and What's New, and marks the current page", async () => {
    const { tools } = await import("../tools/registry.tsx");
    await openApp("/whats-new");
    const h = within(header());
    expect(h.getByRole("link", { name: "Pax Dei Tools" }).getAttribute("href")).toBe("/");
    for (const t of tools) expect(h.getByRole("link", { name: t.name }).getAttribute("href")).toBe(t.path);
    const whatsNew = h.getByRole("link", { name: "What's New" });
    expect(whatsNew.getAttribute("href")).toBe("/whats-new");
    expect(whatsNew.className).toContain("active");
    expect(h.getByRole("link", { name: tools[0]!.name }).className).not.toContain("active");
  });

  it("SHL-3: the footer shows the toolkit version, linking to What's New", async () => {
    await openApp("/");
    expect(footer().textContent).toBe(`Fan project · not affiliated with Mainframe Industries · v${pkg.version}`);
    expect(within(footer()).getByRole("link", { name: `v${pkg.version}` }).getAttribute("href")).toBe("/whats-new");
  });

  it("SHL-6: an unknown path redirects to the landing page, replacing the history entry", async () => {
    const router = await openApp("/no/such/page");
    expect(router.state.location.pathname).toBe("/");
    expect(router.state.historyAction).toBe("REPLACE");
    expect(screen.getByText(/A growing suite of fan-made tools/)).toBeTruthy();
  });

  it("SHL-7: a tool shows Loading… while its code and data arrive, with the header and footer in place", async () => {
    gate.wait = new Promise<void>((open) => (gate.open = open));
    await openApp("/planner");
    expect(within(document.querySelector("main")!).getByText("Loading…")).toBeTruthy();
    expect(header()).toBeTruthy();
    expect(footer()).toBeTruthy();
    gate.open();
    expect(await screen.findByRole("button", { name: "+ Create a new list" })).toBeTruthy();
    expect(screen.queryByText("Loading…")).toBeNull();
  });

  it("SHL-8: moving from one list to another shows only the second list", async () => {
    const { installFakeServer } = await import("../tools/planner/lib/testServer.ts");
    const server = installFakeServer();
    const a = server.seed("tok_list_a_00000000000", { name: "List A", targets: [{ itemId: "table", quantity: 1 }] });
    const b = server.seed("tok_list_b_00000000000", { name: "List B", targets: [{ itemId: "plank", quantity: 1 }] });
    const router = await openApp(`/planner/${a}`);
    const title = async () => ((await screen.findByDisplayValue(/List [AB]/)) as HTMLInputElement).value;
    expect(await title()).toBe("List A");
    const pressed = () => document.querySelector(".seg-btn[aria-pressed='true']")!.textContent;
    act(() => screen.getByRole("button", { name: "Flat" }).click()); // a per-list view setting on A
    expect(pressed()).toBe("Flat");

    await act(() => router.navigate(`/planner/${b}`));
    await act(async () => {});
    expect(await title()).toBe("List B");
    expect(document.querySelector(".targets")!.textContent).not.toContain("table");
    expect(pressed()).toBe("Tiered"); // B's own (default) layout, not A's
    await act(() => router.navigate(-1));
    await act(async () => {});
    expect(await title()).toBe("List A");
    expect(pressed()).toBe("Flat"); // A kept its own setting
  });

  it("SHL-N1: one registry entry gives a tool its route, header link and landing card", async () => {
    const fake = {
      id: "fake",
      name: "Fake Tool",
      path: "/fake",
      blurb: "A tool that exists only in this test.",
      version: "0.0.1",
      element: createElement("p", null, "fake tool page"),
    };
    let restore = () => {};
    const router = await openApp("/", ({ tools }) => {
      tools.push(fake);
      restore = () => tools.splice(tools.indexOf(fake), 1);
    });
    try {
      const card = within(document.querySelector("main")!).getByRole("link", { name: /Fake Tool/ });
      expect(card.getAttribute("href")).toBe("/fake");
      expect(card.textContent).toContain("v0.0.1");
      expect(within(header()).getByRole("link", { name: "Fake Tool" }).getAttribute("href")).toBe("/fake");
      await act(() => router.navigate("/fake"));
      expect(screen.getByText("fake tool page")).toBeTruthy();
    } finally {
      restore();
    }
  });
});
