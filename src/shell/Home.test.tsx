// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it } from "vitest";
import { tools } from "../tools/registry.tsx";
import Home from "./Home.tsx";

afterEach(cleanup);

describe("Home", () => {
  it("SHL-1: links a card to every registered tool, with its version", () => {
    render(
      <MemoryRouter>
        <Home />
      </MemoryRouter>,
    );
    for (const t of tools) {
      const card = screen.getByRole("link", { name: new RegExp(t.name) });
      expect(card.getAttribute("href")).toBe(t.path);
      expect(card.textContent).toContain(`v${t.version}`);
    }
  });
});
