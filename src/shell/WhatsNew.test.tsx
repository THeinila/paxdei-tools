// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import WhatsNew from "./WhatsNew.tsx";

// Release notes are data; these stand-ins cover every case the page handles.
vi.mock("./releases.ts", () => ({
  releases: [
    {
      version: "2.0.0",
      date: "2026-12-24",
      title: "Big one",
      sections: [
        { tool: "Crafting Planner", changes: [{ kind: "new", text: "A new thing." }, { kind: "fixed", text: "A fix." }] },
        { changes: [{ kind: "improved", text: "Suite-wide polish." }] },
      ],
    },
    { version: "1.9.0", date: "not a date", sections: [{ changes: [{ kind: "improved", text: "Older." }] }] },
  ],
}));

afterEach(cleanup);

describe("What's New", () => {
  it("SHL-4: lists releases in order, with version, title and a readable date", () => {
    render(<WhatsNew />);
    const heads = [...document.querySelectorAll(".release-head")].map((h) => ({
      version: h.querySelector(".release-version")!.textContent,
      date: h.querySelector(".release-date")!.textContent,
    }));
    expect(heads).toEqual([
      {
        version: "v2.0.0 · Big one",
        date: new Date("2026-12-24").toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" }),
      },
      { version: "v1.9.0", date: "not a date" }, // an invalid date is shown as written
    ]);
  });

  it("SHL-5: groups changes by tool and labels each New, Improved or Fixed", () => {
    render(<WhatsNew />);
    const first = document.querySelector(".release")!;
    expect([...first.querySelectorAll(".release-tool")].map((t) => t.textContent)).toEqual(["Crafting Planner"]);
    const changes = [...first.querySelectorAll(".change")].map((c) => [
      c.querySelector(".change-kind")!.textContent,
      c.querySelector(".change-text")!.textContent,
    ]);
    expect(changes).toEqual([
      ["New", "A new thing."],
      ["Fixed", "A fix."],
      ["Improved", "Suite-wide polish."],
    ]);
    expect(screen.getAllByText("Improved")).toHaveLength(2);
  });
});
