/**
 * Curated jwst step parameters (#1737).
 *
 * The editor was three free-text boxes — step / param / value — so you had to
 * know jwst step and parameter names from memory, and nothing validated until
 * the run failed, possibly hours later. The #1709 plan (PR 8) specified a
 * curated per-step editor with free-form as an *advanced* escape hatch; only
 * the free-form half shipped.
 *
 * This is the curated half: the parameters the seed recipes actually use, plus
 * the handful of Stage-3 knobs people reach for, each with a real control and
 * a one-line explanation. Anything not listed still works — it just renders in
 * the Advanced section as before.
 */

export type ParamControl = 'boolean' | 'number' | 'enum' | 'text';

export interface ParamSpec {
  step: string;
  param: string;
  label: string;
  help: string;
  control: ParamControl;
  options?: string[];
}

export const PARAM_CATALOG: ParamSpec[] = [
  {
    step: 'jump',
    param: 'maximum_cores',
    label: 'Jump detection — CPU cores',
    help: 'How much of the machine the jump step may use. More cores is faster but heavier.',
    control: 'enum',
    options: ['none', 'quarter', 'half', 'all'],
  },
  {
    step: 'jump',
    param: 'expand_large_events',
    label: 'Jump detection — expand snowballs',
    help: 'Grow the flagged region around large cosmic-ray events ("snowballs").',
    control: 'boolean',
  },
  {
    step: 'persistence',
    param: 'skip',
    label: 'Skip persistence correction',
    help: 'Persistence removes residual signal from a previous bright exposure.',
    control: 'boolean',
  },
  {
    step: 'bkg_subtract',
    param: 'sigma',
    label: 'Background subtraction — sigma',
    help: 'Clipping threshold used when estimating the background level.',
    control: 'number',
  },
  {
    step: 'skymatch',
    param: 'skymethod',
    label: 'Sky matching method',
    help: 'How per-exposure sky levels are equalised before combining.',
    control: 'enum',
    options: ['local', 'global', 'match', 'global+match'],
  },
  {
    step: 'outlier_detection',
    param: 'skip',
    label: 'Skip outlier detection',
    help: 'Outlier detection rejects cosmic rays and artefacts across overlapping frames.',
    control: 'boolean',
  },
  {
    step: 'resample',
    param: 'pixfrac',
    label: 'Resample — pixel shrink factor',
    help: 'Drizzle pixfrac. Lower values sharpen but need more overlapping frames.',
    control: 'number',
  },
  {
    step: 'tweakreg',
    param: 'abs_refcat',
    label: 'Astrometric reference catalog',
    help: 'Catalog used to align to absolute sky coordinates. GAIADR3 requires network access.',
    control: 'text',
  },
];

export function specFor(step: string, param: string): ParamSpec | undefined {
  const exact = PARAM_CATALOG.find((s) => s.step === step && s.param === param);
  if (exact) return exact;
  // Every jwst step accepts `skip`; treat it as a boolean even for steps that
  // aren't individually catalogued, rather than dropping the user into a text
  // box for a true/false value.
  if (param === 'skip') {
    return {
      step,
      param,
      label: `Skip ${step}`,
      help: `Skip the ${step} step.`,
      control: 'boolean',
    };
  }
  return undefined;
}

/** The stored row value is JSON-ish (`"half"`, `true`, `2`). Turn it into
 *  something a control can display. */
export function decodeValue(raw: string): string {
  const trimmed = raw.trim();
  if (trimmed.startsWith('"') && trimmed.endsWith('"')) return trimmed.slice(1, -1);
  return trimmed;
}

/** Inverse of decodeValue, in the form `parseValue` in CalibrateRun round-trips.
 *  Text that would otherwise be read as a number is re-quoted so it stays a
 *  string (the "010" case the free-form editor documents). */
export function encodeValue(spec: ParamSpec, value: string): string {
  if (spec.control === 'boolean') return value === 'true' ? 'true' : 'false';
  if (spec.control === 'number') return value.trim();
  const needsQuoting = value.trim() !== '' && !Number.isNaN(Number(value.trim()));
  return needsQuoting ? `"${value}"` : value;
}
