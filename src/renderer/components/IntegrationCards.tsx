import { Check } from 'lucide-react';

interface CardProps {
  icon: React.ReactNode;
  title: string;
  description: string;
  connected?: boolean;
}

function Card({ icon, title, description, connected }: CardProps) {
  return (
    <button className="border border-card-border rounded-xl p-4 text-left hover:bg-white/3 transition-colors group">
      <div className="flex items-start justify-between mb-3">
        <div className="text-2xl">{icon}</div>
        {connected && (
          <div className="w-5 h-5 rounded-full bg-green-500 flex items-center justify-center">
            <Check size={12} className="text-white" strokeWidth={3} />
          </div>
        )}
      </div>
      <div className="text-sm font-medium text-neutral-200 mb-1">{title}</div>
      <div className="text-xs text-text-secondary leading-relaxed">
        {description}
      </div>
    </button>
  );
}

function SlackIcon() {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
      <path d="M6 15a2 2 0 0 1-2 2 2 2 0 0 1-2-2 2 2 0 0 1 2-2h2v2zm1 0a2 2 0 0 1 2-2 2 2 0 0 1 2 2v5a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-5z" fill="#E01E5A"/>
      <path d="M9 6a2 2 0 0 1-2-2 2 2 0 0 1 2-2 2 2 0 0 1 2 2v2H9zm0 1a2 2 0 0 1 2 2 2 2 0 0 1-2 2H4a2 2 0 0 1-2-2 2 2 0 0 1 2-2h5z" fill="#36C5F0"/>
      <path d="M18 9a2 2 0 0 1 2-2 2 2 0 0 1 2 2 2 2 0 0 1-2 2h-2V9zm-1 0a2 2 0 0 1-2 2 2 2 0 0 1-2-2V4a2 2 0 0 1 2-2 2 2 0 0 1 2 2v5z" fill="#2EB67D"/>
      <path d="M15 18a2 2 0 0 1 2 2 2 2 0 0 1-2 2 2 2 0 0 1-2-2v-2h2zm0-1a2 2 0 0 1-2-2 2 2 0 0 1 2-2h5a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-5z" fill="#ECB22E"/>
    </svg>
  );
}

function GitHubIcon() {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor" className="text-neutral-300">
      <path d="M12 2C6.477 2 2 6.477 2 12c0 4.42 2.865 8.17 6.839 9.49.5.092.682-.217.682-.482 0-.237-.008-.866-.013-1.7-2.782.604-3.369-1.34-3.369-1.34-.454-1.156-1.11-1.464-1.11-1.464-.908-.62.069-.608.069-.608 1.003.07 1.531 1.03 1.531 1.03.892 1.529 2.341 1.087 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.11-4.555-4.943 0-1.091.39-1.984 1.029-2.683-.103-.253-.446-1.27.098-2.647 0 0 .84-.269 2.75 1.025A9.578 9.578 0 0 1 12 6.836a9.59 9.59 0 0 1 2.504.337c1.909-1.294 2.747-1.025 2.747-1.025.546 1.377.203 2.394.1 2.647.64.699 1.028 1.592 1.028 2.683 0 3.842-2.339 4.687-4.566 4.935.359.309.678.919.678 1.852 0 1.336-.012 2.415-.012 2.743 0 .267.18.578.688.48C19.138 20.167 22 16.418 22 12c0-5.523-4.477-10-10-10z"/>
    </svg>
  );
}

function LinearIcon() {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
      <path d="M3.357 14.143l6.5 6.5a9.953 9.953 0 0 1-6.5-6.5zM2 12c0 1.42.297 2.77.832 3.994l7.174 7.174A9.966 9.966 0 0 0 14 24c.074 0 .148-.002.222-.004L2.004 11.778C2.002 11.852 2 11.926 2 12zm.71-2.696l11.986 11.986A9.99 9.99 0 0 0 21.304 17.7L6.3 2.696A9.99 9.99 0 0 0 2.71 9.304zM8.874 2.01L21.99 15.126A10.007 10.007 0 0 0 24 12c0-5.523-4.477-10-10-10a10.003 10.003 0 0 0-5.126 1.41z" fill="#8B8BF5" transform="translate(-1 -1)"/>
    </svg>
  );
}

export function IntegrationCards() {
  return (
    <div className="mt-6 w-full max-w-[720px] grid grid-cols-3 gap-3">
      <Card
        icon={<SlackIcon />}
        title="连接消息传送"
        description="了解工程对话线程动态"
      />
      <Card
        icon={<GitHubIcon />}
        title="连接 GitHub"
        description="审查 PR、代码和 CI 检查项"
        connected
      />
      <Card
        icon={<LinearIcon />}
        title="连接 Linear"
        description="跟踪缺陷和实施工作"
      />
    </div>
  );
}
