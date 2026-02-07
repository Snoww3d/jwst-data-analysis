import type {
  CurveControlPoint,
  CurvePreset,
  CurvePresetName,
  LookupTable,
} from '../types/CurvesTypes';

/** Spline segment coefficients: S(x) = a + b*(x-xi) + c*(x-xi)^2 + d*(x-xi)^3 */
interface SplineCoefficients {
  a: number;
  b: number;
  c: number;
  d: number;
}

/**
 * Compute natural cubic spline coefficients using the Thomas algorithm.
 * Natural boundary: second derivative = 0 at both endpoints.
 */
function computeSplineCoefficients(xs: number[], ys: number[]): SplineCoefficients[] {
  const n = xs.length - 1;
  if (n < 1) return [];

  // For two points, return a simple linear segment
  if (n === 1) {
    const slope = (ys[1] - ys[0]) / (xs[1] - xs[0]);
    return [{ a: ys[0], b: slope, c: 0, d: 0 }];
  }

  // Compute interval widths
  const h = new Array<number>(n);
  for (let i = 0; i < n; i++) {
    h[i] = xs[i + 1] - xs[i];
  }

  // Build tridiagonal system for second derivatives (sigma)
  const alpha = new Array<number>(n - 1);
  for (let i = 0; i < n - 1; i++) {
    alpha[i] = (3 / h[i + 1]) * (ys[i + 2] - ys[i + 1]) - (3 / h[i]) * (ys[i + 1] - ys[i]);
  }

  // Solve tridiagonal system via Thomas algorithm
  const l = new Array<number>(n - 1);
  const mu = new Array<number>(n - 1);
  const z = new Array<number>(n - 1);

  l[0] = 2 * (h[0] + h[1]);
  mu[0] = h[1] / l[0];
  z[0] = alpha[0] / l[0];

  for (let i = 1; i < n - 1; i++) {
    l[i] = 2 * (h[i] + h[i + 1]) - h[i] * mu[i - 1];
    mu[i] = i < n - 2 ? h[i + 1] / l[i] : 0;
    z[i] = (alpha[i] - h[i] * z[i - 1]) / l[i];
  }

  // Back-substitution for second derivatives
  const sigma = new Array<number>(n + 1).fill(0); // Natural BCs: sigma[0] = sigma[n] = 0
  for (let i = n - 2; i >= 0; i--) {
    sigma[i + 1] = z[i] - mu[i] * sigma[i + 2];
  }

  // Compute polynomial coefficients for each segment
  const coeffs: SplineCoefficients[] = new Array(n);
  for (let i = 0; i < n; i++) {
    coeffs[i] = {
      a: ys[i],
      b: (ys[i + 1] - ys[i]) / h[i] - (h[i] * (sigma[i + 1] + 2 * sigma[i])) / 3,
      c: sigma[i],
      d: (sigma[i + 1] - sigma[i]) / (3 * h[i]),
    };
  }

  return coeffs;
}

/**
 * Evaluate the cubic spline at a given x value.
 * Clamps result to [0, 1].
 */
function evaluateSpline(x: number, xs: number[], coeffs: SplineCoefficients[]): number {
  const n = coeffs.length;
  if (n === 0) return x; // Identity fallback

  // Find the correct segment (binary search would be overkill for <10 points)
  let seg = n - 1;
  for (let i = 0; i < n; i++) {
    if (x < xs[i + 1]) {
      seg = i;
      break;
    }
  }

  const dx = x - xs[seg];
  const { a, b, c, d } = coeffs[seg];
  const y = a + b * dx + c * dx * dx + d * dx * dx * dx;

  return Math.max(0, Math.min(1, y));
}

/**
 * Generate a 256-entry lookup table from control points using cubic spline interpolation.
 */
export function generateLUT(controlPoints: CurveControlPoint[]): LookupTable {
  const sorted = [...controlPoints].sort((a, b) => a.input - b.input);
  const xs = sorted.map((p) => p.input);
  const ys = sorted.map((p) => p.output);

  const coeffs = computeSplineCoefficients(xs, ys);
  const lut = new Uint8Array(256);

  for (let i = 0; i < 256; i++) {
    const x = i / 255;
    const y = evaluateSpline(x, xs, coeffs);
    lut[i] = Math.round(y * 255);
  }

  return lut;
}

/**
 * Check if control points represent the identity (linear) curve.
 * Returns true when the LUT would be a no-op.
 */
export function isIdentityCurve(controlPoints: CurveControlPoint[]): boolean {
  if (controlPoints.length !== 2) return false;
  const sorted = [...controlPoints].sort((a, b) => a.input - b.input);
  const EPSILON = 0.001;
  return (
    Math.abs(sorted[0].input) < EPSILON &&
    Math.abs(sorted[0].output) < EPSILON &&
    Math.abs(sorted[1].input - 1) < EPSILON &&
    Math.abs(sorted[1].output - 1) < EPSILON
  );
}

/**
 * Apply a LUT to ImageData in-place. Remaps R, G, B channels; alpha is untouched.
 */
export function applyLUT(imageData: ImageData, lut: LookupTable): void {
  const data = imageData.data;
  const len = data.length;
  for (let i = 0; i < len; i += 4) {
    data[i] = lut[data[i]]; // R
    data[i + 1] = lut[data[i + 1]]; // G
    data[i + 2] = lut[data[i + 2]]; // B
    // alpha unchanged
  }
}

/** Get the default (identity) control points. */
export function getDefaultControlPoints(): CurveControlPoint[] {
  return [
    { input: 0, output: 0 },
    { input: 1, output: 1 },
  ];
}

/** All available curve presets. */
export const CURVE_PRESETS: Record<CurvePresetName, CurvePreset> = {
  linear: {
    name: 'linear',
    label: 'Linear',
    description: 'No adjustment (reset)',
    points: [
      { input: 0, output: 0 },
      { input: 1, output: 1 },
    ],
  },
  auto_contrast: {
    name: 'auto_contrast',
    label: 'Auto Contrast',
    description: 'Gentle S-curve for improved contrast',
    points: [
      { input: 0, output: 0 },
      { input: 0.25, output: 0.15 },
      { input: 0.5, output: 0.5 },
      { input: 0.75, output: 0.85 },
      { input: 1, output: 1 },
    ],
  },
  high_contrast: {
    name: 'high_contrast',
    label: 'High Contrast',
    description: 'Aggressive S-curve for maximum contrast',
    points: [
      { input: 0, output: 0 },
      { input: 0.25, output: 0.05 },
      { input: 0.5, output: 0.5 },
      { input: 0.75, output: 0.95 },
      { input: 1, output: 1 },
    ],
  },
  invert: {
    name: 'invert',
    label: 'Invert',
    description: 'Negative image',
    points: [
      { input: 0, output: 1 },
      { input: 1, output: 0 },
    ],
  },
};

/** Get control points for a named preset. */
export function getPresetControlPoints(name: CurvePresetName): CurveControlPoint[] {
  return CURVE_PRESETS[name].points.map((p) => ({ ...p }));
}
