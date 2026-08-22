/** The plan as Markdown, for pasting into Discord.
 *
 * Renders from the same view model the screen does, so the export can't drift
 * from what the user is looking at: the chosen preset and hide-completed are
 * honoured automatically. Collapsing is deliberately ignored — it's a screen
 * affordance, and exporting an empty section would only surprise. */
import { formatStacks, type PlanRow, type PlanViewModel } from "./view.ts";

/** The trailing detail on a row, mirroring what PlanView shows. */
function suffixes(row: PlanRow): string[] {
  const parts: string[] = [];
  if (row.kind === "craft") {
    if (row.satisfied) {
      parts.push("have enough");
    } else {
      let meta = `${row.crafts} craft${row.crafts !== 1 ? "s" : ""}`;
      if (row.produced !== row.qty) meta += ` → makes ${row.produced}`;
      if (row.profession) meta += ` · ${row.profession}`;
      parts.push(meta);
    }
  } else if (row.satisfied) {
    parts.push("have enough");
  }
  if (row.stacks) parts.push(formatStacks(row.stacks));
  if (row.ready && !row.satisfied) parts.push("**ready**");
  return parts;
}

function line(row: PlanRow): string {
  const box = row.satisfied ? "- [x]" : "- [ ]";
  const tail = suffixes(row);
  return `${box} ${row.name} ×${row.qty}${tail.length ? ` — ${tail.join(" — ")}` : ""}`;
}

export function planToMarkdown(
  vm: PlanViewModel,
  opts: { listName: string; url?: string },
): string {
  const { totals } = vm;
  const out: string[] = [`# ${opts.listName || "Untitled"}`, ""];

  const summary = [
    `${totals.gatherLeft} to gather`,
    `${totals.totalCrafts} craft${totals.totalCrafts !== 1 ? "s" : ""} in ${totals.tierCount} tier${
      totals.tierCount !== 1 ? "s" : ""
    }`,
  ];
  if (totals.readyNow > 0) summary.push(`${totals.readyNow} ready now`);
  out.push(`**${summary.join(" · ")}**`, "");

  for (const section of vm.sections) {
    out.push(`## ${section.heading} (${section.remaining})`, "");
    for (const row of section.rows) out.push(line(row));
    out.push("");
  }

  if (totals.hiddenCount > 0) {
    out.push(
      `_${totals.hiddenCount} completed item${totals.hiddenCount !== 1 ? "s" : ""} hidden._`,
      "",
    );
  }

  out.push(
    `Made with the Pax Dei Crafting Planner${opts.url ? ` · ${opts.url}` : ""}`,
  );
  return `${out.join("\n")}\n`;
}
