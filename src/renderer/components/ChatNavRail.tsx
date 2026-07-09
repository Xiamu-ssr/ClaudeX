import { useMemo, useRef, useState } from 'react';

export interface ChatNavTick {
  index: number;
  snippet: string;
}

interface ChatNavRailProps {
  ticks: ChatNavTick[];
  onSelect: (index: number) => void;
  // Real available height of the parent messages area (measured via ResizeObserver in
  // ChatView.tsx) — the rail grows to use it as more ticks accumulate, but past that it
  // shrinks spacing toward a floor, and past *that* it shows only the most recent turns
  // rather than crushing everything into unreadable, unclickable slivers.
  containerHeight: number;
}

const IDEAL_GAP = 22; // preferred spacing when there's room for it
const MIN_GAP = 6; // floor spacing once too many ticks exist for IDEAL_GAP to fit
const USABLE_HEIGHT_RATIO = 0.85; // leave a little breathing room at the top/bottom of the panel
const MAGNIFY_SIGMA_RATIO = 1.4; // scales with `gap` so ~7 neighbors respond regardless of density
const MAGNIFY_EXTRA_GAP_MAX = 10; // px of extra spacing a fully-magnified tick pushes into its neighbors
const BASE_WIDTH = 12;
const MAX_WIDTH = 42;
const BASE_HEIGHT = 2;
const MAX_HEIGHT = 3;

interface RailLayout {
  visibleTicks: ChatNavTick[];
  gap: number;
}

function computeLayout(ticks: ChatNavTick[], containerHeight: number): RailLayout | null {
  if (ticks.length < 2) return null;
  const usableHeight = Math.max(containerHeight * USABLE_HEIGHT_RATIO, 0);
  const idealHeight = (ticks.length - 1) * IDEAL_GAP;

  if (idealHeight <= usableHeight) {
    return { visibleTicks: ticks, gap: IDEAL_GAP };
  }

  const maxFittingAtMinGap = Math.floor(usableHeight / MIN_GAP) + 1;
  if (ticks.length <= maxFittingAtMinGap) {
    return { visibleTicks: ticks, gap: usableHeight / (ticks.length - 1) };
  }

  // Too many even at the floor spacing — keep only the most recent ones that fit, since
  // the latest turns are what's most useful to jump back to quickly.
  return { visibleTicks: ticks.slice(-maxFittingAtMinGap), gap: MIN_GAP };
}

export function ChatNavRail({ ticks, onSelect, containerHeight }: ChatNavRailProps) {
  const [hoverY, setHoverY] = useState<number | null>(null);
  const hitAreaRef = useRef<HTMLDivElement>(null);

  const layout = useMemo(() => computeLayout(ticks, containerHeight), [ticks, containerHeight]);

  if (!layout) return null;
  const { visibleTicks, gap } = layout;
  const nominalHeight = (visibleTicks.length - 1) * gap;

  // Gaussian falloff from the cursor's Y position (in the STABLE base grid, never the
  // fisheye-shifted one below) — the closest tick is magnified most, fading out smoothly over
  // roughly the nearest 7 ticks. Sigma scales with `gap` so "how many neighbors respond" feels
  // the same whether ticks are spaced ideally or packed at the floor.
  const sigma = gap * MAGNIFY_SIGMA_RATIO;
  const magnifications = visibleTicks.map((_, i) => {
    if (hoverY === null) return 0;
    const distance = i * gap - hoverY;
    return Math.exp(-(distance * distance) / (2 * sigma * sigma));
  });

  // Cumulative fisheye offset for the VISUAL ticks only: each magnified tick pushes everything
  // after it further away, so nearby gaps visibly widen. This deliberately never feeds back
  // into hit-testing — see the hit-area comment below for why that matters.
  let cumulativeExtra = 0;
  const positions = magnifications.map((m, i) => {
    const y = i * gap + cumulativeExtra;
    cumulativeExtra += m * MAGNIFY_EXTRA_GAP_MAX;
    return y;
  });

  const closestIndex = hoverY === null ? -1 : magnifications.indexOf(Math.max(...magnifications));

  return (
    <div className="absolute left-3 top-1/2 -translate-y-1/2 z-10 w-11" style={{ height: nominalHeight }}>
      {/* Visual layer: purely decorative, no pointer events of its own. Ticks are free to
          render outside the nominal box (fisheye push-apart) without affecting anything below. */}
      <div className="absolute inset-0 pointer-events-none">
        {visibleTicks.map((tick, i) => {
          const m = magnifications[i];
          const width = BASE_WIDTH + m * (MAX_WIDTH - BASE_WIDTH);
          const height = BASE_HEIGHT + m * (MAX_HEIGHT - BASE_HEIGHT);
          const opacity = 0.25 + m * 0.75;
          return (
            <div
              key={tick.index}
              className="absolute left-0 -translate-y-1/2 transition-[top] duration-150 ease-out"
              style={{ top: positions[i] }}
            >
              <div className="block rounded-full bg-white transition-all duration-150 ease-out" style={{ width, height, opacity }} />
            </div>
          );
        })}
        {closestIndex >= 0 && (
          <div
            className="absolute left-14 -translate-y-1/2 w-64 bg-[#2a2a2c] border border-card-border rounded-lg shadow-xl px-3 py-2 z-20"
            style={{ top: positions[closestIndex] }}
          >
            <p className="text-xs text-neutral-300 line-clamp-3">{visibleTicks[closestIndex].snippet}</p>
          </div>
        )}
      </div>

      {/* Hit-test layer: a single contiguous surface at the STABLE base grid geometry, never
          resized/repositioned by magnification. If this shifted along with the visual ticks
          above (it used to), a magnified tick moving out from under a stationary cursor would
          fire mouseleave, un-magnify, move back under the cursor, re-fire mousemove, and
          magnify again — a real oscillation confirmed by hand (hoverY flip-flopping between a
          real value and null on every render). A stable hit-test surface, decoupled from the
          shifting visual, breaks that loop entirely. Clicking anywhere selects whichever tick
          is currently closest (i.e. currently magnified), computed from the same stable hoverY
          the magnification itself uses — always consistent with what's visually highlighted. */}
      <div
        ref={hitAreaRef}
        className="absolute inset-0 cursor-pointer"
        aria-label="对话导航条：悬浮查看，点击跳转到最近的一轮"
        onMouseMove={(e) => {
          const rect = hitAreaRef.current?.getBoundingClientRect();
          if (rect) setHoverY(e.clientY - rect.top);
        }}
        onMouseLeave={() => setHoverY(null)}
        onClick={() => {
          if (closestIndex >= 0) onSelect(visibleTicks[closestIndex].index);
        }}
      />
    </div>
  );
}
