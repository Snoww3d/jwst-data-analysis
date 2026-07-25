/**
 * Data-first entry: grouping library files and matching recipes to them (#1738).
 *
 * The old flow was recipe-first — a gallery of 3 recipes at /calibrate, and
 * inputs chosen afterwards from a flat checkbox list of raw paths matched by
 * `path.includes('_cal')`. That answers "what recipes exist?", which is not a
 * question people ask: they arrive holding data.
 *
 * Pure functions so the grouping and matching rules are testable without a DOM.
 */

import type { JwstDataModel } from '../../types/JwstDataTypes';
import type { CalibrationRecipe } from '../../types/CalibrationTypes';

const SUFFIXES = ['_uncal', '_rate', '_cal', '_i2d'];

export interface DataGroup {
  /** Target name where known, else the observation id, else a catch-all. */
  key: string;
  label: string;
  items: JwstDataModel[];
  filters: string[];
  instruments: string[];
  totalBytes: number;
}

export function suffixOf(item: JwstDataModel): string | null {
  // fileName only: the library DTO never publishes a path (#1751).
  const path = item.fileName ?? '';
  return SUFFIXES.find((s) => path.includes(s)) ?? null;
}

function metaString(item: JwstDataModel, key: string): string | null {
  const value = item.metadata?.[key];
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : null;
}

/** Split a MAST filters string ("F090W;F187N") into individual filters. */
function filtersOf(item: JwstDataModel): string[] {
  const raw = metaString(item, 'mast_filters');
  if (!raw) return [];
  return raw
    .split(/[;,/]/)
    .map((f) => f.trim().toUpperCase())
    .filter(Boolean);
}

export function instrumentOf(item: JwstDataModel): string | null {
  // e.g. "MIRI/IMAGE" -> "MIRI"
  const raw = metaString(item, 'mast_instrument_name');
  return raw ? raw.split('/')[0].trim().toUpperCase() : null;
}

/**
 * Group by target so files present as recognisable objects rather than paths.
 * Falls back to the observation id, then a single catch-all group — a library
 * of hand-uploaded files still has to be usable.
 */
export function groupByTarget(items: JwstDataModel[]): DataGroup[] {
  const groups = new Map<string, DataGroup>();
  for (const item of items) {
    const target = metaString(item, 'mast_target_name');
    const key = target ?? item.observationBaseId ?? 'ungrouped';
    const label = target ?? item.observationBaseId ?? 'Other files';
    let group = groups.get(key);
    if (!group) {
      group = { key, label, items: [], filters: [], instruments: [], totalBytes: 0 };
      groups.set(key, group);
    }
    group.items.push(item);
    group.totalBytes += item.fileSize ?? 0;
    for (const f of filtersOf(item)) if (!group.filters.includes(f)) group.filters.push(f);
    const inst = instrumentOf(item);
    if (inst && !group.instruments.includes(inst)) group.instruments.push(inst);
  }
  // Named targets first, then observation ids, catch-all last.
  return Array.from(groups.values()).sort((a, b) => {
    if (a.key === 'ungrouped') return 1;
    if (b.key === 'ungrouped') return -1;
    return a.label.localeCompare(b.label);
  });
}

export interface RecipeFit {
  recipe: CalibrationRecipe;
  /** False when the recipe's instrument cannot process the selection. */
  applicable: boolean;
  reason: string | null;
}

/**
 * Whether a recipe can process the selected files.
 *
 * Only the instrument is treated as disqualifying — it is a hard mismatch.
 * Product suffixes decide which STAGES can run, which the timeline (#1736)
 * already communicates, so they must not hide an otherwise-valid recipe.
 */
export function fitRecipes(recipes: CalibrationRecipe[], selected: JwstDataModel[]): RecipeFit[] {
  const instruments = Array.from(
    new Set(selected.map(instrumentOf).filter((i): i is string => Boolean(i)))
  );
  return recipes
    .map((recipe) => {
      if (instruments.length === 0) return { recipe, applicable: true, reason: null };
      const match = instruments.some((i) => i === recipe.instrument.toUpperCase());
      return {
        recipe,
        applicable: match,
        reason: match
          ? null
          : `for ${recipe.instrument.toUpperCase()}, your data is ${instruments.join(', ')}`,
      };
    })
    .sort((a, b) => Number(b.applicable) - Number(a.applicable));
}

export function formatBytes(bytes: number): string {
  if (!bytes) return '—';
  const gb = bytes / 1024 ** 3;
  if (gb >= 1) return `${gb.toFixed(1)} GB`;
  return `${Math.max(1, Math.round(bytes / 1024 ** 2))} MB`;
}

/**
 * Library ids to reprocess when the user hits Reprocess on one exposure: the
 * whole observation's calibrated set, so stage 3 has something to mosaic.
 *
 * Falls back to the clicked item alone when it has no siblings. Deliberately
 * matches on fileName — the DTO publishes no path (#1751), and an earlier
 * `filePath` predicate here silently reduced every reprocess to a single frame.
 */
export function reprocessInputIds(data: JwstDataModel[], item: JwstDataModel): string[] {
  const siblings = data.filter(
    (d) =>
      d.observationBaseId !== undefined &&
      d.observationBaseId === item.observationBaseId &&
      d.fileName.includes('_cal')
  );
  return (siblings.length > 0 ? siblings : [item]).map((d) => d.id);
}
