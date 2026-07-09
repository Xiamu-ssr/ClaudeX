import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { applyLine, createTurnAccumulator, type ClaudeStdoutLine } from '../src/shared/eventTranslator';
import { NdjsonLineSplitter } from '../src/shared/ndjson';
import type { ToolUseStep } from '../src/shared/chat';
import { groupSteps } from '../src/shared/groupSteps';

function loadFixtureLines(name: string): ClaudeStdoutLine[] {
  const file = readFileSync(path.join(__dirname, 'fixtures/stream-json', name), 'utf8');
  return file
    .split('\n')
    .filter((l) => l.trim().length > 0)
    .map((l) => JSON.parse(l));
}

test('simple text turn: response resolves to final result text', () => {
  const lines = loadFixtureLines('simple-text-turn.jsonl');
  const acc = createTurnAccumulator(0);
  let finalResponse = '';
  let processingTime = -1;

  for (const line of lines) {
    const { turnComplete } = applyLine(acc, line);
    if (turnComplete) {
      processingTime = turnComplete.processingTime;
      finalResponse = turnComplete.response;
    }
  }

  expect(finalResponse).toBe('4');
  expect(processingTime).toBe(6); // duration_ms 6437 -> round(6.437) = 6
  expect(acc.steps).toHaveLength(1);
  expect(acc.steps[0]).toMatchObject({ type: 'thinking', text: '4' });
});

test('result line with is_error:true propagates isError into turnComplete', () => {
  const acc = createTurnAccumulator(0);
  const { turnComplete } = applyLine(acc, {
    type: 'result',
    subtype: 'success',
    is_error: true,
    duration_ms: 1200,
    result: 'API Error: 400 This model does not support the effort parameter.',
  });

  expect(turnComplete).toBeDefined();
  expect(turnComplete?.isError).toBe(true);
  expect(turnComplete?.response).toBe('API Error: 400 This model does not support the effort parameter.');
});

test('result line without is_error defaults isError to false', () => {
  const acc = createTurnAccumulator(0);
  const { turnComplete } = applyLine(acc, {
    type: 'result',
    subtype: 'success',
    duration_ms: 500,
    result: 'ok',
  });

  expect(turnComplete?.isError).toBe(false);
});

test('tool call turn: thinking block dropped, tool_use tracked pending then resolved', () => {
  const lines = loadFixtureLines('tool-call-turn.jsonl');
  const acc = createTurnAccumulator(0);
  let finalResponse = '';
  let processingTime = -1;

  for (const line of lines) {
    const { turnComplete } = applyLine(acc, line);
    if (turnComplete) {
      processingTime = turnComplete.processingTime;
      finalResponse = turnComplete.response;
    }
  }

  expect(finalResponse).toBe('Output: `hello-from-tool-probe`');
  expect(processingTime).toBe(13); // duration_ms 13358 -> round(13.358) = 13

  // real API 'thinking' content blocks must be dropped, never rendered as steps
  const stepTypes = acc.steps.map((s) => s.type);
  expect(stepTypes).toEqual(['tool_use', 'thinking']); // tool_use step, then final answer as ThinkingStep

  const toolStep = acc.steps[0] as ToolUseStep;
  expect(toolStep.toolName).toBe('Bash');
  expect(toolStep.pending).toBe(false); // resolved once tool_result arrived
  expect(toolStep.isError).toBe(false);
  expect(toolStep.details).toEqual(['hello-from-tool-probe']);
  expect(toolStep.summary).toContain('echo hello-from-tool-probe');
});

test('assistant line with empty content array is a no-op', () => {
  const acc = createTurnAccumulator(0);
  const { deltas } = applyLine(acc, {
    type: 'assistant',
    message: { content: [] },
  });
  expect(deltas).toEqual([]);
  expect(acc.steps).toHaveLength(0);
});

test('unrecognized line types (system/*, stream_event, future types) are no-ops', () => {
  const acc = createTurnAccumulator(0);
  for (const line of [
    { type: 'system', subtype: 'init' },
    { type: 'system', subtype: 'thinking_tokens' },
    { type: 'stream_event', event: {} },
    { type: 'queue-operation' },
    { type: 'something-a-future-cli-version-invents' },
  ]) {
    const { deltas, turnComplete } = applyLine(acc, line);
    expect(deltas).toEqual([]);
    expect(turnComplete).toBeUndefined();
  }
  expect(acc.steps).toHaveLength(0);
});

test('tool_result with no matching pending tool_use is skipped defensively, does not throw', () => {
  const acc = createTurnAccumulator(0);
  expect(() =>
    applyLine(acc, {
      type: 'user',
      message: {
        content: [{ type: 'tool_result', tool_use_id: 'does-not-exist', content: 'orphaned', is_error: false }],
      },
    })
  ).not.toThrow();
  expect(acc.steps).toHaveLength(0);
});

