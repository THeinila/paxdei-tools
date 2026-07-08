/** A tiny inline price sparkline (pure SVG, no dependencies). */
interface Props {
  /** Values oldest → newest. Fewer than 2 points renders nothing. */
  points: number[];
  width?: number;
  height?: number;
  title?: string;
}

export function Sparkline({ points, width = 140, height = 28, title }: Props) {
  if (points.length < 2) return null;
  const min = Math.min(...points);
  const max = Math.max(...points);
  const span = max - min || 1; // flat series draws a midline
  const pad = 2;
  const coords = points
    .map((v, i) => {
      const x = pad + (i / (points.length - 1)) * (width - 2 * pad);
      const y = pad + (1 - (v - min) / span) * (height - 2 * pad);
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");
  return (
    <svg
      className="sparkline"
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      role="img"
      aria-label={title}
    >
      {title && <title>{title}</title>}
      <polyline points={coords} fill="none" stroke="currentColor" strokeWidth="1.5" />
    </svg>
  );
}
