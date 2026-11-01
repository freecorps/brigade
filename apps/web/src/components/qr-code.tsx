import { cn } from "cn";
import { useMemo } from "react";
import { encode } from "uqr";

/**
 * A QR code as an SVG, drawn from `uqr`'s module matrix (no HTML injected). Always dark modules on white with the
 * standard 4-module quiet zone, whatever the theme: phone cameras read that contrast best, and a light code on a dark
 * page fails on some scanners. Medium error correction, so a glare or a smudge on the screen still reads.
 */
export function QrCode({
  value,
  label,
  className,
}: {
  value: string;
  /** What the code is, for screen readers (never the code's content: it may be a credential). */
  label: string;
  className?: string;
}) {
  const { size, path } = useMemo(() => modules(value), [value]);
  return (
    <svg
      role="img"
      aria-label={label}
      viewBox={`0 0 ${size} ${size}`}
      shapeRendering="crispEdges"
      className={cn("block aspect-square rounded-md bg-white", className)}
    >
      <rect width={size} height={size} fill="#fff" />
      <path d={path} fill="#000" />
    </svg>
  );
}

/** The matrix as one path: a 1×1 square per dark module, joined along each row. */
export function modules(value: string): { size: number; path: string } {
  const { data, size } = encode(value, { ecc: "M", border: 4 });
  let path = "";
  data.forEach((row, y) => {
    let x = 0;
    while (x < row.length) {
      if (!row[x]) {
        x++;
        continue;
      }
      const start = x;
      while (x < row.length && row[x]) x++;
      path += `M${start} ${y}h${x - start}v1h${start - x}z`;
    }
  });
  return { size, path };
}
