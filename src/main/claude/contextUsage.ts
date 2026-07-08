import type { ContextUsageSnapshot } from '../../shared/ipc';

// Parses the markdown Claude Code's own `/context` local command returns (see
// ClaudeSession.queryContextUsage — sent as a plain message over stream-json stdin).
// Not a stable JSON API, so this is deliberately tolerant of a missing/extra category
// row rather than assuming an exact fixed set (varies with configured MCP servers/skills).
export function parseContextUsageMarkdown(text: string): ContextUsageSnapshot | null {
  const modelMatch = text.match(/\*\*Model:\*\*\s*(.+)/);
  const tokensMatch = text.match(/\*\*Tokens:\*\*\s*([\d.]+\s*[km]?)\s*\/\s*([\d.]+\s*[km]?)\s*\(([\d.]+)%\)/i);
  if (!modelMatch || !tokensMatch) return null;

  const parseAmount = (raw: string): number => {
    const m = raw.trim().match(/^([\d.]+)\s*([km]?)$/i);
    if (!m) return NaN;
    const n = parseFloat(m[1]);
    const suffix = m[2].toLowerCase();
    if (suffix === 'k') return Math.round(n * 1_000);
    if (suffix === 'm') return Math.round(n * 1_000_000);
    return Math.round(n);
  };

  const usedTokens = parseAmount(tokensMatch[1]);
  const totalTokens = parseAmount(tokensMatch[2]);
  const usedPercent = parseFloat(tokensMatch[3]);
  if (!Number.isFinite(usedTokens) || !Number.isFinite(totalTokens)) return null;

  const categories: { label: string; tokens: number; percent: number }[] = [];
  const rowPattern = /^\|\s*([^|]+?)\s*\|\s*([\d.]+\s*[km]?)\s*\|\s*([\d.]+)%\s*\|\s*$/gim;
  let match: RegExpExecArray | null;
  while ((match = rowPattern.exec(text)) !== null) {
    const label = match[1].trim();
    if (label.toLowerCase() === 'category' || /^:?-+:?$/.test(label)) continue; // header/separator row
    const tokens = parseAmount(match[2]);
    const percent = parseFloat(match[3]);
    if (!Number.isFinite(tokens)) continue;
    categories.push({ label, tokens, percent });
  }

  return { modelLabel: modelMatch[1].trim(), usedTokens, totalTokens, usedPercent, categories };
}
