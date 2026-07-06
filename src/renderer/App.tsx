import { useState } from 'react';
import { Sidebar } from './components/Sidebar';
import { MainContent } from './components/MainContent';
import { ChatView } from './components/ChatView';
import { PluginsView } from './components/PluginsView';
import { SettingsView } from './components/SettingsView';
import { RightPanel } from './components/RightPanel';
import { useSessionStore } from './store/sessionStore';
import type { MessageAttachment } from './types/chat';

export type AppView = 'home' | 'chat' | 'plugins' | 'settings';

interface NavState {
  history: AppView[];
  index: number;
}

// Fallback only for the rare case no real project has been discovered yet
// (e.g. ~/.claude/projects is empty on a totally fresh machine).
const FALLBACK_PROJECT_CWD = '/Users/xiamu/Code/CCodeBox';
const FALLBACK_PROJECT_NAME = 'CCodeBox';

export function App() {
  const [nav, setNav] = useState<NavState>({ history: ['home'], index: 0 });
  const currentView = nav.history[nav.index];
  const canGoBack = nav.index > 0;
  const canGoForward = nav.index < nav.history.length - 1;

  const activeSession = useSessionStore((s) => s.activeSession);
  const isProcessing = useSessionStore((s) => s.isProcessing);
  const startNewChat = useSessionStore((s) => s.startNewChat);
  const sendMessage = useSessionStore((s) => s.sendMessage);
  const stopSession = useSessionStore((s) => s.stopSession);
  const selectedProjectCwd = useSessionStore((s) => s.selectedProjectCwd);
  const projects = useSessionStore((s) => s.projects);
  const rightPanelOpen = useSessionStore((s) => s.rightPanelOpen);
  const rightPanelCwd = activeSession?.cwd ?? selectedProjectCwd ?? FALLBACK_PROJECT_CWD;

  const navigate = (view: AppView) => {
    if (view === currentView) return;
    setNav((prev) => {
      const truncated = prev.history.slice(0, prev.index + 1);
      return { history: [...truncated, view], index: truncated.length };
    });
  };

  const goBack = () => {
    setNav((prev) => (prev.index > 0 ? { ...prev, index: prev.index - 1 } : prev));
  };

  const goForward = () => {
    setNav((prev) => (prev.index < prev.history.length - 1 ? { ...prev, index: prev.index + 1 } : prev));
  };

  const handleSendFromHome = async (text: string, attachments?: MessageAttachment[]) => {
    const cwd = selectedProjectCwd ?? FALLBACK_PROJECT_CWD;
    const project = projects.find((p) => p.cwd === cwd);
    await startNewChat(cwd, project?.displayName ?? FALLBACK_PROJECT_NAME);
    navigate('chat');
    await sendMessage(text, attachments);
  };

  if (currentView === 'settings') {
    return (
      <div className="flex h-screen">
        <SettingsView onBack={goBack} />
      </div>
    );
  }

  return (
    <div className="flex h-screen">
      <Sidebar currentView={currentView} onNavigate={navigate} />
      {currentView === 'home' && (
        <MainContent
          onSend={handleSendFromHome}
          onBack={goBack}
          onForward={goForward}
          canGoBack={canGoBack}
          canGoForward={canGoForward}
        />
      )}
      {currentView === 'chat' && activeSession && (
        <ChatView
          key={activeSession.id}
          session={activeSession}
          isProcessing={isProcessing}
          onSend={sendMessage}
          onStop={stopSession}
          onSessionArchivedOrRemoved={() => navigate('home')}
        />
      )}
      {currentView === 'plugins' && <PluginsView />}
      {(currentView === 'home' || currentView === 'chat') && rightPanelOpen && <RightPanel cwd={rightPanelCwd} />}
    </div>
  );
}
