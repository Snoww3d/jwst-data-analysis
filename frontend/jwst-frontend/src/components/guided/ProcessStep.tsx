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
}

interface StageIndicator {
  label: string;
  status: 'done' | 'active' | 'pending';
}

function getStages(
  requiresMosaic: boolean,
  phase: 'mosaic' | 'composite',
  isComplete: boolean,
  progressPercent: number,
  progressStage?: string
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

  // The backend sends known stage names (Loading, ColorMapping, Finalizing) when
  // available. Otherwise it sends a single "generating" stage at progress=10 and
  // then completes. When exact stages aren't available, infer: once the job has
  // started (any progress), mark "Loading files" done and show the next stage active.
  const hasExactStage =
    progressStage === 'Loading' ||
    progressStage === 'ColorMapping' ||
    progressStage === 'Finalizing';
  const jobStarted = progressPercent > 0 || !!progressStage;

  let loadingDone: boolean;
  let colorMappingDone: boolean;
  let colorMappingActive: boolean;
  let finalizingActive: boolean;

  if (hasExactStage) {
    loadingDone = progressStage !== 'Loading';
    colorMappingDone = progressStage === 'Finalizing';
    colorMappingActive = progressStage === 'ColorMapping';
    finalizingActive = progressStage === 'Finalizing';
  } else {
    // No granular stages — show "color mapping" as active once the job has started
    loadingDone = jobStarted;
    colorMappingDone = false;
    colorMappingActive = jobStarted;
    finalizingActive = false;
  }

  stages.push({
    label: 'Loading files',
    status:
      compositeDone || (compositeActive && loadingDone)
        ? 'done'
        : compositeActive
          ? 'active'
          : 'pending',
  });

  stages.push({
    label: 'Applying color mapping',
    status:
      compositeDone || (compositeActive && colorMappingDone)
        ? 'done'
        : compositeActive && colorMappingActive
          ? 'active'
          : 'pending',
  });

  stages.push({
    label: 'Final adjustments',
    status: compositeDone ? 'done' : compositeActive && finalizingActive ? 'active' : 'pending',
  });

  return stages;
}

/**
 * Step 2: Process — shows mosaic (if needed) and composite generation progress.
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
}: ProcessStepProps) {
  const stages = getStages(
    requiresMosaic,
    phase,
    isComplete,
    progress?.progress ?? 0,
    progress?.stage
  );

  return (
    <div className="process-step" role="status" aria-live="polite">
      <h3 className="process-step-title">
        {isComplete ? 'Processing complete' : `Creating ${recipeName}...`}
      </h3>
      <p className="process-step-target">{targetName}</p>

      {error && (
        <div className="process-step-error">
          <p>{error}</p>
          <button className="process-step-retry" onClick={onRetry}>
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
        <p className="process-step-hint">This usually takes 30-60 seconds</p>
      )}
    </div>
  );
}
