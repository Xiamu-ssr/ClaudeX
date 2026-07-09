export interface SlashCommandMenuItem {
  name: string;
  description?: string;
}

interface SlashCommandMenuProps {
  open: boolean;
  items: SlashCommandMenuItem[];
  highlightedIndex: number;
  onSelect: (name: string) => void;
}

// Purely presentational — InputBar.tsx owns the curated command list, catalog-description
// lookup, and text-filtering/sorting, so the highlighted index it computes always matches
// what's actually rendered here.
export function SlashCommandMenu({ open, items, highlightedIndex, onSelect }: SlashCommandMenuProps) {
  if (!open || items.length === 0) return null;

  return (
    <div
      data-testid="slash-command-menu"
      className="absolute bottom-full left-0 right-0 mb-2 max-h-80 overflow-y-auto bg-[#2a2a2c] border border-card-border rounded-xl shadow-xl z-50 py-1"
    >
      {items.map(({ name, description }, i) => (
        <button
          key={name}
          data-testid={`slash-command-item-${name}`}
          onMouseDown={(e) => {
            e.preventDefault();
            onSelect(name);
          }}
          className={`w-full flex items-center gap-3 px-3 py-2 text-sm text-left transition-colors ${
            i === highlightedIndex ? 'bg-white/10' : 'hover:bg-white/5'
          }`}
        >
          <span className="text-neutral-200 font-mono shrink-0">/{name}</span>
          {description && <span className="text-xs text-text-secondary truncate">{description}</span>}
        </button>
      ))}
    </div>
  );
}
