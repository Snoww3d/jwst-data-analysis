/**
 * Calibration run detail — /calibrate/runs/:jobId (#1734).
 *
 * A run can take hours and only one executes at a time, so its handle belongs
 * in the URL rather than in component state: this page survives a refresh, can
 * be bookmarked, and can be reopened from the run history. Previously the job
 * id lived in `useState` on CalibrateRun, so navigating away orphaned the run
 * with no way back to it.
 */

import { useCallback, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { LogPanel } from '../components/wizard/LogPanel';
import { EmptyState } from '../components/ui/EmptyState';
import { ImagePreviewLightbox } from '../components/ui/ImagePreviewLightbox';
import { StageTimeline } from '../components/calibration/StageTimeline';
import { toast } from '../components/ui/toast';
import { useCalibrationJob } from '../hooks/useCalibrationJob';
import {
  cancelJob,
  downloadJobOutput,
  getJobOutputPreview,
  saveJobOutputToLibrary,
} from '../services/calibrationService';
import type { CalibrationJob, StepOverrides } from '../types/CalibrationTypes';
import './CalibrateRun.css';

/** Only FITS image products can be rendered or saved as library images;
 *  catalogs (.ecsv) and ASDF outputs are download-only. */
// Kept in lockstep with the backend allowlist _PREVIEWABLE_SUFFIXES
// (.fits, .fit, .fits.gz) in processing-engine/app/jobs/routes.py.
const PREVIEWABLE_RE = /\.(fits(\.gz)?|fit)$/i;
const isPreviewable = (storageKey: string): boolean => PREVIEWABLE_RE.test(storageKey);
const basename = (key: string): string => key.split('/').pop() ?? key;

const TERMINAL: ReadonlySet<CalibrationJob['status']> = new Set([
  'succeeded',
  'failed',
  'cancelled',
]);

/** Flatten run overrides into display rows, in the shape the config form uses. */
function overrideRows(overrides: StepOverrides | undefined): {
  step: string;
  param: string;
  value: string;
}[] {
  const rows: { step: string; param: string; value: string }[] = [];
  for (const [step, params] of Object.entries(overrides ?? {})) {
    for (const [param, value] of Object.entries(params)) {
      rows.push({ step, param, value: JSON.stringify(value) });
    }
  }
  return rows;
}

export default function RunDetail() {
  const { jobId } = useParams<{ jobId: string }>();
  const { job, isTerminal, error: pollError } = useCalibrationJob(jobId ?? null);
  const navigate = useNavigate();

  const [cancelling, setCancelling] = useState(false);
  const [savedIds, setSavedIds] = useState<Record<number, string>>({});
  const [savingIndex, setSavingIndex] = useState<number | null>(null);
  const [previewIndex, setPreviewIndex] = useState<number | null>(null);

  const loadPreview = useCallback(
    () => getJobOutputPreview(jobId ?? '', previewIndex ?? 0),
    [jobId, previewIndex]
  );
  // Stable identity so the lightbox's effects don't re-run on every poll tick.
  const closePreview = useCallback(() => setPreviewIndex(null), []);

  const handleSave = async (index: number) => {
    if (!jobId) return;
    setSavingIndex(index);
    try {
      const { dataId, created } = await saveJobOutputToLibrary(jobId, index);
      setSavedIds((prev) => ({ ...prev, [index]: dataId }));
      toast.success(created ? 'Saved to library' : 'Already in your library', {
        description: created
          ? 'Opens in the full viewer, and can be used in a composite.'
          : 'This output was saved earlier — reusing that record.',
      });
    } catch (err: unknown) {
      toast.error('Could not save to library', {
        description: err instanceof Error ? err.message : 'Unexpected error',
      });
    } finally {
      setSavingIndex(null);
    }
  };

  const handleDownload = async (index: number, storageKey: string) => {
    if (!jobId) return;
    try {
      const blob = await downloadJobOutput(jobId, index);
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = basename(storageKey);
      anchor.click();
      URL.revokeObjectURL(url);
    } catch (err: unknown) {
      toast.error('Download failed', {
        description: err instanceof Error ? err.message : 'Unexpected error',
      });
    }
  };

  if (!jobId) {
    return (
      <div className="calibrate-run">
        <EmptyState title="No run selected" description="Pick a run from the history." />
      </div>
    );
  }

  return (
    <div className="calibrate-run">
      <nav className="calibrate-run-breadcrumb">
        <Link to="/calibrate/runs">← All runs</Link>
      </nav>
      <h1>{job?.request?.recipe_snapshot?.name ?? 'Calibration run'}</h1>
      <p className="calibrate-hint calibrate-run-id">
        <code>{jobId}</code>
      </p>

      {job?.request?.recipe_snapshot && (
        <section className="calibrate-section" aria-labelledby="config-heading">
          <div className="calibrate-config-head">
            <h2 id="config-heading">Configuration</h2>
            {TERMINAL.has(job.status) && job.request.recipe_id && (
              <button
                type="button"
                className="btn-base btn-compact"
                onClick={() =>
                  navigate(`/calibrate/${job.request.recipe_id}`, {
                    state: {
                      rerun: {
                        enabledStages: Object.fromEntries(
                          (job.request.recipe_snapshot?.stages ?? []).map((s) => [
                            s.name,
                            s.enabled,
                          ])
                        ),
                        runOverrides: job.request.run_overrides ?? {},
                      },
                    },
                  })
                }
              >
                Re-run with changes
              </button>
            )}
          </div>
          <p className="calibrate-hint">
            What this run was started with — kept so you can see it while the run is in flight, and
            reuse it afterwards.
          </p>
          <ul className="calibrate-config-list">
            <li>
              <strong>Stages:</strong>{' '}
              {job.request.recipe_snapshot.stages
                .filter((s) => s.enabled)
                .map((s) => s.name)
                .join(' → ') || 'none'}
            </li>
            <li>
              <strong>Parameters:</strong>{' '}
              {overrideRows(job.request.run_overrides).length === 0
                ? 'pipeline defaults'
                : overrideRows(job.request.run_overrides)
                    .map((r) => `${r.step}.${r.param}=${r.value}`)
                    .join(', ')}
            </li>
            <li>
              <strong>Inputs:</strong>{' '}
              {job.request.inputs?.length
                ? `${job.request.inputs.length} file${job.request.inputs.length === 1 ? '' : 's'}`
                : 'fetched from MAST'}
            </li>
          </ul>
        </section>
      )}

      <section className="calibrate-section" aria-labelledby="progress-heading">
        <h2 id="progress-heading">Run progress</h2>
        {pollError && (
          <p className="calibrate-hint" role="alert">
            {pollError} (retrying…)
          </p>
        )}
        {!job && !pollError && <p role="status">Loading run…</p>}
        {job && (
          <>
            <p className="calibrate-status" role="status">
              Status: <strong>{job.status}</strong>
              {job.progress.message ? ` — ${job.progress.message}` : ''}
              {job.status === 'downloading' && job.progress.downloadPct !== null
                ? ` (${job.progress.downloadPct}%)`
                : ''}
            </p>
            {job.status === 'queued' && (
              <p className="calibrate-hint">
                Waiting to start — the engine runs one calibration at a time.
              </p>
            )}
            {job.progress.stages.length > 0 && (
              <StageTimeline mode="progress" progress={job.progress.stages} />
            )}
            <LogPanel messages={job.logTail} defaultOpen={true} />
            {!isTerminal && (
              <button
                type="button"
                className="btn-base btn-compact"
                onClick={() => {
                  setCancelling(true);
                  cancelJob(job.jobId).catch(() => setCancelling(false));
                }}
                disabled={cancelling || job.cancelRequested}
              >
                {cancelling || job.cancelRequested ? 'Cancelling…' : 'Cancel run'}
              </button>
            )}
            {job.status === 'succeeded' && job.result && (
              <div className="calibrate-result" role="status">
                <h3>Outputs</h3>
                <ul className="calibrate-output-list">
                  {job.result.outputs.map((output, i) => {
                    const sizeMb = (output.sizeBytes / 1024 / 1024).toFixed(1);
                    const previewable = isPreviewable(output.storageKey);
                    const savedId = savedIds[i];
                    return (
                      <li key={output.storageKey}>
                        <div className="calibrate-output-line">
                          {previewable ? (
                            <button
                              type="button"
                              className="btn-base calibrate-output-preview"
                              onClick={() => setPreviewIndex(i)}
                              title="Preview this output"
                            >
                              <code>{output.storageKey}</code>
                            </button>
                          ) : (
                            <code>{output.storageKey}</code>
                          )}{' '}
                          ({sizeMb} MB)
                          {!previewable && <span className="calibrate-hint"> · not an image</span>}
                        </div>
                        <div className="calibrate-output-actions">
                          {previewable &&
                            (savedId ? (
                              <>
                                <span className="calibrate-saved-badge">✓ In library</span>
                                <Link
                                  className="btn-base btn-compact"
                                  to="/composite"
                                  state={{ initialSelection: [savedId] }}
                                >
                                  Open in compositor
                                </Link>
                              </>
                            ) : (
                              <button
                                type="button"
                                className="btn-base btn-compact"
                                onClick={() => void handleSave(i)}
                                disabled={savingIndex === i}
                              >
                                {savingIndex === i ? 'Saving…' : 'Save to library'}
                              </button>
                            ))}
                          <button
                            type="button"
                            className="btn-base btn-compact"
                            onClick={() => void handleDownload(i, output.storageKey)}
                          >
                            Download
                          </button>
                        </div>
                      </li>
                    );
                  })}
                </ul>
                {job.result.jwstVersion && (
                  <p className="calibrate-hint">
                    jwst {job.result.jwstVersion}
                    {job.result.crdsContext ? ` · CRDS ${job.result.crdsContext}` : ''}
                  </p>
                )}
              </div>
            )}
            {job.status === 'failed' && (
              <p className="calibrate-error" role="alert">
                Run failed: {job.error ?? 'unknown error'}
              </p>
            )}
            {job.status === 'cancelled' && (
              <p className="calibrate-hint" role="status">
                Run cancelled.
              </p>
            )}
          </>
        )}
      </section>

      {previewIndex !== null && job?.result?.outputs[previewIndex] && (
        <ImagePreviewLightbox
          key={job.result.outputs[previewIndex].storageKey}
          open
          title={basename(job.result.outputs[previewIndex].storageKey)}
          onClose={closePreview}
          loadImage={loadPreview}
        />
      )}
    </div>
  );
}
