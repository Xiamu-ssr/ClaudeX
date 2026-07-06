import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { applyLine, createTurnAccumulator, type ClaudeStdoutLine } from '../src/shared/eventTranslator';
import { NdjsonLineSplitter } from '../src/shared/ndjson';
import type { ToolUseStep } from '../src/shared/chat';

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
