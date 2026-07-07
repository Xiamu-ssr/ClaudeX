// Maps a filename to a Prism language identifier recognized by react-syntax-highlighter's
// Prism build. Returns 'text' for unrecognized extensions, which react-syntax-highlighter
// renders as plain unhighlighted text (verified empirically against the installed v16
// highlight.js — see getCodeTree in dist/esm/highlight.js: language === 'text' short-circuits
// the refractor.highlight call and returns a plain-text AST, and any unknown language is also
// caught by a try/catch fallback to defaultCodeValue, so 'text' is always a safe fallback).
export function getLanguageForFilename(name: string): string {
  const lower = name.toLowerCase();
  const ext = lower.slice(lower.lastIndexOf('.') + 1);
  const map: Record<string, string> = {
    ts: 'typescript',
    tsx: 'tsx',
    js: 'javascript',
    jsx: 'jsx',
    mjs: 'javascript',
    cjs: 'javascript',
    py: 'python',
    go: 'go',
    rs: 'rust',
    java: 'java',
    c: 'c',
    cpp: 'cpp',
    h: 'c',
    hpp: 'cpp',
    json: 'json',
    jsonc: 'json',
    md: 'markdown',
    mdx: 'markdown',
    css: 'css',
    scss: 'scss',
    less: 'less',
    html: 'markup',
    htm: 'markup',
    xml: 'markup',
    svg: 'markup',
    yml: 'yaml',
    yaml: 'yaml',
    toml: 'toml',
    ini: 'ini',
    sh: 'bash',
    bash: 'bash',
    zsh: 'bash',
    sql: 'sql',
    rb: 'ruby',
    php: 'php',
    swift: 'swift',
    kt: 'kotlin',
    kts: 'kotlin',
  };
  return map[ext] ?? 'text';
}
