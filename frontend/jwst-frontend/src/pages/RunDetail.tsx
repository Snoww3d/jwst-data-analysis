/**
 * Calibration run detail — /calibrate/runs/:jobId (#1734).
 *
 * A run can take hours and only one executes at a time, so its handle belongs
 * in the URL rather than in component state: this page survives a refresh, can
 * be bookmarked, and can be reopened from the run history. Previously the job
 * id lived in `useState` on CalibrateRun, so navigating away orphaned the run
 * with no way back to it.
 */

import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { LogPanel } from '../components/wizard/LogPanel';
import { EmptyState } from '../components/ui/EmptyState';
import { ImagePreviewLightbox } from '../components/ui/ImagePreviewLightbox';
import { StageTimeline } from '../components/calibration/StageTimeline';
import TableViewer from '../components/TableViewer';
import { estimateMinutes, formatEstimate, specFor } from '../components/calibration/stagePipeline';
import {
  formatAgo,
  formatDuration,
  formatFileCounter,
  parseCurrentStage,
  toMillis,
  wasInterrupted,
} from '../components/calibration/runTiming';
import { toast } from '../components/ui/toast';
import { useCalibrationJob } from '../hooks/useCalibrationJob';
import {
  cancelJob,
  downloadJobOutput,
  getJobOutputPreview,
  saveJobOutputToLibrary,
} from '../services/calibrationService';
import type { StepOverrides } from '../types/CalibrationTypes';
import './CalibrateRun.css';

/**
 * How often the heartbeat re-renders (#1770). The engine can be silent for
 * eight minutes at a time, so the ticking clock — not new data — is what tells
 * the user the page is alive. One second is fine: it is a text swap on a
 * handful of nodes, and it stops entirely once the job is terminal.
 */
export const TICK_MS = 1000;

/** Only FITS image products can be rendered as images; ASDF outputs are
 *  download-only. */
// Kept in lockstep with the backend allowlist _PREVIEWABLE_SUFFIXES
// (.fits, .fit, .fits.gz) in processing-engine/app/jobs/routes.py.
const PREVIEWABLE_RE = /\.(fits(\.gz)?|fit)$/i;
const isPreviewable = (storageKey: string): boolean => PREVIEWABLE_RE.test(storageKey);

/** Source catalogs have no image but are the citable half of a run, so they are
 *  savable and readable in the table viewer — just not previewable. */
// Lockstep with _TABULAR_SUFFIXES in processing-engine/app/jobs/routes.py.
const TABULAR_RE = /\.ecsv$/i;
const isTabular = (storageKey: string): boolean => TABULAR_RE.test(storageKey);

/** What the backend will accept into the library (_LIBRARY_SUFFIXES). */
const isSavable = (storageKey: string): boolean =>
  isPreviewable(storageKey) || isTabular(storageKey);

