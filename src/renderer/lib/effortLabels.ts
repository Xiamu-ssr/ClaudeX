import type { EffortLevel } from '../../shared/ipc';

export const EFFORT_LEVELS: EffortLevel[] = ['low', 'medium', 'high', 'xhigh', 'max'];

export const EFFORT_LEVEL_LABELS: Record<EffortLevel, string> = {
  low: '低',
  medium: '中',
  high: '高',
  xhigh: '超高',
  max: '最高',
};

// null means "don't pass --effort at all", i.e. defer to the CLI's own default.
export const EFFORT_DEFAULT_LABEL = 'CLI 默认';

export function effortLabel(level: EffortLevel | null): string {
  return level ? EFFORT_LEVEL_LABELS[level] : EFFORT_DEFAULT_LABEL;
}
