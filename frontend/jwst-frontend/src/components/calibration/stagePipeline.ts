/**
 * What the JWST imaging pipeline stages actually do (#1736).
 *
 * The UI used to show raw identifiers — `detector1`, `image2`, `image3` — as
 * bare checkboxes, with nothing explaining what they do, what they cost, or
 * that they depend on the shape of the input data. Any combination was
 * selectable and an invalid one only failed at runtime, potentially hours in.
 *
 * These are pure functions over (stages, input suffixes) so they can be tested
 * directly rather than through the DOM.
 */

export interface StageSpec {
  /** Pipeline identifier, as the engine knows it. */
  name: string;
  /** What a person would call it. */
  label: string;
  /** Data product going in / coming out — the connector labels. */
  consumes: string;
  produces: string;
  /** Rough minutes, used only for an order-of-magnitude estimate. */
  minutesPerFile: number;
  /** True when the cost is per mosaic rather than per input file. */
  perRun?: boolean;
}

export const IMAGING_PIPELINE: StageSpec[] = [
  {
    name: 'detector1',
    label: 'Detector1',
    consumes: '_uncal',
    produces: '_rate',
    minutesPerFile: 8,
  },
  { name: 'image2', label: 'Image2', consumes: '_rate', produces: '_cal', minutesPerFile: 2 },
  {
    name: 'image3',
    label: 'Image3',
    consumes: '_cal',
    produces: '_i2d',
    minutesPerFile: 10,
    perRun: true,
  },
];

export function specFor(name: string): StageSpec | undefined {
  return IMAGING_PIPELINE.find((s) => s.name === name);
}

/**
 * Why a stage cannot run against the given inputs, or null if it can.
 *
 * The rule is the pipeline's own data flow: a stage needs its `consumes`
 * product to exist. Inputs that are already calibrated (`_cal`) cannot be fed
 * to Detector1 or Image2 — those need raw frames.
 */
export function blockedReason(stage: StageSpec, inputSuffixes: string[]): string | null {
  if (inputSuffixes.length === 0) return null; // nothing selected yet — don't pre-judge
  // A stage is runnable if any input is at or before the product it consumes.
  const order = ['_uncal', '_rate', '_cal', '_i2d'];
  const need = order.indexOf(stage.consumes);
  const haveEarliest = Math.min(
    ...inputSuffixes.map((s) => {
      const i = order.indexOf(s);
      return i === -1 ? 0 : i; // unknown suffix: assume raw, don't block
    })
  );
  if (need < haveEarliest) {
    return `needs ${stage.consumes} data — your inputs are already ${order[haveEarliest]}`;
  }
  return null;
}

/** Rough total for the enabled stages. Deliberately coarse: an order of
 *  magnitude beats no signal at all, and real durations become available from
 *  run history (#1734) once there is any. */
export function estimateMinutes(enabled: StageSpec[], fileCount: number): number {
  const files = Math.max(fileCount, 1);
  return enabled.reduce((total, s) => total + s.minutesPerFile * (s.perRun ? 1 : files), 0);
}

export function formatEstimate(minutes: number): string {
  if (minutes <= 0) return '—';
  if (minutes < 60) return `~${Math.round(minutes)} min`;
  const h = Math.floor(minutes / 60);
  const m = Math.round(minutes % 60);
  return m === 0 ? `~${h}h` : `~${h}h ${m}m`;
}
