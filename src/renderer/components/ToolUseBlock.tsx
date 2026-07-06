import { useState } from 'react';
import { RefreshCw, ChevronRight, ChevronDown, CircleAlert } from 'lucide-react';

interface ToolUseBlockProps {
  summary: string;
  details: string[];
  isError?: boolean;
  pending?: boolean;
}

export function ToolUseBlock({ summary, details, isError, pending }: ToolUseBlockProps) {
  const [expanded, setExpanded] = useState(false);
  const hasDetails = details.length > 0;

  return (
    <div className="py-1">
      <button
        onClick={() => hasDetails && setExpanded(!expanded)}
        className={`flex items-center gap-2 text-[13px] ${isError ? 'text-red-400' : 'text-text-secondary'} ${hasDetails ? 'cursor-pointer hover:text-neutral-400' : 'cursor-default'} transition-colors`}
      >
        {isError ? (
          <CircleAlert size={14} className="text-red-400 shrink-0" />
        ) : (
          <RefreshCw size={14} className={`text-text-tertiary shrink-0 ${pending ? 'animate-spin' : ''}`} />
        )}
        <span>{summary}</span>
        {hasDetails && (
          expanded
            ? <ChevronDown size={14} className="text-text-tertiary" />
            : <ChevronRight size={14} className="text-text-tertiary" />
        )}
      </button>

      {expanded && (
        <div className="ml-[22px] mt-1 space-y-0.5">
          {details.map((detail, i) => (
            <div key={i} className={`text-[13px] py-0.5 ${isError ? 'text-red-400/80' : 'text-text-secondary'}`}>
              {detail}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
