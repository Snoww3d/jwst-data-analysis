import type { FileProgressInfo } from '../../types/MastTypes';

// Helper function to format bytes as human-readable string
export const formatBytes = (bytes: number): string => {
  if (bytes === 0) return '0 B';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
};

// Helper function to format ETA
export const formatEta = (seconds: number | undefined | null): string => {
  if (!seconds || seconds <= 0) return '--:--';
  if (seconds < 60) return `${Math.round(seconds)}s`;
  if (seconds < 3600) {
    const mins = Math.floor(seconds / 60);
    const secs = Math.round(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  }
  const hours = Math.floor(seconds / 3600);
  const mins = Math.floor((seconds % 3600) / 60);
  return `${hours}h ${mins}m`;
};

// Find the longest common prefix across all strings.
export const getCommonPrefix = (strings: string[]): string => {
  if (strings.length <= 1) return '';
  let prefix = strings[0];
  for (const s of strings) {
    while (prefix && !s.startsWith(prefix)) {
      prefix = prefix.slice(0, -1);
    }
    if (!prefix) return '';
  }
  return prefix;
};

// Longest common prefix of exactly two strings.
export const lcpOfTwo = (a: string, b: string): string => {
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i++;
  return a.slice(0, i);
};

// A cluster of files sharing a sub-prefix within the tree.
export interface FileGroup {
  subPrefix: string;
  items: Array<{ displayName: string; fp: FileProgressInfo }>;
}

// After extracting the global common prefix, cluster suffixes that share a
// further sub-prefix (≥ MIN_SUB chars) so we can fold it into a sub-node.
const MIN_SUB = 8;

export const groupFilesBySuffix = (
  fileProgress: FileProgressInfo[],
  globalPrefix: string
): FileGroup[] => {
  const entries = fileProgress.map((fp) => ({
    suffix: fp.filename.slice(globalPrefix.length),
    fp,
  }));

  if (entries.length <= 1) {
    return entries.map((e) => ({
      subPrefix: '',
      items: [{ displayName: e.suffix || e.fp.filename, fp: e.fp }],
    }));
  }

  const sorted = [...entries].sort((a, b) => a.suffix.localeCompare(b.suffix));

  const groups: FileGroup[] = [];
  let current = [sorted[0]];
  let groupLcp = sorted[0].suffix;

  for (let i = 1; i < sorted.length; i++) {
    const newLcp = lcpOfTwo(groupLcp, sorted[i].suffix);
    if (newLcp.length >= MIN_SUB) {
      groupLcp = newLcp;
      current.push(sorted[i]);
    } else {
      groups.push(buildFileGroup(current));
      current = [sorted[i]];
      groupLcp = sorted[i].suffix;
    }
  }
  groups.push(buildFileGroup(current));
  return groups;
};

export const buildFileGroup = (
  entries: Array<{ suffix: string; fp: FileProgressInfo }>
): FileGroup => {
  if (entries.length <= 1) {
    return {
      subPrefix: '',
      items: entries.map((e) => ({
        displayName: e.suffix || e.fp.filename,
        fp: e.fp,
      })),
    };
  }
  const prefix = getCommonPrefix(entries.map((e) => e.suffix));
  return {
    subPrefix: prefix,
    items: entries.map((e) => ({
      displayName: e.suffix.slice(prefix.length) || e.suffix,
      fp: e.fp,
    })),
  };
};

// Summarise a group's progress for the collapsed view, e.g. "3/6 ✓  1 ↓"
export const summariseGroup = (items: Array<{ fp: FileProgressInfo }>): string => {
  const total = items.length;
  const done = items.filter((i) => i.fp.status === 'complete').length;
  const downloading = items.filter((i) => i.fp.status === 'downloading').length;
  const failed = items.filter((i) => i.fp.status === 'failed').length;
  const parts: string[] = [];
  if (done > 0) parts.push(`${done}/${total} ✓`);
  if (downloading > 0) parts.push(`${downloading} ↓`);
  if (failed > 0) parts.push(`${failed} ✗`);
  if (parts.length === 0) parts.push(`0/${total}`);
  return parts.join('  ');
};
