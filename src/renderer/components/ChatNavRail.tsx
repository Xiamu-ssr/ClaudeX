import { useState } from 'react';

export interface ChatNavTick {
  index: number;
  snippet: string;
}

interface ChatNavRailProps {
  ticks: ChatNavTick[];
  onSelect: (index: number) => void;
}

const TICK_GAP = 22;
const MAX_RAIL_HEIGHT = 400;

export function ChatNavRail({ ticks, onSelect }: ChatNavRailProps) {
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);

  if (ticks.length < 2) return null;

  const idealHeight = (ticks.length - 1) * TICK_GAP;
  const railHeight = Math.min(idealHeight, MAX_RAIL_HEIGHT);
  const gap = railHeight / (ticks.length - 1);

  return (
    <div
      className="absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none z-10"
      style={{ height: railHeight }}
    >
      {ticks.map((tick, i) => (
        <div
          key={tick.index}
          className="absolute left-0 -translate-y-1/2 pointer-events-auto"
          style={{ top: i * gap }}
          onMouseEnter={() => setHoveredIndex(tick.index)}
          onMouseLeave={() => setHoveredIndex((current) => (current === tick.index ? null : current))}
        >
          <button
            onClick={() => onSelect(tick.index)}
            aria-label={`跳转到第 ${tick.index + 1} 轮`}
            className={`block h-[3px] rounded-full transition-all duration-200 ${
              hoveredIndex === tick.index ? 'w-8 bg-white/80' : 'w-4 bg-white/30 hover:bg-white/50'
            }`}
          />
          {hoveredIndex === tick.index && (
            <div className="absolute left-10 top-1/2 -translate-y-1/2 w-64 bg-[#2a2a2c] border border-card-border rounded-lg shadow-xl px-3 py-2 z-20">
              <p className="text-xs text-neutral-300 line-clamp-3">{tick.snippet}</p>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
