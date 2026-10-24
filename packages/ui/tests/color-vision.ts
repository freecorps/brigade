// Test-only colour maths: colour-vision-deficiency simulation, CIELAB distance and alpha blending.

export type Vision = "normal" | "protanopia" | "deuteranopia";
export const VISIONS: Vision[] = ["normal", "protanopia", "deuteranopia"];

type Matrix = [number, number, number][];

// Machado, Oliveira and Fernandes (2009), severity 1.0, applied to linear RGB.
const MACHADO: Record<Exclude<Vision, "normal">, Matrix> = {
  protanopia: [
    [0.152286, 1.052583, -0.204868],
    [0.114503, 0.786281, 0.099216],
    [-0.003882, -0.048116, 1.051998],
  ],
  deuteranopia: [
    [0.367322, 0.860646, -0.227968],
    [0.280085, 0.672501, 0.047413],
    [-0.01182, 0.04294, 0.968881],
  ],
};

const channels = (hex: string) => {
  const n = Number.parseInt(hex.slice(1), 16);
  return [n >> 16, (n >> 8) & 255, n & 255];
};
const toLinear = (c: number) => {
  const v = c / 255;
  return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
};
const toSrgb = (v: number) => {
  const c = v <= 0.0031308 ? v * 12.92 : 1.055 * v ** (1 / 2.4) - 0.055;
  return Math.round(Math.min(1, Math.max(0, c)) * 255);
};
const hex = (rgb: number[]) => `#${rgb.map((c) => c.toString(16).padStart(2, "0")).join("")}`;

/** How `color` looks to someone with the given vision, as #rrggbb. */
export function simulate(color: string, vision: Vision): string {
  if (vision === "normal") return color;
  const lin = channels(color).map(toLinear);
  return hex(MACHADO[vision].map(([r, g, b]) => toSrgb(r * lin[0]! + g * lin[1]! + b * lin[2]!)));
}

/** `color` at `alpha` over an opaque `base`, blended in sRGB as browsers composite. */
export function over(color: string, alpha: number, base: string): string {
  const top = channels(color);
  return hex(channels(base).map((b, i) => Math.round(top[i]! * alpha + b * (1 - alpha))));
}

function lab(color: string): [number, number, number] {
  const [r, g, b] = channels(color).map(toLinear) as [number, number, number];
  const x = (0.4124 * r + 0.3576 * g + 0.1805 * b) / 0.95047;
  const y = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  const z = (0.0193 * r + 0.1192 * g + 0.9505 * b) / 1.08883;
  const f = (t: number) => (t > 216 / 24389 ? Math.cbrt(t) : ((24389 / 27) * t + 16) / 116);
  return [116 * f(y) - 16, 500 * (f(x) - f(y)), 200 * (f(y) - f(z))];
}

/** CIE76 colour difference (Euclidean distance in CIELAB, D65). */
export function deltaE(a: string, b: string): number {
  const [p, q] = [lab(a), lab(b)];
  return Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]);
}
