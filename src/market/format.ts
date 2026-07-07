/** Gold formatting. Unit prices can be fractional (a 100-stack listed for 2g
 * is 0.02g/unit), so precision scales down as amounts grow. */
export function formatGold(n: number): string {
  if (!Number.isFinite(n)) return "–";
  const abs = Math.abs(n);
  let s: string;
  if (abs >= 100) s = Math.round(n).toLocaleString("en-US");
  else if (abs >= 10) s = trimZeros(n.toFixed(1));
  else s = trimZeros(n.toFixed(2));
  return `${s}g`;
}

function trimZeros(s: string): string {
  return s.replace(/\.?0+$/, "");
}

/** Freshness label for a snapshot timestamp: "updated 12 min ago". */
export function freshness(fetchedAt: string, stale: boolean): string {
  const mins = Math.max(0, Math.round((Date.now() - Date.parse(fetchedAt)) / 60_000));
  const age = mins < 60 ? `${mins} min ago` : `${Math.round(mins / 60)} h ago`;
  return stale ? `⚠ outdated — last update ${age}` : `updated ${age}`;
}
