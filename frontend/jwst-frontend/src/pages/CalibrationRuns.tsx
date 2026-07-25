/**
 * Calibration run history — /calibrate/runs (#1734).
 *
 * Runs are long (up to the 4h CALIBRATION_TIMEOUT_S) and only one executes at
 * a time, so they need a durable home. Before this page the engine's job list
 * had no consumer at all: a run you navigated away from was unreachable.
 */

import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { EmptyState } from '../components/ui/EmptyState';
import { listJobs } from '../services/calibrationService';
import type { CalibrationJob } from '../types/CalibrationTypes';
import './CalibrationRuns.css';

const ACTIVE: ReadonlySet<CalibrationJob['status']> = new Set(['queued', 'downloading', 'running']);

function elapsed(job: CalibrationJob): string {
  const start = job.startedAt ?? job.createdAt;
  const end = job.finishedAt ?? new Date().toISOString();
  const ms = Date.parse(end) - Date.parse(start);
  if (!Number.isFinite(ms) || ms < 0) return '—';
  const mins = Math.round(ms / 60000);
  if (mins < 1) return '<1m';
  if (mins < 60) return `${mins}m`;
  return `${Math.floor(mins / 60)}h ${mins % 60}m`;
}

export function RunRow({ job }: { job: CalibrationJob }) {
  const outputs = job.result?.outputs.length ?? 0;
  return (
    <li className={`runs-row runs-row-${job.status}`}>
      <span className={`runs-pill runs-pill-${job.status}`}>{job.status}</span>
      <div className="runs-row-main">
        <Link className="runs-row-link" to={`/calibrate/runs/${job.jobId}`}>
          {job.jobId}
        </Link>
        <div className="runs-row-meta">
          {job.status === 'queued'
            ? 'Waiting — the engine runs one calibration at a time'
            : (job.progress.message ??
              (job.status === 'succeeded'
                ? `${outputs} output${outputs === 1 ? '' : 's'}`
                : (job.error ?? '—')))}
        </div>
      </div>
      <div className="runs-row-right">{elapsed(job)}</div>
    </li>
  );
}

export default function CalibrationRuns() {
  const [jobs, setJobs] = useState<CalibrationJob[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const load = () => {
      listJobs()
        .then((list) => {
          if (!cancelled) setJobs(list);
        })
        .catch((err: unknown) => {
          if (!cancelled) setError(err instanceof Error ? err.message : 'Failed to load runs');
        });
    };
    load();
    // Keep the list fresh while something is still running, without a socket.
    const timer = setInterval(load, 10000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, []);

  if (error) {
    return (
      <div className="calibration-runs">
        <EmptyState title="Couldn't load runs" description={error} />
      </div>
    );
  }

  const active = jobs?.filter((j) => ACTIVE.has(j.status)) ?? [];
  const past = jobs?.filter((j) => !ACTIVE.has(j.status)) ?? [];

  return (
    <div className="calibration-runs">
      <header className="calibration-runs-header">
        <div>
          <h1>Calibration runs</h1>
          <p className="calibrate-hint">
            {jobs === null ? 'Loading…' : `${active.length} active · ${past.length} completed`}
          </p>
        </div>
        <div className="calibration-runs-actions">
          <Link className="btn-base btn-compact" to="/calibrate/recipes">
            Recipes
          </Link>
          <Link className="btn-base btn-standard" to="/calibrate/new">
            + New run
          </Link>
        </div>
      </header>

      {jobs !== null && jobs.length === 0 && (
        <EmptyState
          title="No calibration runs yet"
          description="Start one from your data — it'll show up here, and stay here even if you navigate away."
          actions={
            <Link className="btn-base btn-standard" to="/calibrate/new">
              Start a calibration
            </Link>
          }
        />
      )}

      {active.length > 0 && (
        <section aria-labelledby="active-heading">
          <h2 id="active-heading" className="calibration-runs-section">
            Active
          </h2>
          <ul className="runs-list">
            {active.map((job) => (
              <RunRow key={job.jobId} job={job} />
            ))}
          </ul>
        </section>
      )}

      {past.length > 0 && (
        <section aria-labelledby="history-heading">
          <h2 id="history-heading" className="calibration-runs-section">
            History
          </h2>
          <ul className="runs-list">
            {past.map((job) => (
              <RunRow key={job.jobId} job={job} />
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