const basename = (key: string): string => key.split('/').pop() ?? key;

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
  const {
    job,
    isTerminal,
    error: pollError,
    stopped: pollStopped,
  } = useCalibrationJob(jobId ?? null);
  const navigate = useNavigate();

  // Jobs created before #1751 stored only storage keys, which cannot be turned
  // back into library items. Re-running one would drop to the recipe's MAST
  // query and silently start a fresh multi-GB download, so offer it as
  // unavailable rather than as something that quietly does the wrong thing.
  const rerunUnavailable = Boolean(
    (job?.request?.inputs?.length ?? 0) > 0 && !(job?.request?.input_data_ids?.length ?? 0)
  );

  const [cancelling, setCancelling] = useState(false);
  const [savedIds, setSavedIds] = useState<Record<number, string>>({});
  const [savingIndex, setSavingIndex] = useState<number | null>(null);
  const [previewIndex, setPreviewIndex] = useState<number | null>(null);
  // The saved catalog currently open in the table viewer, which is keyed by
  // library dataId rather than by output index — a catalog is only viewable
  // once it has a library record.
  const [catalog, setCatalog] = useState<{ dataId: string; title: string } | null>(null);

  // The heartbeat clock. Depends on a boolean rather than on `job` itself, so
  // the 1.5s poll doesn't tear down and rebuild the interval on every tick.
  const [now, setNow] = useState(() => Date.now());
  // Not just "the job is unfinished": once polling has given up, the page is
  // no longer watching anything, and a clock that kept moving would be
  // claiming otherwise.
  const isLive = job !== null && !isTerminal && !pollStopped;
  useEffect(() => {
    if (!isLive) return undefined;
    const id = setInterval(() => setNow(Date.now()), TICK_MS);
    return () => clearInterval(id);
  }, [isLive]);

  const loadPreview = useCallback(
    () => getJobOutputPreview(jobId ?? '', previewIndex ?? 0),
    [jobId, previewIndex]
  );
  // Stable identity so the lightbox's effects don't re-run on every poll tick.
  const closePreview = useCallback(() => setPreviewIndex(null), []);
  const closeCatalog = useCallback(() => setCatalog(null), []);

  const handleSave = async (index: number, storageKey: string) => {
    if (!jobId) return;
    setSavingIndex(index);
    try {
      const { dataId, created } = await saveJobOutputToLibrary(jobId, index);
      setSavedIds((prev) => ({ ...prev, [index]: dataId }));
      // A catalog goes to the table viewer, not the compositor, so the two
      // saves promise different next steps.
      const savedWhat = isTabular(storageKey)
        ? 'Opens in the table viewer — positions, fluxes and magnitudes.'
        : 'Opens in the full viewer, and can be used in a composite.';
      toast.success(created ? 'Saved to library' : 'Already in your library', {
        description: created ? savedWhat : 'This output was saved earlier — reusing that record.',
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

  // Computed once rather than twice inline: this render now repeats on a
  // one-second tick, so the JSX should not do the same work twice per tick.
  const paramRows = overrideRows(job?.request?.run_overrides);

  // --- Heartbeat / progress detail (#1770) -------------------------------
  // Every value below is null-tolerant: runs recorded before the engine
  // reported these fields must simply not show them, never "file null of null".
  // `??` per-parse, not on the raw strings: a present-but-unparseable
  // startedAt should still fall back to createdAt rather than lose the clock.
  const runStartMs = toMillis(job?.startedAt);
  const startMs = runStartMs ?? toMillis(job?.createdAt);
  const finishedMs = toMillis(job?.finishedAt);
  const endMs = isTerminal ? finishedMs : now;
  // A finished run's clock stops at its end, not at the last render. Without a
  // finishedAt there is no honest duration to show — `now` would be whenever
  // the page happened to mount, so a run opened a week later would claim to
  // have taken a week. Hide it instead of inventing it.
  const elapsedMs = startMs === null || endMs === null ? null : Math.max(endMs - startMs, 0);
  const updatedMs = toMillis(job?.updatedAt);
  const sinceUpdateMs = updatedMs === null ? null : Math.max(now - updatedMs, 0);

  const { stage: currentStageName, step: currentStep } = parseCurrentStage(
    job?.progress.currentStage
  );
  const fileCounter = formatFileCounter(job?.progress.currentFile, job?.progress.totalFiles);

  // Same rough model the config page quotes before the run starts, so the
  // number the user was given up front is the one they keep seeing.
  const enabledSpecs = (job?.request?.recipe_snapshot?.stages ?? []).flatMap((s) => {
    const spec = specFor(s.name);
    return s.enabled && spec ? [spec] : [];
  });
  // Only when the file count is actually known. estimateMinutes clamps an
  // unknown count to one file, so a 20-file MAST run (inputs is empty until
  // the engine reports totalFiles) would be quoted as a single file and go
  // "past the estimate" within minutes of a job that legitimately runs for
  // hours. A missing estimate is honest; a confidently wrong one is not.
  const reportedFiles = job?.progress.totalFiles;
  const knownFileCount =
    (reportedFiles && reportedFiles > 0 ? reportedFiles : null) ??
    (job?.request?.inputs?.length || null);
  const totalEstimateMinutes =
    enabledSpecs.length > 0 && knownFileCount !== null
      ? estimateMinutes(enabledSpecs, knownFileCount)
      : 0;
  const remainingMinutes =
    totalEstimateMinutes > 0 && elapsedMs !== null
      ? totalEstimateMinutes - elapsedMs / 60_000
      : null;

  // Reachable from `failed` as well as `cancelled`: the engine's restart
  // reconciler records an interrupted run as failed with
  // "interrupted by service restart", which is the very case this explains.
  const interrupted = job !== null && isTerminal && wasInterrupted(job);
  // A queued run is waiting and a downloading one is fetching — neither is
  // "running", and saying so would mislabel minutes the pipeline never saw.
  // Without a startedAt the clock is measuring from submission, which includes
  // the queue wait, so it says "in flight" rather than naming a phase it
  // cannot actually vouch for.
  const isQueued = job?.status === 'queued';
  const elapsedLabel = (() => {
    if (isTerminal) return 'Took';
    // The phase comes first, then the tense: once polling has given up the
    // clock is frozen at the last successful poll, so the present tense would
    // be the page's one remaining moving-target claim — but a run that was
    // queued when contact was lost was never "running" either.
    if (isQueued) return pollStopped ? 'Was queued for' : 'Queued for';
    if (runStartMs === null) return pollStopped ? 'Was in flight for' : 'In flight for';
    if (job?.status === 'downloading')
      return pollStopped ? 'Was downloading for' : 'Downloading for';
    return pollStopped ? 'Was running for' : 'Running for';
  })();

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
            {isTerminal && job.request.recipe_id && (
              <button
                type="button"
                className="btn-base btn-compact"
                disabled={rerunUnavailable}
                aria-describedby={rerunUnavailable ? 'rerun-unavailable-reason' : undefined}
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
                        // Carry the source library items so a re-run of a
                        // library run stays a library run — without these the
                        // form falls back to the recipe's MAST query and
                        // silently starts a fresh download instead (#1751).
                        inputDataIds: job.request.input_data_ids ?? [],
                      },
                      stage3Only: (job.request.inputs ?? []).some((i) => i.path.includes('_cal')),
                    },
                  })
                }
              >
                Re-run with changes
              </button>
            )}
          </div>
          {rerunUnavailable && isTerminal && job.request.recipe_id && (
            <p id="rerun-unavailable-reason" className="calibrate-hint" role="status">
              This run predates input tracking, so its source files can&apos;t be re-selected
              automatically. Start it again from your library.
            </p>
          )}
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
              {paramRows.length === 0
                ? 'pipeline defaults'
                : paramRows.map((r) => `${r.step}.${r.param}=${r.value}`).join(', ')}
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
          <p className={pollStopped ? 'calibrate-error' : 'calibrate-hint'} role="alert">
            {pollStopped
              ? `Lost contact with the engine (${pollError}). This page has stopped watching — reload to reconnect. The run itself may still be going.`
              : `${pollError} (retrying…)`}
          </p>
        )}
        {!job && !pollError && <p role="status">Loading run…</p>}
        {job && (
          <>
            <p className="calibrate-status" role="status">
              Status: <strong>{job.status}</strong>
              {currentStageName ? ` — ${currentStageName}` : ''}
              {currentStep ? ` · ${currentStep}` : ''}
              {fileCounter ? ` — ${fileCounter}` : ''}
              {job.progress.message ? ` — ${job.progress.message}` : ''}
              {job.status === 'downloading' && job.progress.downloadPct !== null
                ? ` (${job.progress.downloadPct}%)`
                : ''}
            </p>
            {/* role="timer" rather than role="status": this text changes every
                second, and a second polite live region next to the status line
                would talk over it once a second. A timer is a live region with
                aria-live="off" by default — visible motion, no announcements. */}
            {/* Same condition the children use, so this never renders as an
                empty named live region with nothing inside it. */}
            {(elapsedMs !== null || (!isTerminal && sinceUpdateMs !== null)) && (
              <p className="calibrate-heartbeat" role="timer" aria-label="Run timing">
                {elapsedMs !== null && (
                  <span>
                    {elapsedLabel} <strong>{formatDuration(elapsedMs)}</strong>
                  </span>
                )}
                {!isTerminal && sinceUpdateMs !== null && (
                  <span> · last update {formatAgo(sinceUpdateMs)}</span>
                )}
                {/* A queued run has not started, so nothing of the estimate has
                    been consumed yet — quoting "left" there would be a lie. */}
                {!isTerminal && !isQueued && remainingMinutes !== null && (
                  <span>
                    {' · '}
                    {/* Floored at a minute: formatEstimate renders anything
                        under 30s as "~0 min", which reads as broken. */}
                    {remainingMinutes > 0
                      ? `rough estimate: ${formatEstimate(Math.max(remainingMinutes, 1))} left`
                      : `already past the rough ${formatEstimate(totalEstimateMinutes)} estimate`}
                  </span>
                )}
              </p>
            )}
            {!isTerminal && !isQueued && (
              <p className="calibrate-hint">
                Long stages are normal — the engine can be quiet for several minutes at a time. The
                clock above keeps moving even when there is nothing new to report.
              </p>
            )}
            {job.status === 'queued' && (
              <p className="calibrate-hint">
                Waiting to start — the engine runs one calibration at a time.
              </p>
            )}
            {job.progress.stages.length > 0 && (
              <StageTimeline
                mode="progress"
                progress={job.progress.stages}
                currentStageName={currentStageName}
                currentStep={currentStep}
                fileCounter={fileCounter}
              />
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
                    const tabular = isTabular(output.storageKey);
                    const savable = isSavable(output.storageKey);
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
                          {tabular && <span className="calibrate-hint"> · source catalog</span>}
                          {!previewable && !tabular && (
                            <span className="calibrate-hint"> · not an image</span>
                          )}
                        </div>
                        <div className="calibrate-output-actions">
                          {savable &&
                            (savedId ? (
                              <>
                                <span className="calibrate-saved-badge">✓ In library</span>
                                {tabular ? (
                                  <button
                                    type="button"
                                    className="btn-base btn-compact"
                                    onClick={() =>
                                      setCatalog({
                                        dataId: savedId,
                                        title: basename(output.storageKey),
                                      })
                                    }
                                  >
                                    View catalog
                                  </button>
                                ) : (
                                  <Link
                                    className="btn-base btn-compact"
                                    to="/composite"
                                    state={{ initialSelection: [savedId] }}
                                  >
                                    Open in compositor
                                  </Link>
                                )}
                              </>
                            ) : (
                              <button
                                type="button"
                                className="btn-base btn-compact"
                                onClick={() => void handleSave(i, output.storageKey)}
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
            {/* An interruption is not a failure of the run and not something
                the user did, so it gets neither the red "Run failed: …" alert
                nor the bare "Run cancelled." — both of which read as blame. */}
            {interrupted && (
              <>
                <p className="calibrate-hint" role="status">
                  Interrupted — the engine restarted, so this run stopped. Nothing you did caused
                  it; re-run it when you are ready.
                </p>
                {/* The detection is a heuristic over the error text, so keep
                    the text: if it guesses wrong, the user still has the only
                    diagnostic string the page ever had. */}
                {job.error && <p className="calibrate-hint">Engine said: {job.error}</p>}
              </>
            )}
            {!interrupted && job.status === 'failed' && (
              <p className="calibrate-error" role="alert">
                Run failed: {job.error ?? 'unknown error'}
              </p>
            )}
            {!interrupted && job.status === 'cancelled' && (
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

      {catalog && (
        <TableViewer
          key={catalog.dataId}
          dataId={catalog.dataId}
          title={catalog.title}
          isOpen
          onClose={closeCatalog}
        />
      )}
    </div>
  );
}
