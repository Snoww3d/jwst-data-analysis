/**
 * Progress — JWST Discovery design-system primitive.
 *
 * Three variants:
 *   - Determinate    (known magnitude, pass `value` 0–100)
 *   - Indeterminate  (unknown magnitude, omit `value`)
 *   - Stepped        (discrete wizard steps — use <Steps /> below)
 *
 * Usage:
 *   <Progress label="Stacking F444W frames" value={68} meta="6 of 9 · ~1m 12s" />
 *   <Progress label="Contacting MAST archive…" />
 *   <Progress label="Download complete" value={100} tone="success" />
 *
 *   <Steps
 *     steps={['Target', 'Recipe', 'Preview', 'Export']}
 *     currentIndex={2}
 *   />
 */

import './Progress.css';

interface ProgressProps {
  label?: string;
  /** 0–100. Omit for indeterminate. */
  value?: number;
  /** Optional right-aligned context line under the track. */
  meta?: string;
  /** Overrides the default gradient fill for semantic states. */
  tone?: 'default' | 'primary' | 'success' | 'warning' | 'error';
}

export function Progress({ label, value, meta, tone = 'default' }: ProgressProps) {
  const indeterminate = value === undefined;
  const pct = indeterminate ? undefined : Math.max(0, Math.min(100, value));

  return (
    <div
      className={`progress${indeterminate ? ' progress-indeterminate' : ''}`}
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={indeterminate ? undefined : pct}
      aria-label={label}
    >
      {(label || !indeterminate) && (
        <div className="progress-meta">
          {label && <span className="progress-label">{label}</span>}
          {!indeterminate && <span className="progress-pct">{pct}%</span>}
          {indeterminate && <span className="progress-pct">—</span>}
        </div>
      )}
      <div className="progress-track">
        <div
          className={`progress-fill progress-fill-${tone}`}
          style={indeterminate ? undefined : { width: `${pct}%` }}
        />
      </div>
      {meta && <div className="progress-meta-line">{meta}</div>}
    </div>
  );
}

interface StepsProps {
  steps: string[];
  currentIndex: number;
}

export function Steps({ steps, currentIndex }: StepsProps) {
  return (
    <ol className="steps" aria-label="Progress steps">
      {steps.map((label, i) => {
        const done = i < currentIndex;
        const current = i === currentIndex;
        return (
          <li
            key={label}
            className={`step${done ? ' step-done' : ''}${current ? ' step-current' : ''}`}
            aria-current={current ? 'step' : undefined}
          >
            <span className="step-dot" aria-hidden="true">
              {done ? (
                <svg
                  viewBox="0 0 24 24"
                  width="10"
                  height="10"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="3"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M5 13l4 4L19 7" />
                </svg>
              ) : (
                i + 1
              )}
            </span>
            <span className="step-label">{label}</span>
            {i < steps.length - 1 && <span className="step-line" aria-hidden="true" />}
          </li>
        );
      })}
    </ol>
  );
}
