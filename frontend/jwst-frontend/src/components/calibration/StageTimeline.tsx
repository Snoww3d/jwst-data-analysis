/**
 * Stage timeline (#1736) — the pipeline as a pipeline.
 *
 * Replaces a row of checkboxes labelled with raw engine identifiers. The
 * connectors carry the data state (uncal → rate → cal → i2d), so the graph
 * explains itself, and a stage whose input product doesn't exist is disabled
 * with the reason rather than failing at runtime.
 *
 * Serves both the config form (toggleable) and the run page (read-only, with
 * live status), because they are the same information at different moments.
 */

import { IMAGING_PIPELINE, blockedReason } from './stagePipeline';
import type { CalibrationJobStage } from '../../types/CalibrationTypes';
import './StageTimeline.css';

type Mode = 'config' | 'progress';

interface StageTimelineProps {
  mode: Mode;
  /** Config mode: which stages the user has enabled. */
  enabled?: Record<string, boolean>;
  /** Progress mode: live per-stage status from the job. */
  progress?: CalibrationJobStage[];
  /** Suffixes of the selected inputs, e.g. ['_cal'] — drives validity. */
  inputSuffixes?: string[];
  /**
   * Progress mode: what the running stage is doing right now (#1770) — the
   * sub-step ("jump") and the file counter ("file 2 of 4"). A stage sits at
   * "running" for many minutes, so this line is the part that actually moves.
   *
   * `currentStageName` is the stage half of `progress.currentStage`. It has to
   * travel with the step, because the stage list and the current-stage string
   * are written by separate engine updates: without it a stale `jump` (a
   * detector1 step) could be painted onto whichever stage happens to read
   * "running", which is worse than showing nothing.
   */
  currentStageName?: string | null;
  currentStep?: string | null;
  fileCounter?: string | null;
  onToggle?: (stageName: string, next: boolean) => void;
}

function statusGlyph(status: CalibrationJobStage['status']): string {
  if (status === 'done') return '✓';
  if (status === 'running') return '…';
  if (status === 'failed') return '✕';
  if (status === 'skipped') return '–';
  return '○';
}

export function StageTimeline({
  mode,
  enabled = {},
  progress = [],
  inputSuffixes = [],
  currentStageName = null,
  currentStep = null,
  fileCounter = null,
  onToggle,
}: StageTimelineProps) {
  const byName = new Map(progress.map((p) => [p.name, p]));

  return (
    <div className="stage-timeline" role="group" aria-label="Pipeline stages">
      {IMAGING_PIPELINE.map((spec, i) => {
        const blocked = mode === 'config' ? blockedReason(spec, inputSuffixes) : null;
        const live = byName.get(spec.name);
        const on = mode === 'config' ? Boolean(enabled[spec.name]) && !blocked : Boolean(live);
        const status = live?.status;
        // Only the stage the engine says is current gets the detail line — a
        // done, pending, or merely also-running stage showing "jump · file 2
        // of 4" would be describing someone else's work.
        // No fallback when the stage is unknown: attributing a file counter to
        // every stage that reads "running" is the misattribution this prop
        // exists to prevent. The status line still shows it, unattributed.
        const isCurrent = status === 'running' && currentStageName === spec.name;
        const detail =
          mode === 'progress' && isCurrent
            ? [currentStep, fileCounter].filter(Boolean).join(' · ')
            : '';

        return (
          <div className="stage-timeline-cell" key={spec.name}>
            {i > 0 && (
              <span className="stage-flow" aria-hidden="true">
                {spec.consumes}
                <span className="stage-flow-arrow"> → </span>
              </span>
            )}
            <div
              className={[
                'stage-node',
                on ? 'stage-node-on' : 'stage-node-off',
                blocked ? 'stage-node-blocked' : '',
                status ? `stage-node-${status}` : '',
              ]
                .filter(Boolean)
                .join(' ')}
            >
              {mode === 'config' ? (
                <label className="stage-node-label">
                  <input
                    type="checkbox"
                    checked={on}
                    disabled={Boolean(blocked)}
                    onChange={(e) => onToggle?.(spec.name, e.target.checked)}
                  />
                  <span>{spec.label}</span>
                </label>
              ) : (
                <span className="stage-node-label">
                  <span className="stage-node-glyph">{statusGlyph(status ?? 'pending')}</span>
                  <span>{spec.label}</span>
                </span>
              )}
              <span className="stage-node-io">
                {spec.consumes} → {spec.produces}
              </span>
              {detail && <span className="stage-node-detail">{detail}</span>}
            </div>
            {blocked && (
              <span className="stage-node-reason" role="note">
                {blocked}
              </span>
            )}
          </div>
        );
      })}
    </div>
  );
}
