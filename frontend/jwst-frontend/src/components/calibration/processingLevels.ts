/**
 * What a library file can be advanced to, and what that costs (#1756).
 *
 * The library already labels every file L1/L2a/L2b/L3, but nothing connected
 * those labels to the calibration pipeline — which is the whole story of the
 * feature. A run does not "enable image2"; it raises a file from one level to
 * the next:
 *
 *   L1 (_uncal, raw) --Detector1--> L2a (_rate)
 *   L2a             --Image2----->  L2b (_cal)
 *   L2b             --Image3----->  L3  (_i2d, a combined mosaic)
 *
 * Pure functions over a level so they can be tested directly rather than
 * through the DOM, and so the card, the run page and the library agree on what
 * is possible for a given file.
 */

import { ProcessingLevels, type JwstDataModel } from '../../types/JwstDataTypes';

/** Ascending. `unknown` is deliberately absent: it has no position. */
export const LEVEL_ORDER = [
  ProcessingLevels.L1,
  ProcessingLevels.L2a,
  ProcessingLevels.L2b,
  ProcessingLevels.L3,
] as const;

export type OrderedLevel = (typeof LEVEL_ORDER)[number];

/** Which stage raises a file OUT of each level. Mirrors stagePipeline.ts. */
const STAGE_OUT_OF: Record<OrderedLevel, string | null> = {
  L1: 'detector1',
  L2a: 'image2',
  L2b: 'image3',
  L3: null,
};

/**
 * Suffix -> level. The authority is the .NET pair
 * `ProcessingLevels.SuffixToLevel` (JwstDataModel.cs) and the longer chain in
 * `DataScanService.ParseFileInfo`; this is their union, so a file gets the
 * same level here that the scanner gave it on import.
 *
 * Longest first only matters for a tie under `endsWith`; today every long/short
 * pair maps to the same level, so ordering has no behavioural effect. It is
 * kept so adding a pair that DOES differ cannot silently take the short one.
 */
const SUFFIX_TO_LEVEL: [string, OrderedLevel][] = [
  ['_rateints', 'L2a'],
  ['_calints', 'L2b'],
  ['_x1dints', 'L3'],
  ['_uncal', 'L1'],
  ['_rate', 'L2a'],
  ['_cal', 'L2b'],
  ['_crf', 'L2b'],
  ['_i2d', 'L3'],
  ['_s2d', 'L3'],
  ['_x1d', 'L3'],
  ['_cat', 'L3'],
];

/**
 * The product suffixes that ARE each level — what to browse for that level.
 * Derived from SUFFIX_TO_LEVEL rather than hand-maintained: two tables that
 * must agree and don't is how a level ends up browsable but unclassifiable.
 */
export const SUFFIXES_FOR_LEVEL: Record<OrderedLevel, string[]> = LEVEL_ORDER.reduce(
  (acc, level) => {
    acc[level] = SUFFIX_TO_LEVEL.filter(([, l]) => l === level).map(([suffix]) => suffix);
    return acc;
  },
  {} as Record<OrderedLevel, string[]>
);

/**
 * The one suffix that REPRESENTS each level. Used wherever a level has to be
 * expressed as a suffix for `stagePipeline.blockedReason`, which understands
 * only these four — handing it `_calints` would fall through to "assume raw"
 * and report Detector1 as runnable on calibrated data.
 */
export const CANONICAL_SUFFIX: Record<OrderedLevel, string> = {
  L1: '_uncal',
  L2a: '_rate',
  L2b: '_cal',
  L3: '_i2d',
};

/** Whether a value from router state is a level we can actually order by. */
export function isOrderedLevel(value: unknown): value is OrderedLevel {
  return typeof value === 'string' && (LEVEL_ORDER as readonly string[]).includes(value);
}

/** Level from the filename, matching the END of the stem (mirrors the engine). */
export function levelFromFileName(fileName: string | undefined): OrderedLevel | null {
  if (!fileName) return null;
  const stem = fileName.toLowerCase().replace(/\.[^.]+$/, '');
  const hit = SUFFIX_TO_LEVEL.find(([suffix]) => stem.endsWith(suffix));
  return hit ? hit[1] : null;
}

/**
 * The file's level: the stored label when it is one we can order by,
 * otherwise read off the filename. Records predating the level backfill have
 * no `processingLevel`, and every calibration output saved before #1754 has
 * none either — falling back keeps those usable instead of stranded.
 */
export function levelOf(
  item: Pick<JwstDataModel, 'fileName' | 'processingLevel'>
): OrderedLevel | null {
  const stored = item.processingLevel as OrderedLevel | undefined;
  if (stored && (LEVEL_ORDER as readonly string[]).includes(stored)) return stored;
  return levelFromFileName(item.fileName);
}

/** The stages needed to get from `from` up to `to`, in pipeline order. */
export function stagesBetween(from: OrderedLevel, to: OrderedLevel): string[] {
  const start = LEVEL_ORDER.indexOf(from);
  const end = LEVEL_ORDER.indexOf(to);
  if (start < 0 || end < 0 || end <= start) return [];
  return LEVEL_ORDER.slice(start, end)
    .map((level) => STAGE_OUT_OF[level])
    .filter((stage): stage is string => stage !== null);
}

/** Every level a file could be advanced to, nearest first. */
export function reachableLevels(from: OrderedLevel): OrderedLevel[] {
  return LEVEL_ORDER.slice(LEVEL_ORDER.indexOf(from) + 1);
}

export interface AdvanceAction {
  /** Button text, naming the outcome rather than the pipeline stage. */
  label: string;
  fromLevel: OrderedLevel;
  /** Where it goes by default — always the top, per "take a raw 1 to level 3". */
  targetLevel: OrderedLevel;
  stages: string[];
}

/**
 * What to offer on a library file, or null when there is nothing to offer.
 *
 * Null means genuinely nothing to do — an L3 mosaic is finished, and a file
 * whose level we cannot determine has no known next step. Both cases deserve
 * an explanation rather than a hidden button, which is the caller's job.
 */
export function advanceActionFor(
  item: Pick<JwstDataModel, 'fileName' | 'processingLevel'>
): AdvanceAction | null {
  const fromLevel = levelOf(item);
  if (!fromLevel || fromLevel === ProcessingLevels.L3) return null;
  const targetLevel = ProcessingLevels.L3 as OrderedLevel;
  return {
    // "Combine" for the last hop because that is what Image3 does — it
    // mosaics several exposures into one image, which is a different promise
    // from calibrating one file.
    label: fromLevel === ProcessingLevels.L2b ? 'Combine to L3' : 'Process to L3',
    fromLevel,
    targetLevel,
    stages: stagesBetween(fromLevel, targetLevel),
  };
}

/** Why there is no action, for the cases where that needs saying. */
export function noActionReason(
  item: Pick<JwstDataModel, 'fileName' | 'processingLevel'>
): string | null {
  const level = levelOf(item);
  if (level === ProcessingLevels.L3) return 'Already fully processed (Level 3)';
  if (!level) return "This file's processing level is unknown, so there is no next step";
  return null;
}
