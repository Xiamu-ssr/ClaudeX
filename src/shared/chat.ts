export interface ToolUseStep {
  type: 'tool_use';
  summary: string;
  details: string[];
  toolUseId?: string;
  toolName?: string;
  isError?: boolean;
  pending?: boolean;
  // Raw tool input, used by rich per-tool-type rendering (Edit/Write file-diff rows) —
  // kept as `unknown` and narrowed per toolName at render time, since different tools have
  // completely different input shapes and this project never fabricates a shared shape for them.
  input?: unknown;
}

export interface ThinkingStep {
  type: 'thinking';
  text: string;
}

export type Step = ToolUseStep | ThinkingStep;

export interface FileAttachment {
  name: string;
  fileType: string;
}

// For user-provided upload previews (images attached to an outgoing message) — distinct from
// FileAttachment above, which is for assistant-produced files.
export interface MessageAttachment {
  name: string;
  mimeType: string;
  dataUrl: string;
}

export interface AssistantTurn {
  processingTime: number;
  steps: Step[];
  response: string;
  files?: FileAttachment[];
  isProcessing?: boolean;
  isError?: boolean;
  // Only set for in-flight turns created this session, not historical ones loaded from transcripts.
  startedAt?: number;
}

export interface UserMessage {
  role: 'user';
  content: string;
  attachments?: MessageAttachment[];
}

export interface AssistantMessage {
  role: 'assistant';
  turn: AssistantTurn;
}

export type ChatMessage = UserMessage | AssistantMessage;

export interface Session {
  id: string;
  cwd: string;
  title: string;
  projectName: string;
  lastActiveTime: string;
  messages: ChatMessage[];
}
