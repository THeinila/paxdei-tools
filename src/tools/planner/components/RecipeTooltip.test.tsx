// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { loadDataset } from "../lib/data.ts";
import { ItemLabel } from "./RecipeTooltip.tsx";

// The engine fixture, with the fields the card shows filled in.
vi.mock("../../../../data/dataset.json", async () =>
  (await import("../engine/testFixtures.ts")).datasetModule((ds) => {
    ds.items.plank = { ...ds.items.plank!, tier: 2, rarity: "rare" };
    ds.items.nail = { ...ds.items.nail!, rarity: "uncommon" };
    ds.items.wood = { ...ds.items.wood!, iconPath: "/icons/raw wood.webp" };
    ds.recipes.charcoal!.variants[1]!.profession = null;
  }),
);

beforeAll(async () => {
  await loadDataset();
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const card = () => document.querySelector(".recipe-tooltip") as HTMLElement | null;
const label = (itemId: string) => {
  render(<ItemLabel itemId={itemId} />);
  return document.querySelector(".item-label") as HTMLElement;
};

describe("ItemLabel and its recipe card", () => {
  it("TIP-1: hovering with a mouse or focusing opens the card; leaving or blurring closes it", () => {
    const el = label("plank");
    fireEvent.pointerEnter(el, { pointerType: "mouse" });
    expect(card()).not.toBeNull();
    expect(card()!.querySelector(".rt-name")!.textContent).toBe("plank");
    expect(card()!.querySelector(".rt-tier")!.textContent).toBe("T2");
    fireEvent.pointerLeave(el, { pointerType: "mouse" });
    expect(card()).toBeNull();

    fireEvent.focus(el);
    expect(card()).not.toBeNull();
    fireEvent.blur(el);
    expect(card()).toBeNull();
  });

  it("TIP-2: lists every variant with its profession, yield and ingredients", () => {
    fireEvent.focus(label("charcoal"));
    const metas = [...card()!.querySelectorAll(".rt-meta")].map((m) => m.textContent);
    expect(metas).toEqual(["Test · makes ×50", "Crafting · makes ×100"]);
    expect(card()!.querySelectorAll(".rt-or")).toHaveLength(1);
    const ings = [...card()!.querySelectorAll(".rt-ing")].map((i) => i.textContent);
    expect(ings).toEqual(["sapwood×50", "heartwood×100"]);
  });

  it("TIP-3: a raw material's card says it's gathered", () => {
    fireEvent.focus(label("wood"));
    expect(card()!.textContent).toContain("Raw material — gathered");
    expect(card()!.textContent).toContain("see “where?” for sources");
    expect(card()!.querySelector(".rt-variant")).toBeNull();
  });

  // covers: TIP-4 (the trace can't read an it.each title)
  it.each(["touch", "pen"])("TIP-4: with a %s pointer, a tap toggles the card and a tap elsewhere closes it", (pointerType) => {
    render(<p>elsewhere</p>);
    const el = label("plank");
    const tap = () => {
      fireEvent.pointerDown(el, { pointerType });
      fireEvent.click(el);
    };
    tap();
    expect(card()).not.toBeNull();
    tap();
    expect(card()).toBeNull();

    tap();
    fireEvent.pointerDown(screen.getByText("elsewhere"), { pointerType });
    expect(card()).toBeNull();
  });

  it("TIP-5: flips above the label near the bottom and stays 8 px inside the viewport", () => {
    vi.spyOn(window, "innerWidth", "get").mockReturnValue(1024);
    vi.spyOn(window, "innerHeight", "get").mockReturnValue(768);
    const rect = (r: Partial<DOMRect>) => ({ x: 0, y: 0, width: 0, height: 0, top: 0, left: 0, right: 0, bottom: 0, toJSON() {}, ...r });
    let anchor = rect({ left: 950, top: 700, bottom: 720 });
    vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(function (this: Element) {
      return (this.classList.contains("recipe-tooltip") ? rect({ width: 200, height: 150 }) : anchor) as DOMRect;
    });

    // Near the bottom-right corner: flipped above, pulled left to fit.
    const el = label("plank");
    fireEvent.focus(el);
    expect(card()!.style.top).toBe(`${700 - 150 - 6}px`);
    expect(card()!.style.left).toBe(`${1024 - 200 - 8}px`);
    expect(card()!.style.visibility).toBe("visible");
    fireEvent.blur(el);

    // Room below: placed under the label, 6 px down.
    anchor = rect({ left: 100, top: 100, bottom: 120 });
    fireEvent.focus(el);
    expect(card()!.style.top).toBe("126px");
    expect(card()!.style.left).toBe("100px");
    fireEvent.blur(el);

    // Too tall for either side: clamped to the top margin.
    vi.spyOn(window, "innerHeight", "get").mockReturnValue(100);
    anchor = rect({ left: 2, top: 20, bottom: 40 });
    fireEvent.focus(el);
    expect(card()!.style.top).toBe("8px");
    expect(card()!.style.left).toBe("8px");
  });

  it("TIP-6: tags uncommon and rare items only", () => {
    render(
      <>
        <ItemLabel itemId="plank" />
        <ItemLabel itemId="nail" />
        <ItemLabel itemId="wood" />
      </>,
    );
    const tags = [...document.querySelectorAll(".rarity-tag")].map((t) => t.textContent);
    expect(tags).toEqual(["Rare", "Uncommon"]);
  });

  it("TIP-7: icons load from our own origin, hide when broken, and fall back to a placeholder", () => {
    render(
      <>
        <ItemLabel itemId="wood" />
        <ItemLabel itemId="plank" />
      </>,
    );
    const img = document.querySelector("img.icon") as HTMLImageElement;
    expect(img.getAttribute("src")).toBe("/icons/_icons_raw_wood.webp");
    fireEvent.error(img);
    expect(img.style.visibility).toBe("hidden");
    expect(document.querySelectorAll(".icon-placeholder")).toHaveLength(1); // plank has no icon path
  });

  it("TIP-N1: every item label is reachable with Tab", () => {
    expect(label("plank").tabIndex).toBe(0);
  });
});
