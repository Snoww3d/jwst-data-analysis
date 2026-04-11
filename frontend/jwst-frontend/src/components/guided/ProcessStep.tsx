import { useEffect, useRef, useState } from 'react';
import type { ImportJobStatus } from '../../types/MastTypes';
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
  /** Number of channels being composited */
  channelCount?: number;
  /** Total number of FITS files across all channels */
  fileCount?: number;
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
  channelCount,
  fileCount,
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

  return (
    <div className="process-step" role="status" aria-live="polite">
      <h3 className="process-step-title">
        {isComplete ? 'Processing complete' : `Creating ${recipeName}...`}
      </h3>
      <p className="process-step-target">{targetName}</p>

      {error && (
        <div className="process-step-error">
          <p>{error}</p>
          <button className="btn-base process-step-retry" onClick={onRetry}>
            Retry Processing
          </button>
        </div>
      )}

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
