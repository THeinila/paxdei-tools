/** Cascading world → province → zone selector for the user's home market.
 * Fed by /api/market/zones; the selection persists in localStorage via
 * useZoneSelection. Renders nothing while the tree loads and an inline error
 * if it can't be fetched. */
import { useEffect } from "react";
import type { ZoneSelection, ZoneTree } from "./client.ts";
import { useZoneTree } from "./hooks.ts";

interface Props {
  value: ZoneSelection | null;
  onChange: (sel: ZoneSelection | null) => void;
  /** Text shown before the selects, e.g. "Market:". */
  label?: string;
}

/** Pick the first domain/zone of a world (used when cascading a change down). */
function firstZoneOf(tree: ZoneTree, world: string): ZoneSelection | null {
  const domains = tree.worlds[world] ?? {};
  const domain = Object.keys(domains)[0];
  const zone = domain ? domains[domain]?.[0] : undefined;
  return domain && zone ? { world, domain, zone } : null;
}

export function ZonePicker({ value, onChange, label = "Market:" }: Props) {
  const { data: tree, error } = useZoneTree(true);

  // Drop a persisted selection that no longer exists in the index (server
  // wipe, world rename) so the selects never show phantom options.
  useEffect(() => {
    if (!tree || !value) return;
    if (!tree.worlds[value.world]?.[value.domain]?.includes(value.zone)) onChange(null);
  }, [tree, value, onChange]);

  if (error) return <span className="market-error">market zones unavailable</span>;
  if (!tree) return null;

  const worlds = Object.keys(tree.worlds).sort();
  const domains = value ? Object.keys(tree.worlds[value.world] ?? {}) : [];
  const zones = value ? (tree.worlds[value.world]?.[value.domain] ?? []) : [];

  return (
    <span className="zone-picker">
      <span className="zone-picker-label">{label}</span>
      <select
        value={value?.world ?? ""}
        onChange={(e) => onChange(e.target.value ? firstZoneOf(tree, e.target.value) : null)}
      >
        <option value="">no server</option>
        {worlds.map((w) => (
          <option key={w} value={w}>
            {w}
          </option>
        ))}
      </select>
      {value && (
        <>
          <select
            value={value.domain}
            onChange={(e) => {
              const domain = e.target.value;
              const zone = tree.worlds[value.world]?.[domain]?.[0];
              if (zone) onChange({ world: value.world, domain, zone });
            }}
          >
            {domains.map((d) => (
              <option key={d} value={d}>
                {d}
              </option>
            ))}
          </select>
          <select
            value={value.zone}
            onChange={(e) => onChange({ ...value, zone: e.target.value })}
          >
            {zones.map((z) => (
              <option key={z} value={z}>
                {z}
              </option>
            ))}
          </select>
        </>
      )}
    </span>
  );
}
