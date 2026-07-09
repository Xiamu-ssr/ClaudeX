import type { Step, ToolUseStep } from './chat';

export type StepGroup = { kind: 'file-edits'; steps: ToolUseStep[] } | { kind: 'single'; step: Step };

export function groupSteps(steps: Step[]): StepGroup[] {
  const groups: StepGroup[] = [];
  for (const step of steps) {
    const isFileEdit = step.type === 'tool_use' && (step.toolName === 'Edit' || step.toolName === 'Write');
    const last = groups[groups.length - 1];
    if (isFileEdit && last?.kind === 'file-edits') {
      last.steps.push(step);
    } else if (isFileEdit) {
      groups.push({ kind: 'file-edits', steps: [step] });
    } else {
      groups.push({ kind: 'single', step });
    }
  }
  return groups;
}
