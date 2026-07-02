import './InstrumentBadge.css';

interface InstrumentBadgeProps {
  instrument: string;
  /** Larger variant with a leading dot, used on the spotlight card. */
  large?: boolean;
}

const KNOWN_INSTRUMENTS = new Set(['nircam', 'miri', 'niriss', 'nirspec']);

/**
 * Color-coded instrument badge (NIRCam / MIRI / NIRISS / NIRSpec).
 * The palette is a scientific encoding shared across the app — do not restyle per-page.
 */
export function InstrumentBadge({ instrument, large = false }: InstrumentBadgeProps) {
  const key = instrument.toLowerCase();
  const variant = KNOWN_INSTRUMENTS.has(key) ? key : 'default';

  return (
    <span
      className={`instrument-badge instrument-badge-${variant}${large ? ' instrument-badge-large' : ''}`}
    >
      {large && <span className="instrument-badge-dot" aria-hidden="true" />}
      {instrument}
    </span>
  );
}
