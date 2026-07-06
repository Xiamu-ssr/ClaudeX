interface RichTextProps {
  text: string;
  className?: string;
}

export function RichText({ text, className = '' }: RichTextProps) {
  const paragraphs = text.split('\n\n');

  return (
    <div className={className}>
      {paragraphs.map((paragraph, i) => (
        <p key={i} className="mb-3 last:mb-0 leading-relaxed">
          {renderInline(paragraph)}
        </p>
      ))}
    </div>
  );
}

function renderInline(text: string) {
  const parts = text.split(/(`[^`]+`)/g);
  return parts.map((part, i) => {
    if (part.startsWith('`') && part.endsWith('`')) {
      return (
        <code
          key={i}
          className="bg-[#3a3a3c] px-1.5 py-0.5 rounded text-[13px] text-neutral-300 font-mono"
        >
          {part.slice(1, -1)}
        </code>
      );
    }
    return <span key={i}>{part}</span>;
  });
}
