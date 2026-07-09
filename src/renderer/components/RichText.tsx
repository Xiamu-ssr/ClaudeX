import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { Components } from 'react-markdown';

interface RichTextProps {
  text: string;
  className?: string;
}

const components: Components = {
  p: ({ children }) => <p className="mb-3 last:mb-0 leading-[1.7]">{children}</p>,
  strong: ({ children }) => <strong className="font-semibold">{children}</strong>,
  em: ({ children }) => <em className="italic">{children}</em>,
  a: ({ children, href }) => (
    <a
      href={href}
      onClick={(e) => {
        e.preventDefault();
        if (href) window.electronAPI.claude.openExternal({ url: href });
      }}
      className="text-accent-orange underline underline-offset-2 hover:opacity-80 cursor-pointer"
    >
      {children}
    </a>
  ),
  ul: ({ children }) => <ul className="list-disc pl-5 mb-3 space-y-1">{children}</ul>,
  ol: ({ children }) => <ol className="list-decimal pl-5 mb-3 space-y-1">{children}</ol>,
  li: ({ children }) => <li className="leading-[1.7]">{children}</li>,
  h1: ({ children }) => <h1 className="text-xl font-semibold mb-2 mt-1">{children}</h1>,
  h2: ({ children }) => <h2 className="text-lg font-semibold mb-2 mt-1">{children}</h2>,
  h3: ({ children }) => <h3 className="text-base font-semibold mb-2 mt-1">{children}</h3>,
  h4: ({ children }) => <h4 className="text-sm font-semibold mb-1.5 mt-1">{children}</h4>,
  h5: ({ children }) => <h5 className="text-sm font-semibold mb-1.5 mt-1">{children}</h5>,
  h6: ({ children }) => <h6 className="text-sm font-semibold mb-1.5 mt-1">{children}</h6>,
  blockquote: ({ children }) => (
    <blockquote className="border-l-2 border-card-border pl-3 text-neutral-400 italic mb-3">{children}</blockquote>
  ),
  hr: () => <hr className="border-card-border my-3" />,
  table: ({ children }) => (
    <div className="overflow-x-auto mb-3">
      <table className="border-collapse text-[14px]">{children}</table>
    </div>
  ),
  th: ({ children }) => <th className="border border-card-border px-2 py-1 text-left font-medium">{children}</th>,
  td: ({ children }) => <td className="border border-card-border px-2 py-1 text-left">{children}</td>,
  pre: ({ children }) => (
    <pre className="bg-[#1c1c1e] border border-card-border rounded-lg p-3.5 overflow-x-auto text-[13px] font-mono text-neutral-300 leading-[1.6] mb-3">
      {children}
    </pre>
  ),
  code: ({ className, children, node }) => {
    // Distinguish fenced (block) code from inline code. react-markdown wraps
    // fenced code in <pre><code>; a fence WITH a language tag gives the <code>
    // a `language-xxx` className, but a fence WITHOUT a language tag gives it
    // NO className — identical to inline code. The reliable extra signal is
    // `node.position`: a fenced block's hast <code> position always spans at
    // least the opening and closing fence lines (start.line !== end.line),
    // while single-line inline code stays on one line. Combined, `className`
    // catches with-lang fences and the multiline check catches no-lang fences.
    // The only false-positive is multi-line inline code (`code\nspanning`),
    // which is rare and visually fine rendered as a block.
    const isBlock =
      !!className ||
      (node?.position?.start.line ?? 0) !== (node?.position?.end.line ?? 0);
    if (isBlock) {
      return <code className={className}>{children}</code>;
    }
    return (
      <code className="bg-[#4a4a4d] px-1.5 py-0.5 rounded-md text-[13px] text-neutral-200 font-mono">
        {children}
      </code>
    );
  },
};

export function RichText({ text, className = '' }: RichTextProps) {
  return (
    <div className={className}>
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
        {text}
      </ReactMarkdown>
    </div>
  );
}
