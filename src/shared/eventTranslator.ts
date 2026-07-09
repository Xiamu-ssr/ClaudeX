import type { Step, ThinkingStep, ToolUseStep } from './chat';

export interface AnthropicContentBlock {
  type: string;
  text?: string;
  thinking?: string;
  id?: string;
  name?: string;
  input?: unknown;
  tool_use_id?: string;
  content?: unknown;
  is_error?: boolean;
  source?: { type: string; media_type: string; data: string };
  [key: string]: unknown;
}

export interface ClaudeStdoutLine {
  type: string;
  subtype?: string;
  message?: { content?: AnthropicContentBlock[] | string };
  result?: string;
  is_error?: boolean;
  duration_ms?: number;
  session_id?: string;
  [key: string]: unknown;
}

export interface TurnAccumulator {
  steps: Step[];
  lastTextSeen: string | null;
  startedAt: number;
}

export function createTurnAccumulator(startedAt: number = Date.now()): TurnAccumulator {
  return { steps: [], lastTextSeen: null, startedAt };
}

export type TurnDelta =
  | { kind: 'step-appended'; step: Step }
  | { kind: 'step-updated'; index: number; step: Step }
  | { kind: 'response-updated'; response: string };

export interface ApplyLineResult {
  deltas: TurnDelta[];
  turnComplete?: { processingTime: number; response: string; isError?: boolean };
}

export function applyLine(acc: TurnAccumulator, line: ClaudeStdoutLine): ApplyLineResult {
  const deltas: TurnDelta[] = [];

  switch (line.type) {
    case 'assistant': {
      const content = line.message?.content;
      if (!Array.isArray(content) || content.length === 0) return { deltas };

      for (const block of content) {
        if (block.type === 'text' && typeof block.text === 'string') {
          const step: ThinkingStep = { type: 'thinking', text: block.text };
          acc.steps.push(step);
          acc.lastTextSeen = block.text;
          deltas.push({ kind: 'step-appended', step });
          deltas.push({ kind: 'response-updated', response: block.text });
        } else if (block.type === 'tool_use') {
          const name = typeof block.name === 'string' ? block.name : undefined;
          const step: ToolUseStep = {
            type: 'tool_use',
            summary: deriveToolSummary(name, block.input),
            details: [],
            toolUseId: block.id,
            toolName: name,
            pending: true,
            input: block.input,
          };
          acc.steps.push(step);
          deltas.push({ kind: 'step-appended', step });
        }
        // 'thinking' blocks (real extended-thinking) are intentionally dropped — not user-facing.
      }
      return { deltas };
    }

    case 'user': {
      const content = line.message?.content;
      if (!Array.isArray(content)) return { deltas };

      for (const block of content) {
        if (block.type === 'tool_result') {
          const idx = findPendingToolStepIndex(acc.steps, block.tool_use_id);
          if (idx === -1) continue;
          const prev = acc.steps[idx] as ToolUseStep;
          const updated: ToolUseStep = {
            ...prev,
            pending: false,
            isError: Boolean(block.is_error),
            details: [stringifyToolResultContent(block.content)],
          };
          acc.steps[idx] = updated;
          deltas.push({ kind: 'step-updated', index: idx, step: updated });
        }
      }
      return { deltas };
    }

    case 'result': {
      const resultText = typeof line.result === 'string' && line.result.length > 0 ? line.result : (acc.lastTextSeen ?? '');
      const durationMs = typeof line.duration_ms === 'number' ? line.duration_ms : Date.now() - acc.startedAt;
      const processingTime = Math.round(durationMs / 1000);
      const isError = line.is_error === true;
      deltas.push({ kind: 'response-updated', response: resultText });
      return { deltas, turnComplete: { processingTime, response: resultText, isError } };
    }

    default:
      // system/*, stream_event, and any unrecognized future line types: no-op for MVP.
      return { deltas };
  }
}

function findPendingToolStepIndex(steps: Step[], toolUseId: string | undefined): number {
  if (!toolUseId) return -1;
  for (let i = steps.length - 1; i >= 0; i--) {
    const s = steps[i];
    if (s.type === 'tool_use' && s.toolUseId === toolUseId) return i;
  }
  return -1;
}

function stringifyToolResultContent(content: unknown): string {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .map((c) => (typeof c === 'string' ? c : ((c as { text?: string })?.text ?? JSON.stringify(c))))
      .join('\n');
  }
  if (content == null) return '';
  return JSON.stringify(content);
}

function deriveToolSummary(name: string | undefined, input: unknown): string {
  const n = name ?? '工具';
  const i = (input ?? {}) as Record<string, unknown>;
  switch (n) {
    case 'Bash':
      return typeof i.command === 'string'
        ? `运行 ${i.command}`
        : typeof i.description === 'string'
          ? `运行 ${i.description}`
          : '运行命令';
    case 'Read':
      return `读取 ${typeof i.file_path === 'string' ? i.file_path : '文件'}`;
    case 'Write':
      return `写入 ${typeof i.file_path === 'string' ? i.file_path : '文件'}`;
    case 'Edit':
      return `编辑 ${typeof i.file_path === 'string' ? i.file_path : '文件'}`;
    default:
      return `调用 ${n}`;
  }
}
