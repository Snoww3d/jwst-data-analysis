import { useEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import type { ImportJobStatus } from '../../types/MastTypes';
import { parseMemoryBudgetError } from '../../services/compositeService';
import { hueToHex, parseWavelength, wavelengthToHue } from '../../utils/wavelengthUtils';
import './ProcessStep.css';

interface ProcessStepProps {
  targetName: string;
  recipeName: string;
  /** Whether a mosaic step is required */
  requiresMosaic: boolean;
  /** Current phase: 'mosaic' | 'composite' */
  phase: 'mosaic' | 'composite';
  /** Job progress for the current phase */
  progress: ImportJobStatus | null;
  /** Error message if processing failed */
  error: string | null;
  /** Whether processing is complete */
  isComplete: boolean;
  /** Retry callback */
  onRetry: () => void;
  /**
   * Optional callback to opt in to a force-downscale on a memory-budget 413.
   * When provided AND the error matches a memory-budget refusal, a "Continue
   * anyway → WxH" button is rendered alongside Retry Processing.
   */
  onContinueAnyway?: () => void;
  /** Number of channels being composited */
  channelCount?: number;
  /** Total number of FITS files across all channels */
  fileCount?: number;
  /** Recipe filter list (any order — ribbon sorts by wavelength). */
  filters?: string[];
  /** Recipe filter→hex color mapping (e.g. `{ F200W: "#0000ff" }`). */
  colorMapping?: Record<string, string>;
}

interface RibbonTile {
  filter: string;
  wavelengthUm: number;
  color: string;
  /** Horizontal position 0..1, log-spaced across the recipe's filter range. */
  position: number;
}

function buildRibbonTiles(
  filters: string[] | undefined,
  colorMapping: Record<string, string> | undefined
): RibbonTile[] {
  if (!filters || filters.length === 0) return [];

  const parsed = filters
    .map((f) => ({ filter: f, wavelengthUm: parseWavelength(f) }))
    .filter(
      (t): t is { filter: string; wavelengthUm: number } =>
        t.wavelengthUm !== null && t.wavelengthUm > 0
    )
    .sort((a, b) => a.wavelengthUm - b.wavelengthUm);

  if (parsed.length === 0) return [];

  const minLog = Math.log(parsed[0].wavelengthUm);
  const maxLog = Math.log(parsed[parsed.length - 1].wavelengthUm);
  const span = maxLog - minLog;

  return parsed.map(({ filter, wavelengthUm }) => {
    const upperFilter = filter.toUpperCase();
    const mapped = colorMapping?.[filter] ?? colorMapping?.[upperFilter];
    const color = mapped ?? hueToHex(wavelengthToHue(wavelengthUm));
    // Span-zero (all filters identical wavelength — degenerate recipe) → stack
    // every tile at center; the visual still reads as "single-band composite"
    // and we avoid emitting NaN.
    const position = span > 0 ? (Math.log(wavelengthUm) - minLog) / span : 0.5;
    // Display the upper-cased filter so a mixed-case input list ("F200W",
    // "f444w") doesn't produce inconsistent tile labels.
    return { filter: upperFilter, wavelengthUm, color, position };
  });
}

function formatWavelengthLabel(um: number): string {
  if (um >= 10) return `${um.toFixed(0)}μm`;
  if (um >= 1) return `${um.toFixed(1)}μm`;
  return `${um.toFixed(2)}μm`;
}

interface WavelengthRibbonProps {
  filters?: string[];
  colorMapping?: Record<string, string>;
}

function WavelengthRibbon({ filters, colorMapping }: WavelengthRibbonProps) {
  const tiles = useMemo(() => buildRibbonTiles(filters, colorMapping), [filters, colorMapping]);

  // Single-tile ribbons add no information; the issue accepts hide-or-single,
  // and hiding keeps the layout cleaner for 1-filter composites.
  if (tiles.length < 2) return null;

  const ariaLabel = `Wavelength ribbon: ${tiles
    .map((t) => `${t.filter} at ${formatWavelengthLabel(t.wavelengthUm)}`)
    .join(', ')}`;

  return (
    <div className="wavelength-ribbon" role="img" aria-label={ariaLabel}>
      <div
        className="wavelength-ribbon-track"
        style={{ '--ribbon-tile-count': tiles.length } as CSSProperties}
      >
        {tiles.map((tile) => (
          <div
            key={tile.filter}
            className="wavelength-ribbon-tile"
            style={{ left: `${tile.position * 100}%`, backgroundColor: tile.color }}
            title={`${tile.filter} · ${formatWavelengthLabel(tile.wavelengthUm)}`}
          >
            <span className="wavelength-ribbon-tile-filter">{tile.filter}</span>
            <span className="wavelength-ribbon-tile-wavelength">
              {formatWavelengthLabel(tile.wavelengthUm)}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

interface StageIndicator {
  label: string;
  status: 'done' | 'active' | 'pending';
}

/**
 * Elapsed-time thresholds (seconds) at which each composite stage transitions
 * from active → done when the backend isn't emitting granular stage events.
 *
 * Derived empirically from a 6-channel NIRCam+MIRI composite (Cartwheel Galaxy)
 * where the full pipeline took ~225s. Reprojection dominates (~60%), stretch
 * + combine is ~30%, sharpening + encode ~10%. The schedule advances roughly
 * proportionally and then holds on the last stage until real completion.
 *
 * When {@link CompositeBackgroundService} is updated to emit real stage events
 * (tracked separately), the time-based progression falls through cleanly —
 * the exact-stage branch in `getStages` takes precedence.
 */
const STAGE_SCHEDULE_SECONDS = {
  loadingDoneAt: 10,
  aligningDoneAt: 45,
  colorDoneAt: 120,
} as const;

function formatElapsed(totalSeconds: number): string {
  if (totalSeconds < 60) {
    return `${totalSeconds}s`;
  }
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}m ${seconds.toString().padStart(2, '0')}s`;
}

function getStages(
  requiresMosaic: boolean,
  phase: 'mosaic' | 'composite',
  isComplete: boolean,
  progressPercent: number,
  progressStage: string | undefined,
  elapsedSeconds: number,
  channelCount?: number,
  fileCount?: number
): StageIndicator[] {
  const stages: StageIndicator[] = [];

  if (requiresMosaic) {
    const mosaicDone = phase === 'composite' || isComplete;
    const mosaicActive = phase === 'mosaic' && !isComplete;
    stages.push({
      label: 'Aligning tiles (mosaic)',
      status: mosaicDone ? 'done' : mosaicActive ? 'active' : 'pending',
    });
  }

  const compositeDone = isComplete;
  const compositeActive = phase === 'composite' && !isComplete;

  // The backend is expected to send one of "Loading" / "ColorMapping" / "Finalizing"
  // when granular events are wired up. Today it emits a single "generating" event
  // at progress=10, so the else branch runs for most real jobs.
  const hasExactStage =
    progressStage === 'Loading' ||
    progressStage === 'ColorMapping' ||
    progressStage === 'Sharpening' ||
    progressStage === 'Finalizing';

  let loadingDone: boolean;
  let aligningDone: boolean;
  let aligningActive: boolean;
  let colorDone: boolean;
  let colorActive: boolean;
  let sharpeningActive: boolean;

  if (hasExactStage) {
    loadingDone = progressStage !== 'Loading';
    aligningDone =
      progressStage === 'ColorMapping' ||
      progressStage === 'Sharpening' ||
      progressStage === 'Finalizing';
    aligningActive = false; // backend doesn't currently distinguish this phase
    colorDone = progressStage === 'Sharpening' || progressStage === 'Finalizing';
    colorActive = progressStage === 'ColorMapping';
    sharpeningActive = progressStage === 'Sharpening' || progressStage === 'Finalizing';
  } else {
    // No granular events — advance stages on a rough time-based schedule so
    // the UI reflects actual progression instead of freezing on one stage.
    const jobStarted = progressPercent > 0 || !!progressStage || compositeActive;
    if (!jobStarted) {
      loadingDone = false;
      aligningDone = false;
      aligningActive = false;
      colorDone = false;
      colorActive = false;
      sharpeningActive = false;
    } else if (elapsedSeconds < STAGE_SCHEDULE_SECONDS.loadingDoneAt) {
      loadingDone = false;
      aligningDone = false;
      aligningActive = false;
      colorDone = false;
      colorActive = false;
      sharpeningActive = false;
    } else if (elapsedSeconds < STAGE_SCHEDULE_SECONDS.aligningDoneAt) {
      loadingDone = true;
      aligningDone = false;
      aligningActive = true;
      colorDone = false;
      colorActive = false;
      sharpeningActive = false;
    } else if (elapsedSeconds < STAGE_SCHEDULE_SECONDS.colorDoneAt) {
      loadingDone = true;
      aligningDone = true;
      aligningActive = false;
      colorDone = false;
      colorActive = true;
      sharpeningActive = false;
    } else {
      // Hold on the last stage — we don't know how long sharpening/encode takes
      // and the spinner keeps the user reassured the job is still running.
      loadingDone = true;
      aligningDone = true;
      aligningActive = false;
      colorDone = true;
      colorActive = false;
      sharpeningActive = true;
    }
  }

  const loadingLabel =
    fileCount && channelCount
      ? `Loading ${fileCount} file${fileCount === 1 ? '' : 's'} across ${channelCount} channel${channelCount === 1 ? '' : 's'}`
      : 'Loading files';

  stages.push({
    label: loadingLabel,
    status:
      compositeDone || (compositeActive && loadingDone)
        ? 'done'
        : compositeActive && !loadingDone
          ? 'active'
          : 'pending',
  });

  stages.push({
    label: 'Aligning channels to common grid',
    status:
      compositeDone || (compositeActive && aligningDone)
        ? 'done'
        : compositeActive && aligningActive
          ? 'active'
          : 'pending',
  });

  stages.push({
    label: 'Applying color & stretch',
    status:
      compositeDone || (compositeActive && colorDone)
        ? 'done'
        : compositeActive && colorActive
          ? 'active'
          : 'pending',
  });

  stages.push({
    label: 'Sharpening & final touches',
    status: compositeDone ? 'done' : compositeActive && sharpeningActive ? 'active' : 'pending',
  });

  return stages;
}

/**
 * Step 2: Process — shows mosaic (if needed) and composite generation progress.
 *
 * Elapsed-time counter advances stages on a rough schedule when the backend
 * doesn't emit granular progress events. See issues for Options B/C to replace
 * this heuristic with real backend telemetry.
 */
export function ProcessStep({
  targetName,
  recipeName,
  requiresMosaic,
  phase,
  progress,
  error,
  isComplete,
  onRetry,
  onContinueAnyway,
  channelCount,
  fileCount,
  filters,
  colorMapping,
}: ProcessStepProps) {
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const startTimeRef = useRef<number | null>(null);

  // Tick the elapsed counter while the composite job is running. Everything
  // lives in the effect (not in render) so Date.now() stays out of the pure
  // render path. The first interval tick writes elapsed=0 after 1s, so the
  // counter appears to start at 0s — the "Starting…" label covers the gap.
  useEffect(() => {
    if (error || isComplete || phase !== 'composite') {
      startTimeRef.current = null;
      return;
    }

    startTimeRef.current = Date.now();

    const interval = window.setInterval(() => {
      if (startTimeRef.current !== null) {
        setElapsedSeconds(Math.floor((Date.now() - startTimeRef.current) / 1000));
      }
    }, 1000);

    return () => window.clearInterval(interval);
  }, [phase, error, isComplete]);

  const stages = getStages(
    requiresMosaic,
    phase,
    isComplete,
    progress?.progress ?? 0,
    progress?.stage,
    elapsedSeconds,
    channelCount,
    fileCount
  );

  const showElapsed = !error && !isComplete && phase === 'composite' && elapsedSeconds > 0;

  // Memory-budget 413 detection: if the error matches the engine's refusal
  // pattern (or carries the MEMORY_BUDGET: prefix from the async path), we
  // strip the prefix for display and surface a "Continue anyway" button when
  // the parent provided onContinueAnyway. This lets the user opt in to a
  // smaller output rather than re-running with the same inputs and getting
  // the same refusal.
  const memoryBudget = error ? parseMemoryBudgetError(error) : null;
  const showContinueAnyway = !!memoryBudget?.isMemoryBudget && !!onContinueAnyway;
  const projectedShapeLabel = memoryBudget?.projectedShape
    ? ` → ${memoryBudget.projectedShape[0]}×${memoryBudget.projectedShape[1]}`
    : '';
  const errorDisplay = memoryBudget?.displayMessage ?? error;

  return (
    <div className="process-step" role="status" aria-live="polite">
      <h3 className="process-step-title">
        {isComplete ? 'Processing complete' : `Creating ${recipeName}...`}
      </h3>
      <p className="process-step-target">{targetName}</p>

      {error && (
        <div className="process-step-error">
          <p>{errorDisplay}</p>
          <div className="process-step-error-actions">
            <button className="btn-base process-step-retry" onClick={onRetry}>
              Retry Processing
            </button>
            {showContinueAnyway && (
              <button className="btn-base process-step-continue" onClick={onContinueAnyway}>
                Continue anyway{projectedShapeLabel}
              </button>
            )}
          </div>
        </div>
      )}

      {!error && <WavelengthRibbon filters={filters} colorMapping={colorMapping} />}

      {!error && (
        <div className="process-stage-list">
          {stages.map((stage) => (
            <div key={stage.label} className={`process-stage-row stage-${stage.status}`}>
              <span className="process-stage-icon">
                {stage.status === 'done' && '\u2713'}
                {stage.status === 'active' && '\u25CF'}
                {stage.status === 'pending' && '\u25CB'}
              </span>
              <span className="process-stage-label">{stage.label}</span>
            </div>
          ))}
        </div>
      )}

      {!error && !isComplete && (
        <p className="process-step-hint">
          {showElapsed ? (
            <>
              Elapsed: <strong>{formatElapsed(elapsedSeconds)}</strong>
              <span className="process-step-hint-detail">
                {' '}
                · large mixed-instrument composites can take 2–4 minutes
              </span>
            </>
          ) : (
            'Starting…'
          )}
        </p>
      )}
    </div>
  );
}
