/**
 * Compare your calibration attempts — /calibrate/attempts (#1758).
 *
 * The loop this exists for: run a level several ways, look at the results,
 * keep the best, feed that one into the next step. Everything needed was
 * already being recorded (#1754) but scattered through the library among
 * everything else, identically named, so telling two attempts apart meant
 * guessing which row was which.
 *
 * Deliberately shows only what CHANGED between attempts. Repeating every
 * parameter on every card buries the one that differs, which is the whole
 * reason to see them together.
 */

import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { EmptyState } from '../components/ui/EmptyState';
import {
  comparableGroups,
  differingParams,
  groupAttempts,
  type Attempt,
  type AttemptGroup,
} from '../components/calibration/attempts';
import {
  advanceActionFor,
  reachableLevels,
  type OrderedLevel,
} from '../components/calibration/processingLevels';
import { instrumentOf } from '../components/calibration/dataGrouping';
import * as jwstDataService from '../services/jwstDataService';
import { useAuth } from '../context/useAuth';
import { API_BASE_URL } from '../config/api';
import { ProcessingLevelLabels, type JwstDataModel } from '../types/JwstDataTypes';
import './CalibrationAttempts.css';

function settingSummary(attempt: Attempt, differing: string[]): string {
  if (differing.length === 0) return attempt.isDefaults ? 'Recipe defaults' : 'Same settings';
  return differing
    .map((key) => {
      const [step, param] = key.split('.');
      const hit = attempt.settings.find((s) => s.step === step && s.param === param);
      return `${param} = ${hit ? hit.value : 'default'}`;
    })
    .join(' · ');
}

export function AttemptCard({
  attempt,
  differing,
  onContinue,
}: {
  attempt: Attempt;
  differing: string[];
  onContinue: (item: JwstDataModel) => void;
}) {
  const { item } = attempt;
  const action = advanceActionFor(item);
  return (
    <li className="attempt-card">
      <img
        className="attempt-thumb"
        src={`${API_BASE_URL}/api/jwstdata/${item.id}/thumbnail`}
        alt={item.fileName}
        loading="lazy"
      />
      <div className="attempt-body">
        <p className="attempt-settings">{settingSummary(attempt, differing)}</p>
        <p className="attempt-meta">{new Date(attempt.createdAt).toLocaleString()}</p>
      </div>
      {action ? (
        <button type="button" className="btn-base btn-compact" onClick={() => onContinue(item)}>
          {action.label}
        </button>
      ) : (
        // An L3 attempt is the end of the line; saying so beats a dead control.
        <span className="attempt-done">Final</span>
      )}
    </li>
  );
}

export function AttemptGroupSection({
  group,
  onContinue,
}: {
  group: AttemptGroup;
  onContinue: (item: JwstDataModel) => void;
}) {
  const differing = differingParams(group);
  const nextLevel: OrderedLevel | undefined = reachableLevels(group.level)[0];
  return (
    <section
      className="attempt-group"
      aria-labelledby={`grp-${group.observationBaseId}-${group.level}`}
    >
      <h2 id={`grp-${group.observationBaseId}-${group.level}`}>
        {group.observationBaseId} · {ProcessingLevelLabels[group.level] ?? group.level}
      </h2>
      <p className="attempt-group-hint">
        {group.attempts.length} attempts.{' '}
        {differing.length > 0
          ? `Differing settings: ${differing.join(', ')}.`
          : 'These used identical settings — the results should match.'}
        {nextLevel ? ` Pick the best and take it to ${nextLevel}.` : ''}
      </p>
      <ul className="attempt-list">
        {group.attempts.map((attempt) => (
          <AttemptCard
            key={attempt.item.id}
            attempt={attempt}
            differing={differing}
            onContinue={onContinue}
          />
        ))}
      </ul>
    </section>
  );
}

export default function CalibrationAttempts() {
  const { isAuthenticated } = useAuth();
  const navigate = useNavigate();
  const [items, setItems] = useState<JwstDataModel[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    // Outputs are private to their owner, so an anonymous visitor has none.
    if (!isAuthenticated) return undefined;
    let cancelled = false;
    jwstDataService
      .getAll(false)
      .then((data) => {
        if (!cancelled) setItems(data);
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setItems([]);
          setError(err instanceof Error ? err.message : 'Failed to load your library');
        }
      });
    return () => {
      cancelled = true;
    };
  }, [isAuthenticated]);

  const groups = useMemo(() => comparableGroups(groupAttempts(items ?? [])), [items]);

  const continueWith = (item: JwstDataModel) => {
    const action = advanceActionFor(item);
    if (!action) return;
    const instrument = (instrumentOf(item) ?? '').toLowerCase();
    const handoff = {
      inputDataIds: [item.id],
      startLevel: action.fromLevel,
      targetLevel: action.targetLevel,
    };
    navigate(
      ['nircam', 'niriss', 'miri'].includes(instrument)
        ? `/calibrate/seed-${instrument}-imaging`
        : '/calibrate/new',
      { state: handoff }
    );
  };

  return (
    <div className="attempts-page">
      <h1>Compare attempts</h1>
      <p className="attempts-intro">
        When you run the same data more than once, the results land here side by side with the
        settings that produced them — so you can keep the best one and take it to the next level.
      </p>

      {!isAuthenticated && (
        <EmptyState
          title="Sign in to see your attempts"
          description="Calibration outputs are private to the account that made them."
        />
      )}

      {error && (
        <p className="calibrate-error" role="alert">
          {error}
        </p>
      )}

      {isAuthenticated && items === null && !error && <p role="status">Loading your library…</p>}

      {isAuthenticated && items !== null && groups.length === 0 && !error && (
        <EmptyState
          title="Nothing to compare yet"
          description="Run the same data a second time with different settings and both results will appear here."
        />
      )}

      {groups.map((group) => (
        <AttemptGroupSection
          key={`${group.observationBaseId}-${group.level}`}
          group={group}
          onContinue={continueWith}
        />
      ))}
    </div>
  );
}
