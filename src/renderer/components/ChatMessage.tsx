import { useEffect, useRef, useState } from 'react';
import {
  Copy,
  ThumbsUp,
  ThumbsDown,
  Lightbulb,
  Share2,
  Download,
  ChevronRight,
  ChevronDown,
  AlertTriangle,
} from 'lucide-react';
import type { ChatMessage as ChatMessageType, Step, AssistantTurn, MessageAttachment } from '../types/chat';
import { groupSteps } from '../../shared/groupSteps';
import { RichText } from './RichText';
import { ToolUseBlock, FileEditsGroup } from './ToolUseBlock';
import { FileCard } from './FileCard';
import { formatDuration } from '../utils/formatDuration';

interface ChatMessageProps {
  message: ChatMessageType;
  cwd: string;
}

export function ChatMessage({ message, cwd }: ChatMessageProps) {
  if (message.role === 'user') {
    return <UserBubble content={message.content} attachments={message.attachments} />;
  }
  return <AssistantBlock turn={message.turn} cwd={cwd} />;
}

function UserBubble({ content, attachments }: { content: string; attachments?: MessageAttachment[] }) {
  return (
    <div className="mb-6">
      <div className="flex justify-end">
        <div className="max-w-[85%] flex flex-col items-end gap-2">
          {attachments && attachments.length > 0 && (
            <div className="flex flex-wrap justify-end gap-2">
              {attachments.map((att, i) => (
                <img
                  key={i}
                  src={att.dataUrl}
                  alt={att.name}
                  className="w-32 h-32 object-cover rounded-xl border border-card-border"
                />
              ))}
            </div>
          )}
          <div className="bg-[#363638] rounded-2xl px-4 py-3 text-[15px] text-white">
            {content}
          </div>
        </div>
      </div>
      <div className="flex justify-end mt-1.5 pr-1">
        <button className="p-1 rounded hover:bg-white/5 transition-colors text-neutral-600 hover:text-neutral-400">
          <Copy size={14} />
        </button>
      </div>
    </div>
  );
}

function AssistantBlock({ turn, cwd }: { turn: AssistantTurn; cwd: string }) {
  const [stepsCollapsed, setStepsCollapsed] = useState(!turn.isProcessing);
  const wasProcessing = useRef(turn.isProcessing);

  useEffect(() => {
    if (wasProcessing.current && !turn.isProcessing) {
      setStepsCollapsed(true);
    }
    wasProcessing.current = turn.isProcessing;
  }, [turn.isProcessing]);

  const [liveElapsed, setLiveElapsed] = useState(0);

  useEffect(() => {
    if (!turn.isProcessing || turn.startedAt === undefined) return;
    const tick = () => setLiveElapsed(Math.floor((Date.now() - turn.startedAt!) / 1000));
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [turn.isProcessing, turn.startedAt]);

  const displaySeconds = turn.isProcessing ? liveElapsed : turn.processingTime;

  const hasAnyContent = turn.steps.length > 0 || turn.response.length > 0;

  return (
    <div className="mb-6">
      {/* Waiting for the first token — otherwise this block renders as a blank gap */}
      {turn.isProcessing && !hasAnyContent && <ThinkingIndicator />}

      {/* Processing header */}
      {turn.steps.length > 0 && (
        <div className="mb-3">
          <button
            onClick={() => setStepsCollapsed(!stepsCollapsed)}
            className="flex items-center gap-1.5 text-sm text-text-secondary hover:text-neutral-400 transition-colors py-1"
          >
            <span>已处理 {formatDuration(displaySeconds)}</span>
            {stepsCollapsed ? (
              <ChevronRight size={14} />
            ) : (
              <ChevronDown size={14} />
            )}
          </button>
          {!stepsCollapsed && <div className="border-t border-card-border mt-1" />}
        </div>
      )}

      {/* Steps (when expanded) */}
      {!stepsCollapsed && (
        <div className="mb-4">
          <StepsList steps={turn.steps} cwd={cwd} />
        </div>
      )}

      {/* Final response */}
      {turn.response && turn.isError && (
        <div className="flex items-start gap-2 rounded-lg border border-red-500/30 bg-red-500/[0.06] px-3 py-2.5">
          <AlertTriangle size={15} className="mt-0.5 shrink-0 text-red-400" />
          <RichText text={turn.response} className="text-[15px] text-red-200" />
        </div>
      )}
      {turn.response && !turn.isError && (
        <RichText text={turn.response} className="text-[15px] text-neutral-200" />
      )}

      {/* File attachments */}
      {turn.files?.map((file, i) => (
        <FileCard key={i} name={file.name} fileType={file.fileType} />
      ))}

      {/* Action bar */}
      {!turn.isProcessing && hasAnyContent && <ActionBar />}
    </div>
  );
}

function ThinkingIndicator() {
  return (
    <div className="flex items-center gap-1.5 py-1 text-text-secondary">
      <span className="w-1.5 h-1.5 rounded-full bg-text-secondary animate-bounce [animation-delay:-0.3s]" />
      <span className="w-1.5 h-1.5 rounded-full bg-text-secondary animate-bounce [animation-delay:-0.15s]" />
      <span className="w-1.5 h-1.5 rounded-full bg-text-secondary animate-bounce" />
    </div>
  );
}

function StepsList({ steps, cwd }: { steps: Step[]; cwd: string }) {
  const groups = groupSteps(steps);
  return (
    <div className="space-y-1">
      {groups.map((group, i) => {
        if (group.kind === 'file-edits') {
          return <FileEditsGroup key={i} steps={group.steps} cwd={cwd} />;
        }
        const step = group.step;
        if (step.type === 'thinking') {
          return (
            <RichText
              key={i}
              text={step.text}
              className="text-[15px] text-neutral-200 py-1"
            />
          );
        }
        return (
          <ToolUseBlock
            key={i}
            summary={step.summary}
            details={step.details}
            isError={step.isError}
            pending={step.pending}
          />
        );
      })}
    </div>
  );
}

const actionButtons = [
  { icon: Copy, label: '复制' },
  { icon: ThumbsUp, label: '有帮助' },
  { icon: ThumbsDown, label: '没帮助' },
  { icon: Lightbulb, label: '建议' },
  { icon: Share2, label: '分享' },
  { icon: Download, label: '下载' },
];

function ActionBar() {
  return (
    <div className="flex items-center gap-0.5 mt-3">
      {actionButtons.map(({ icon: Icon, label }) => (
        <button
          key={label}
          title={label}
          className="p-1.5 rounded hover:bg-white/5 transition-colors text-neutral-600 hover:text-neutral-400"
        >
          <Icon size={15} />
        </button>
      ))}
    </div>
  );
}
