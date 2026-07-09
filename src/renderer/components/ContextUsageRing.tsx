import { useState } from 'react';
import { Circle } from 'lucide-react';
import { useSessionStore } from '../store/sessionStore';

function formatK(tokens: number): string {
  if (tokens >= 1_000_000) return `${(tokens / 1_000_000).toFixed(1)}m`;
  if (tokens >= 1_000) return `${(tokens / 1_000).toFixed(1)}k`;
  return String(tokens);
}

const SIZE = 20;
const STROKE = 2.5;
const RADIUS = (SIZE - STROKE) / 2;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

// Auto-refreshes after each turn (throttled — see sessionStore.ts's turn-completed handler),
// and hover also fetches on demand if nothing's cached yet (e.g. the throttle window hasn't
// allowed an automatic fetch yet). An earlier version fired on every single turn-completed and
// on every session-switch with no throttling, which caused a real regression: /context can take
// tens of seconds of real wall-clock time in an environment with several MCP servers connected
// (confirmed by hand — it enumerates every connected server's tool schemas), and while in
// flight it occupies the session's single stdin stream. sessionStore.ts's isQueryingContext
// flag plus the throttle together keep this from ever blocking a real message for long or often.
export function ContextUsageRing() {
  const [hovering, setHovering] = useState(false);
  const usage = useSessionStore((s) => s.contextUsage);
  const isQueryingContext = useSessionStore((s) => s.isQueryingContext);
  const refreshContextUsage = useSessionStore((s) => s.refreshContextUsage);

  const handleMouseEnter = () => {
    setHovering(true);
    if (!usage && !isQueryingContext) refreshContextUsage();
  };

  const percent = usage ? Math.min(100, Math.max(0, usage.usedPercent)) : 0;
  const dashOffset = CIRCUMFERENCE * (1 - percent / 100);

  return (
    <div
      data-testid="context-usage-ring"
      className="relative flex items-center justify-center w-[26px] h-[26px] shrink-0"
      onMouseEnter={handleMouseEnter}
      onMouseLeave={() => setHovering(false)}
    >
      {usage ? (
        <svg width={SIZE} height={SIZE} className="-rotate-90 shrink-0">
          <circle cx={SIZE / 2} cy={SIZE / 2} r={RADIUS} fill="none" stroke="rgba(255,255,255,0.15)" strokeWidth={STROKE} />
          <circle
            cx={SIZE / 2}
            cy={SIZE / 2}
            r={RADIUS}
            fill="none"
            stroke="currentColor"
            strokeWidth={STROKE}
            strokeLinecap="round"
            strokeDasharray={CIRCUMFERENCE}
            strokeDashoffset={dashOffset}
            className="text-accent-amber transition-all duration-300"
          />
        </svg>
      ) : (
        <Circle size={14} className="text-neutral-500" />
      )}
      {hovering && (
        <div
          data-testid="context-usage-tooltip"
          className="absolute bottom-full right-0 mb-2 w-60 bg-[#2a2a2c] border border-card-border rounded-xl shadow-xl z-50 px-3 py-2.5"
        >
          {usage ? (
            <>
              <div className="text-xs text-neutral-200 font-medium mb-2">
                上下文窗口：{formatK(usage.usedTokens)} 已用（剩余 {(100 - percent).toFixed(0)}%）
              </div>
              <div className="space-y-1">
                {usage.categories.map((cat) => (
                  <div key={cat.label} className="flex items-center justify-between text-[11px] text-text-secondary">
                    <span className="truncate pr-2">{cat.label}</span>
                    <span className="text-neutral-300 shrink-0">
                      {formatK(cat.tokens)} · {cat.percent}%
                    </span>
                  </div>
                ))}
              </div>
            </>
          ) : (
            <div className="text-xs text-text-secondary">{isQueryingContext ? '查询中，可能需要几十秒…' : '悬浮以查询上下文用量'}</div>
          )}
        </div>
      )}
    </div>
  );
}
