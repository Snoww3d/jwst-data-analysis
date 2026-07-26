/**
 * Making a silent run legible (#1770).
 *
 * A real four-file run emitted 67 log lines in 23.6 minutes, so the run page
 * can go visually dead for eight minutes at a stretch. The engine genuinely
 * has little to say during a stage, so the fix is not to invent motion — it is
 * to render the *waiting* honestly: how long it has been going, how long since
 * anything last changed, which sub-step and which file are in flight.
 *
 * Pure functions over primitives, so they can be tested without the DOM and
 * without a clock. Every one of them takes null/absent input, because runs
 * recorded before the engine started reporting these fields will not have them
 * and must degrade to "not shown" rather than to "NaN".
 */

/** Milliseconds for an ISO-8601 timestamp, or null if absent/unparseable. */
export function toMillis(iso: string | null | undefined): number | null {
  if (!iso) return null;
  const ms = Date.parse(iso);
  return Number.isFinite(ms) ? ms : null;
}

/**
 * A span as a person would say it: "less than a minute", "7 min", "1h 12m".
 * Negative spans (clock skew between engine and browser) clamp to zero rather
 * than rendering "-3 min".
 */
export function formatDuration(ms: number): string {
  if (!Number.isFinite(ms)) return '';
  const totalMinutes = Math.floor(Math.max(ms, 0) / 60_000);
  if (totalMinutes < 1) return 'less than a minute';
  if (totalMinutes < 60) return `${totalMinutes} min`;
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return minutes === 0 ? `${hours}h` : `${hours}h ${minutes}m`;
}

/** How long ago something happened: "just now", "4 min ago", "1h 12m ago". */
export function formatAgo(ms: number): string {
  if (!Number.isFinite(ms)) return '';
  // Under a minute is "just now" — the same boundary formatDuration uses, so
  // the two never disagree ("less than a minute ago" reads as a bug).
  if (ms < 60_000) return 'just now';
  return `${formatDuration(ms)} ago`;
}

export interface StageAndStep {
  stage: string | null;
  step: string | null;
}

/**
 * `progress.currentStage` is "stage:step" (e.g. "detector1:jump") — the UI used
 * to show only the stage, which is the part that does not change for minutes at
 * a time. Plain stage names (no colon) stay valid input.
 */
export function parseCurrentStage(currentStage: string | null | undefined): StageAndStep {
  if (!currentStage) return { stage: null, step: null };
  const trimmed = currentStage.trim();
  if (!trimmed) return { stage: null, step: null };
  const colon = trimmed.indexOf(':');
  if (colon === -1) return { stage: trimmed, step: null };
  const stage = trimmed.slice(0, colon).trim();
  const step = trimmed.slice(colon + 1).trim();
  return { stage: stage || null, step: step || null };
}

/** "file 2 of 4", or null unless both numbers are present and sane. */
export function formatFileCounter(
  currentFile: number | null | undefined,
  totalFiles: number | null | undefined
): string | null {
  if (typeof currentFile !== 'number' || typeof totalFiles !== 'number') return null;
  if (!Number.isFinite(currentFile) || !Number.isFinite(totalFiles)) return null;
  if (currentFile < 1 || totalFiles < 1 || currentFile > totalFiles) return null;
  return `file ${currentFile} of ${totalFiles}`;
}

/**
 * A run killed by an engine restart ends in a terminal state with no
 * explanation the user can act on — the same words for "you did this" and "the
 * machine did this to you". Today the engine's reconciler records it as
 * `failed` with "interrupted by service restart"; a cancel-shaped record is
 * also possible. Both are covered.
 */
// Deliberately not a bare /interrupt/: a jwst traceback containing
// "KeyboardInterrupt" is a failure, and telling that user "nothing you did
// caused this" would be worse than saying nothing.
const INTERRUPTED_RE = /restart(ed|ing)?\b|interrupted by|shut\s*down|engine (stopped|exited)/i;

export function isInterrupted(error: string | null | undefined): boolean {
  return Boolean(error && INTERRUPTED_RE.test(error));
}

export interface InterruptionInput {
  status: string;
  /** True only when the user pressed Cancel — the engine sets it on that route. */
  cancelRequested: boolean;
  error: string | null;
}

/**
 * Did the machine stop this run, rather than the user?
 *
 * `cancelRequested` is the primary signal because it is structured and can only
 * be set by the user-initiated cancel route; the error text only narrows the
 * remaining cases, so a pipeline traceback that happens to contain the word
 * "interrupt" cannot get us to tell someone "nothing you did caused this" when
 * they pressed the button themselves.
 */
export function wasInterrupted(job: InterruptionInput): boolean {
  if (job.status === 'succeeded' || job.status === 'queued') return false;
  if (job.cancelRequested) return false;
  return isInterrupted(job.error);
}
