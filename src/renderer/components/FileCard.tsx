import { FileText, ChevronDown } from 'lucide-react';

interface FileCardProps {
  name: string;
  fileType: string;
}

export function FileCard({ name, fileType }: FileCardProps) {
  return (
    <div className="bg-card border border-card-border rounded-xl p-3 flex items-center gap-3 mt-3">
      <div className="w-10 h-10 rounded-lg bg-[#363638] flex items-center justify-center shrink-0">
        <FileText size={18} className="text-neutral-400" />
      </div>
      <div className="flex-1 min-w-0">
        <div className="text-sm text-neutral-200 font-medium truncate">{name}</div>
        <div className="text-xs text-text-secondary">文档 · {fileType}</div>
      </div>
      <button className="flex items-center gap-1 text-sm text-neutral-300 bg-[#363638] hover:bg-[#444446] px-3 py-1.5 rounded-lg transition-colors shrink-0">
        打开方式
        <ChevronDown size={14} />
      </button>
    </div>
  );
}
