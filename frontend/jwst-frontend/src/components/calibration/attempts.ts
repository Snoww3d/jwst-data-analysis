/**
 * Grouping calibration attempts so they can be compared (#1758).
 *
 * The loop this serves: run a level several ways with different settings, look
 * at the results, keep the best, and feed that one into the next step. That
 * needs the attempts at a level to be visible AS a set, each labelled with what
 * produced it — otherwise they are scattered through the library among
 * everything else, identically named, and telling them apart means guessing.
 *
 * Everything here reads what the engine records on a saved output (#1754):
 * `processingLevel`, `derivedFrom`, and `metadata.run_overrides`.
 */

import { levelOf, type OrderedLevel } from './processingLevels';
import type { JwstDataModel } from '../../types/JwstDataTypes';

export interface Attempt {
  item: JwstDataModel;
  /** Settings that produced this one, flattened for display. */
  settings: { step: string; param: string; value: string }[];
  /** True when the run demonstrably used the recipe's own values. */
  isDefaults: boolean;
  /**
   * True when the run predates settings being recorded (#1754). Distinct from
   * `isDefaults`: presenting "not recorded" as a deliberate defaults run would
   * invent a difference against a tweaked sibling.
   */
  settingsUnknown: boolean;
  createdAt: string;
}

export interface AttemptGroup {
  /** The observation these attempts belong to. */
  observationBaseId: string;
  level: OrderedLevel;
  /** Newest first — the most recent try is the one you are reasoning about. */
  attempts: Attempt[];
}

function settingsOf(item: JwstDataModel): Attempt['settings'] {
  const overrides = (item.metadata?.run_overrides ?? {}) as Record<string, unknown>;
  const rows: Attempt['settings'] = [];
  for (const [step, params] of Object.entries(overrides)) {
    if (!params || typeof params !== 'object') continue;
    for (const [param, value] of Object.entries(params as Record<string, unknown>)) {
      rows.push({ step, param, value: JSON.stringify(value) });
    }
  }
  return rows.sort((a, b) => `${a.step}.${a.param}`.localeCompare(`${b.step}.${b.param}`));
}

/** Whether this item is something a calibration run produced. */
export function isCalibrationOutput(item: JwstDataModel): boolean {
  return item.metadata?.source === 'calibration' || (item.tags ?? []).includes('calibration');
}

/**
 * Calibration outputs grouped by observation and level.
 *
 * Only outputs: a group of "attempts" that includes the archive's own file
 * would invite comparing your run against something no run produced. Items
 * without an observation or a level cannot be placed in a comparison and are
 * left out rather than pooled into a meaningless group.
 */
export function groupAttempts(items: JwstDataModel[]): AttemptGroup[] {
  const groups = new Map<string, AttemptGroup>();
  for (const item of items) {
    if (!isCalibrationOutput(item)) continue;
    const level = levelOf(item);
    const observationBaseId = item.observationBaseId;
    if (!level || !observationBaseId) continue;
    const key = `${observationBaseId}::${level}`;
    let group = groups.get(key);
    if (!group) {
      group = { observationBaseId, level, attempts: [] };
      groups.set(key, group);
    }
    const settings = settingsOf(item);
    const recorded = item.metadata?.run_overrides !== undefined;
    group.attempts.push({
      item,
      settings,
      isDefaults: recorded && settings.length === 0,
      settingsUnknown: !recorded,
      createdAt: item.uploadDate,
    });
  }
  for (const group of groups.values()) {
    group.attempts.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }
  return [...groups.values()].sort(
    (a, b) =>
      a.observationBaseId.localeCompare(b.observationBaseId) || a.level.localeCompare(b.level)
  );
}

/**
 * Which settings actually differ across a group.
 *
 * Comparing means looking at what changed. Showing every parameter on every
 * attempt buries the one that differs; showing only the differences is the
 * whole point of putting them side by side.
 */
export function differingParams(group: AttemptGroup): string[] {
  const seen = new Map<string, Set<string>>();
  for (const attempt of group.attempts) {
    const byKey = new Map(attempt.settings.map((s) => [`${s.step}.${s.param}`, s.value]));
    const keys = new Set([...seen.keys(), ...byKey.keys()]);
    for (const key of keys) {
      // Absent counts as a distinct value: "not set" versus "set to X" is a
      // real difference between two runs.
      const value = byKey.get(key) ?? '(recipe default)';
      const values = seen.get(key) ?? new Set<string>();
      values.add(value);
      seen.set(key, values);
    }
  }
  // A param only present on some attempts has an implicit default on the rest,
  // which the loop above recorded, so a size of 1 genuinely means "the same".
  return [...seen.entries()]
    .filter(([, values]) => values.size > 1)
    .map(([key]) => key)
    .sort();
}

/** Groups that have something to compare. One attempt is not a comparison. */
export function comparableGroups(groups: AttemptGroup[]): AttemptGroup[] {
  return groups.filter((g) => g.attempts.length > 1);
}
