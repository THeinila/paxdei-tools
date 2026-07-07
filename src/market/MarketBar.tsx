/** The zone picker + snapshot-freshness strip shown above market-aware views.
 * Callers own the selection state (useZoneSelection) and the price fetch
 * (useZonePrices) so they can also feed the data into their own UI. */
import type { ZonePrices, ZoneSelection } from "./client.ts";
import { freshness } from "./format.ts";
import { ZonePicker } from "./ZonePicker.tsx";

interface Props {
  value: ZoneSelection | null;
  onChange: (sel: ZoneSelection | null) => void;
  prices: { data: ZonePrices | null; error: string | null };
}

export function MarketBar({ value, onChange, prices }: Props) {
  return (
    <div className="market-bar">
      <ZonePicker value={value} onChange={onChange} />
      {value && prices.data && (
        <span className={prices.data.stale ? "market-fresh stale" : "market-fresh"}>
          {freshness(prices.data.fetchedAt, prices.data.stale)}
        </span>
      )}
      {value && prices.error && <span className="market-error">prices unavailable</span>}
    </div>
  );
}
