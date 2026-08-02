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
import { useAuth } from '../context/useAuth';
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

export function RunRow({ job, showOwner = false }: { job: CalibrationJob; showOwner?: boolean }) {
  const outputs = job.result?.outputs.length ?? 0;
  return (
    <li className={`runs-row runs-row-${job.status}`}>
      <span className={`runs-pill runs-pill-${job.status}`}>{job.status}</span>
      <div className="runs-row-main">
        <Link className="runs-row-link" to={`/calibrate/runs/${job.jobId}`}>
          {job.jobId}
        </Link>
        {/* #1807: in the all-users view the rows are no longer all the
            caller's, so each one has to say whose it is. */}
        {showOwner && job.userId && <span className="runs-row-owner">{job.userId}</span>}
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
  const { isAuthenticated, user } = useAuth();
  const isAdmin = user?.role === 'Admin';
  // #1807: opt-in. Merging every user's runs into an admin's own history by
  // default would make their personal list unusable.
  const [allUsers, setAllUsers] = useState(false);

  useEffect(() => {
    // Runs are per-user, so an anonymous visitor has none to fetch. Recipes
    // stay publicly browsable, so this page must still offer a way there
    // rather than dead-ending on a 401.
    if (!isAuthenticated) return undefined;
    let cancelled = false;
    const load = () => {
      listJobs(50, isAdmin && allUsers)
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
  }, [isAuthenticated, isAdmin, allUsers]);

  const active = jobs?.filter((j) => ACTIVE.has(j.status)) ?? [];
  const past = jobs?.filter((j) => !ACTIVE.has(j.status)) ?? [];

  return (
    <div className="calibration-runs">
      <header className="calibration-runs-header">
        <div>
          <h1>Calibration runs</h1>
          <p className="calibrate-hint">
            {!isAuthenticated
              ? 'Signed-out view'
              : jobs === null
                ? 'Loading…'
                : `${active.length} active · ${past.length} completed`}
          </p>
        </div>
        <div className="calibration-runs-actions">
          {/* #1807: an admin can OPEN any run but could not FIND one — job ids
              are UUIDs, and this list had no admin bypass while get_job did.
              Explicit toggle, not an implicit merge. */}
          {isAdmin && (
            <label className="runs-all-users">
              <input
                type="checkbox"
                checked={allUsers}
                onChange={(e) => {
                  setAllUsers(e.target.checked);
                  setJobs(null);
                }}
              />
              All users
            </label>
          )}
          <Link className="btn-base btn-compact" to="/calibrate/attempts">
            Compare attempts
          </Link>
          <Link className="btn-base btn-compact" to="/calibrate/recipes">
            Recipes
          </Link>
          <Link className="btn-base btn-standard" to="/calibrate/new">
            + New run
          </Link>
        </div>
      </header>

      {error && <EmptyState title="Couldn't load your runs" description={error} />}

      {!error && !isAuthenticated && (
        <EmptyState
          title="Sign in to see your calibration runs"
          description="Runs are tied to your account. Recipes are browsable without signing in."
          actions={
            <Link className="btn-base btn-standard" to="/calibrate/recipes">
              Browse recipes
            </Link>
          }
        />
      )}

      {!error && isAuthenticated && jobs !== null && jobs.length === 0 && (
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
              <RunRow key={job.jobId} job={job} showOwner={isAdmin && allUsers} />
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
              <RunRow key={job.jobId} job={job} showOwner={isAdmin && allUsers} />
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