test('NdjsonLineSplitter: reassembles lines split across arbitrary chunk boundaries', () => {
  const raw = readFileSync(path.join(__dirname, 'fixtures/stream-json/tool-call-turn.jsonl'), 'utf8');
  const expectedLines = raw.split('\n').filter((l) => l.trim().length > 0);

  // Split the raw text at arbitrary byte offsets that do NOT align with '\n' boundaries,
  // simulating real Node 'data' event chunking.
  const chunkSizes = [7, 1, 250, 13, 4096, 2, 900];
  const chunks: string[] = [];
  let offset = 0;
  let sizeIdx = 0;
  while (offset < raw.length) {
    const size = chunkSizes[sizeIdx % chunkSizes.length];
    chunks.push(raw.slice(offset, offset + size));
    offset += size;
    sizeIdx++;
  }
  expect(chunks.join('')).toBe(raw); // sanity check the chunking itself is lossless

  const splitter = new NdjsonLineSplitter();
  const collected: string[] = [];
  for (const chunk of chunks) {
    collected.push(...splitter.push(chunk));
  }

  expect(collected).toEqual(expectedLines);
  // every collected line must be valid, parseable JSON — proves no line was truncated mid-JSON
  for (const line of collected) {
    expect(() => JSON.parse(line)).not.toThrow();
  }
});

test('full pipeline: chunk-split raw bytes -> NdjsonLineSplitter -> applyLine produces the same result as pre-split lines', () => {
  const raw = readFileSync(path.join(__dirname, 'fixtures/stream-json/tool-call-turn.jsonl'), 'utf8');
  const splitter = new NdjsonLineSplitter();
  const acc = createTurnAccumulator(0);
  let finalResponse = '';

  // Feed byte-by-byte — the most adversarial possible chunking.
  for (const char of raw) {
    for (const line of splitter.push(char)) {
      const { turnComplete } = applyLine(acc, JSON.parse(line));
      if (turnComplete) finalResponse = turnComplete.response;
    }
  }

  expect(finalResponse).toBe('Output: `hello-from-tool-probe`');
});

test('tool_use input is threaded through to ToolUseStep for Edit/Write rich rendering', () => {
  const acc = createTurnAccumulator(0);
  applyLine(acc, {
    type: 'assistant',
    message: {
      role: 'assistant',
      content: [
        {
          type: 'tool_use',
          id: 'toolu_edit1',
          name: 'Edit',
          input: { file_path: '/proj/src/foo.ts', old_string: 'a\nb', new_string: 'a\nb\nc' },
        },
      ],
    },
  });

  const step = acc.steps[0] as ToolUseStep;
  expect(step.type).toBe('tool_use');
  expect(step.toolName).toBe('Edit');
  expect(step.input).toEqual({ file_path: '/proj/src/foo.ts', old_string: 'a\nb', new_string: 'a\nb\nc' });
});

test('groupSteps merges consecutive Edit/Write steps and breaks around non-file tools', () => {
  // Build a realistic sequence: Edit, Write (consecutive -> one group), Bash (breaks),
  // Edit (starts a new group).
  const acc = createTurnAccumulator(0);
  const lines: ClaudeStdoutLine[] = [
    {
      type: 'assistant',
      message: {
        role: 'assistant',
        content: [
          { type: 'tool_use', id: 'toolu_1', name: 'Edit', input: { file_path: 'src/foo.ts', old_string: 'a\nb', new_string: 'a\nb\nc' } },
        ],
      },
    },
    {
      type: 'assistant',
      message: {
        role: 'assistant',
        content: [
          { type: 'tool_use', id: 'toolu_2', name: 'Write', input: { file_path: 'src/bar.ts', content: 'hello\nworld' } },
        ],
      },
    },
    {
      type: 'assistant',
      message: {
        role: 'assistant',
        content: [
          { type: 'tool_use', id: 'toolu_3', name: 'Bash', input: { command: 'echo hello' } },
        ],
      },
    },
    {
      type: 'assistant',
      message: {
        role: 'assistant',
        content: [
          { type: 'tool_use', id: 'toolu_4', name: 'Edit', input: { file_path: 'src/baz.ts', old_string: 'x', new_string: 'y' } },
        ],
      },
    },
  ];

  for (const line of lines) {
    applyLine(acc, line);
  }

  // 4 steps total: Edit, Write, Bash, Edit
  expect(acc.steps).toHaveLength(4);
  expect(acc.steps.map((s) => (s as ToolUseStep).toolName)).toEqual(['Edit', 'Write', 'Bash', 'Edit']);

  // Verify input is threaded through for each step
  const editStep = acc.steps[0] as ToolUseStep;
  expect(editStep.input).toEqual({ file_path: 'src/foo.ts', old_string: 'a\nb', new_string: 'a\nb\nc' });
  const bashStep = acc.steps[2] as ToolUseStep;
  expect(bashStep.input).toEqual({ command: 'echo hello' });

  // Grouping: [Edit, Write] -> one file-edits group, [Bash] -> single, [Edit] -> one file-edits group
  const groups = groupSteps(acc.steps);
  expect(groups).toHaveLength(3);

  expect(groups[0].kind).toBe('file-edits');
  if (groups[0].kind === 'file-edits') {
    expect(groups[0].steps).toHaveLength(2);
    expect(groups[0].steps.map((s) => s.toolName)).toEqual(['Edit', 'Write']);
  }

  expect(groups[1].kind).toBe('single');

  expect(groups[2].kind).toBe('file-edits');
  if (groups[2].kind === 'file-edits') {
    expect(groups[2].steps).toHaveLength(1);
    expect(groups[2].steps[0].toolName).toBe('Edit');
  }
});
