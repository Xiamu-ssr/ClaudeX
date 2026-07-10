import { create } from 'zustand';
import type { Session, ChatMessage, AssistantTurn, MessageAttachment } from '../types/chat';
import type {
  ClaudeSessionEvent,
  EffortLevel,
  PermissionMode,
  ProjectSummary,
  SessionListEntry,
  ModelProviderConfig,
  ShowInFinderResponse,
  CreateWorktreeResponse,
  ForkSessionResponse,
  ContextUsageSnapshot,
} from '../../shared/ipc';

const DEFAULT_PROVIDER_ID = 'builtin-anthropic';
const DEFAULT_MODEL_ID = 'claude-sonnet-5';

export type RightPanelTab = 'files' | 'review' | 'terminal' | 'browser';

// Defense-in-depth safety net: if an in-flight turn goes this long with zero progress
// (no new step/response delta), treat it as hung and surface an error rather than leaving
// the "..." indicator spinning forever. Catches any hang cause, known or not yet identified —
// see CCodeBox project memory for the investigation that motivated this.
const WATCHDOG_TIMEOUT_MS = 300_000;

interface SessionStore {
  activeSessionId: string | null;
  activeSession: Session | null;
  isProcessing: boolean;
  projects: ProjectSummary[];
  sessionsByProject: Record<string, SessionListEntry[]>;
  selectedProjectCwd: string | null;
  permissionMode: PermissionMode;
  // null = don't pass --effort at all, deferring to the CLI's own default (which may
  // itself be driven by the user's real CLAUDE_CODE_EFFORT_LEVEL env var) rather than
  // CCodeBox silently overriding it with an invented default.
  effortLevel: EffortLevel | null;
  modelProviders: ModelProviderConfig[];
  selectedProviderId: string;
  selectedModelId: string;
  rightPanelOpen: boolean;
  rightPanelTab: RightPanelTab;
  previewFile: { cwd: string; relativePath: string } | null;
  contextUsage: ContextUsageSnapshot | null;
  isQueryingContext: boolean;
  slashCommands: string[];
  queuedMessages: { id: string; text: string; attachments?: MessageAttachment[] }[];
  openFilePreview: (cwd: string, relativePath: string) => void;
  closeFilePreview: () => void;
  setSelectedProjectCwd: (cwd: string) => void;
  setPermissionMode: (mode: PermissionMode) => void;
  setEffortLevel: (level: EffortLevel | null) => void;
  setRightPanelOpen: (open: boolean) => void;
  toggleRightPanel: () => void;
  setRightPanelTab: (tab: RightPanelTab) => void;
  loadProjectList: () => Promise<void>;
  setProjectPinned: (cwd: string, pinned: boolean) => Promise<void>;
  setProjectCollapsed: (cwd: string, collapsed: boolean) => Promise<void>;
  renameProject: (cwd: string, customName: string) => Promise<void>;
  removeProject: (cwd: string) => Promise<void>;
  archiveSession: (sessionId: string) => Promise<void>;
  removeSession: (sessionId: string) => Promise<void>;
  renameSession: (sessionId: string, title: string) => Promise<void>;
  showInFinder: (path: string) => Promise<ShowInFinderResponse>;
  createWorktree: (cwd: string, branch: string) => Promise<CreateWorktreeResponse>;
  forkSession: (cwd: string, sessionId: string) => Promise<ForkSessionResponse>;
  loadModelProviders: () => Promise<void>;
  saveModelProvider: (provider: ModelProviderConfig) => Promise<void>;
  deleteModelProvider: (id: string) => Promise<void>;
  setSelectedModel: (providerId: string, modelId: string) => void;
  changeModelMidConversation: (providerId: string, modelId: string, effort: EffortLevel | null) => Promise<void>;
  startNewChat: (cwd: string, projectName: string) => Promise<void>;
  openHistoricalSession: (cwd: string, sessionId: string) => Promise<void>;
  sendMessage: (text: string, attachments?: MessageAttachment[]) => Promise<void>;
  queueMessage: (text: string, attachments?: MessageAttachment[]) => void;
  removeQueuedMessage: (id: string) => void;
  stopSession: () => Promise<void>;
  refreshContextUsage: () => Promise<void>;
}

function truncateTitle(text: string): string {
  return text.length > 20 ? `${text.slice(0, 20)}...` : text;
}

function emptySession(id: string, cwd: string, projectName: string): Session {
  return { id, cwd, title: '新对话', projectName, lastActiveTime: '刚刚', messages: [] };
}

function contextWindowForModel(provider: ModelProviderConfig | undefined, modelId: string): number | undefined {
  return provider?.models.find((model) => model.id === modelId)?.contextWindowTokens;
}

export const useSessionStore = create<SessionStore>((set, get) => {
  // Tracks a sessionId currently undergoing a deliberate, user/store-initiated shutdown
  // (explicit "stop" or the stop+respawn done by changeModelMidConversation) so the
  // process-exited event that naturally follows isn't mistaken for a crash.
  let pendingStopSessionId: string | null = null;
  let watchdogTimer: ReturnType<typeof setTimeout> | null = null;

  const clearWatchdog = () => {
    if (watchdogTimer) {
      clearTimeout(watchdogTimer);
      watchdogTimer = null;
    }
  };

  // Resolves whatever turn is still in-flight for this session instead of leaving it stuck
  // on "..." forever. No-ops if the turn already completed normally (the common case: the
  // CLI finishes an in-flight turn before honoring a deliberate stop's stdin EOF).
  const failInFlightTurn = (sessionId: string, message: string, isError = true) => {
    clearWatchdog();
    set((s) => {
      if (!s.activeSession || s.activeSession.id !== sessionId) return s;
      const messages = [...s.activeSession.messages];
      const lastIdx = messages.length - 1;
      const last = messages[lastIdx];
      if (!last || last.role !== 'assistant' || !last.turn.isProcessing) return s;

      const turn: AssistantTurn = {
        ...last.turn,
        isProcessing: false,
        isError,
        response: last.turn.response || message,
      };
      messages[lastIdx] = { role: 'assistant', turn };
      return { activeSession: { ...s.activeSession, messages }, isProcessing: false };
    });
    maybeDrainQueue(sessionId);
  };

  const armWatchdog = (sessionId: string) => {
    clearWatchdog();
    watchdogTimer = setTimeout(() => {
      failInFlightTurn(sessionId, '⚠️ 响应超时（5 分钟未收到 Claude Code 输出），连接可能已中断，请重试。');
    }, WATCHDOG_TIMEOUT_MS);
  };

  // Pops and sends the next queued message once a turn genuinely finishes — success, a
  // deliberate stop, or a crash, any path that flips `isProcessing` back to false. Must only
  // be called AFTER the `set` call that actually flips the store's `isProcessing` to false, never
  // before: `sendMessage` itself guards on `state.isProcessing` and would silently no-op if
  // called one tick too early (confirmed by reading sendMessage's own guard clause).
  const maybeDrainQueue = (sessionId: string) => {
    const state = get();
    if (!state.activeSession || state.activeSession.id !== sessionId) return;
    if (state.queuedMessages.length === 0) return;
    const [next, ...rest] = state.queuedMessages;
    set({ queuedMessages: rest });
    get().sendMessage(next.text, next.attachments);
  };

  window.electronAPI.claude.onSessionEvent((event: ClaudeSessionEvent) => {
    const state = get();
    if (!state.activeSession || state.activeSession.id !== event.sessionId) return;

    if (event.kind === 'session-ready') {
      set({ slashCommands: event.slashCommands });
      return;
    }

    if (event.kind === 'turn-progress') {
      if (state.isProcessing) armWatchdog(event.sessionId);
      return;
    }

    // This comes from the usage metadata already attached to a normal Claude response.
    // It deliberately does not issue `/context`, which some compatible gateways misroute as
    // billable one-token inference calls.
    if (event.kind === 'context-usage-updated') {
      set({ contextUsage: event.usage });
      return;
    }

    if (event.kind === 'process-error' || event.kind === 'process-exited') {
      // A deliberate stop (explicit "stop" or changeModelMidConversation's stop+respawn)
      // always produces a process-exited — that's expected, not a crash. But if it somehow
      // exits/errors WITHOUT the current turn ever resolving normally, still recover the UI
      // (gracefully, not styled as an error) rather than leaving "..." stuck forever.
      const wasExpected = pendingStopSessionId === event.sessionId;
      if (wasExpected) pendingStopSessionId = null;
      failInFlightTurn(
        event.sessionId,
        wasExpected
          ? '（已停止）'
          : event.kind === 'process-error'
            ? `⚠️ Claude 进程异常：${event.message}`
            : `⚠️ Claude 进程意外退出（code ${event.code ?? '未知'}），请重试。`,
        !wasExpected
      );
      return;
    }

    if (
      event.kind === 'turn-step-appended' ||
      event.kind === 'turn-step-updated' ||
      event.kind === 'turn-response-updated'
    ) {
      armWatchdog(event.sessionId);
    } else if (event.kind === 'turn-completed') {
      clearWatchdog();
      get().loadProjectList();
    }

    // Context accounting is disabled at the main-process boundary while gateway providers
    // incorrectly bill Claude Code's tool-count probes as inference. Keep the normal chat
    // lifecycle independent of that optional display metric.
    const willAutoRefreshContext = false;

    set((s) => {
      if (!s.activeSession) return s;
      const messages = [...s.activeSession.messages];
      const lastIdx = messages.length - 1;
      const last = messages[lastIdx];
      if (!last || last.role !== 'assistant') return s;

      const turn: AssistantTurn = { ...last.turn };

      switch (event.kind) {
        case 'turn-step-appended':
          turn.steps = [...turn.steps, event.step];
          break;
        case 'turn-step-updated': {
          const steps = [...turn.steps];
          steps[event.index] = event.step;
          turn.steps = steps;
          break;
        }
        case 'turn-response-updated':
          turn.response = event.response;
          break;
        case 'turn-completed':
          turn.isProcessing = false;
          turn.processingTime = event.processingTime;
          turn.isError = event.isError;
          break;
      }

      messages[lastIdx] = { role: 'assistant', turn };
      return {
        activeSession: { ...s.activeSession, messages },
        isProcessing: event.kind === 'turn-completed' ? false : s.isProcessing,
        contextUsage: willAutoRefreshContext ? null : s.contextUsage,
      };
    });

    if (event.kind === 'turn-completed') {
      maybeDrainQueue(event.sessionId);
      // Only AFTER the `set` above has actually flipped isProcessing to false — calling this
      // any earlier hits refreshContextUsage's own isProcessing guard and silently no-ops, the
      // same trap maybeDrainQueue already had to avoid (see its comment). /context measurably
      // takes 10-40s wall-clock in an environment with several MCP servers connected
      // (confirmed by hand — it enumerates every connected server's tool schemas, unlike
      // near-instant commands like /usage), so firing after every single turn would mean the
      // user is often waiting behind it (isQueryingContext blocks sendMessage). Throttled to
      // once per CONTEXT_REFRESH_THROTTLE_MS; manual hover on the ring still works in between.
      if (willAutoRefreshContext) {
        get().refreshContextUsage();
      }
    }
  });

  // Cleared inside onSessionEvent's process-error/process-exited handling, not here — the
  // renderer can observe this invoke's own resolution before it observes the corresponding
  // process-exited push (confirmed empirically, not just a theoretical race), so clearing on
  // success here can beat the classification check and mislabel a real stop as a crash.
  const stopSessionInternal = async (sessionId: string) => {
    pendingStopSessionId = sessionId;
    try {
      await window.electronAPI.claude.stopSession({ sessionId });
    } catch (err) {
      if (pendingStopSessionId === sessionId) pendingStopSessionId = null;
      throw err;
    }
  };

  return {
    activeSessionId: null,
    activeSession: null,
    isProcessing: false,
    projects: [],
    sessionsByProject: {},
    selectedProjectCwd: null,
    permissionMode: 'bypassPermissions',
    effortLevel: null,
    modelProviders: [],
    selectedProviderId: DEFAULT_PROVIDER_ID,
    selectedModelId: DEFAULT_MODEL_ID,
    rightPanelOpen: false,
    rightPanelTab: 'files',
    previewFile: null,
    contextUsage: null,
    isQueryingContext: false,
    slashCommands: [],
    queuedMessages: [],

    setSelectedProjectCwd: (cwd) => set({ selectedProjectCwd: cwd }),
    setPermissionMode: (mode) => set({ permissionMode: mode }),
    setEffortLevel: (level) => set({ effortLevel: level }),
    setRightPanelOpen: (open) => set({ rightPanelOpen: open }),
    toggleRightPanel: () => set((s) => ({ rightPanelOpen: !s.rightPanelOpen })),
    setRightPanelTab: (tab) => set({ rightPanelTab: tab }),

    openFilePreview: (cwd, relativePath) => set({ previewFile: { cwd, relativePath } }),
    closeFilePreview: () => set({ previewFile: null }),

    loadProjectList: async () => {
      const { projects } = await window.electronAPI.claude.listProjects();
      set((s) => {
        const selectedStillExists = s.selectedProjectCwd !== null && projects.some((p) => p.cwd === s.selectedProjectCwd);
        return {
          projects,
          selectedProjectCwd: selectedStillExists ? s.selectedProjectCwd : (projects[0]?.cwd ?? null),
        };
      });

      const sessionsByProject: Record<string, SessionListEntry[]> = {};
      for (const project of projects) {
        const { sessions } = await window.electronAPI.claude.listSessionsForProject({ cwd: project.cwd });
        sessionsByProject[project.cwd] = sessions;
      }
      set({ sessionsByProject });
    },

    setProjectPinned: async (cwd, pinned) => {
      await window.electronAPI.claude.setProjectPinned({ cwd, pinned });
      await get().loadProjectList();
    },

    setProjectCollapsed: async (cwd, collapsed) => {
      await window.electronAPI.claude.setProjectCollapsed({ cwd, collapsed });
      await get().loadProjectList();
    },

    renameProject: async (cwd, customName) => {
      await window.electronAPI.claude.renameProject({ cwd, customName });
      await get().loadProjectList();
    },

    removeProject: async (cwd) => {
      await window.electronAPI.claude.removeProject({ cwd });
      await get().loadProjectList();
    },

    archiveSession: async (sessionId) => {
      await window.electronAPI.claude.archiveSession({ sessionId });
      await get().loadProjectList();
    },

    removeSession: async (sessionId) => {
      await window.electronAPI.claude.removeSession({ sessionId });
      await get().loadProjectList();
    },

    renameSession: async (sessionId, title) => {
      await window.electronAPI.claude.renameSession({ sessionId, title });
      await get().loadProjectList();
    },

    showInFinder: async (path) => {
      return window.electronAPI.claude.showInFinder({ path });
    },

    createWorktree: async (cwd, branch) => {
      return window.electronAPI.claude.createWorktree({ cwd, branch });
    },

    forkSession: async (cwd, sessionId) => {
      const result = await window.electronAPI.claude.forkSession({ cwd, sourceSessionId: sessionId });
      if (result.ok && result.newSessionId) {
        await get().loadProjectList();
        await get().openHistoricalSession(cwd, result.newSessionId);
      }
      return result;
    },

    loadModelProviders: async () => {
      const { providers } = await window.electronAPI.claude.listModelProviders();
      set({ modelProviders: providers });
    },

    saveModelProvider: async (provider) => {
      const { providers } = await window.electronAPI.claude.saveModelProvider({ provider });
      set({ modelProviders: providers });
    },

    deleteModelProvider: async (id) => {
      const { providers } = await window.electronAPI.claude.deleteModelProvider({ id });
      set((s) => ({
        modelProviders: providers,
        selectedProviderId: s.selectedProviderId === id ? DEFAULT_PROVIDER_ID : s.selectedProviderId,
        selectedModelId: s.selectedProviderId === id ? DEFAULT_MODEL_ID : s.selectedModelId,
      }));
    },

    setSelectedModel: (providerId, modelId) => set({ selectedProviderId: providerId, selectedModelId: modelId }),

    changeModelMidConversation: async (providerId, modelId, effort) => {
      const state = get();
      if (!state.activeSessionId || !state.activeSession) {
        set({ selectedProviderId: providerId, selectedModelId: modelId, effortLevel: effort });
        return;
      }
      const provider = state.modelProviders.find((p) => p.id === providerId);
      const { cwd, id: sessionId } = state.activeSession;

      set({ isProcessing: true });
      await stopSessionInternal(sessionId);
      await window.electronAPI.claude.startOrResumeSession({
        cwd,
        resumeSessionId: sessionId,
        permissionMode: state.permissionMode,
        model: modelId,
        effort: effort ?? undefined,
        extraEnv: provider?.env,
        contextWindowTokens: contextWindowForModel(provider, modelId),
      });
      set({ selectedProviderId: providerId, selectedModelId: modelId, effortLevel: effort, isProcessing: false });
    },

    startNewChat: async (cwd, projectName) => {
      const { permissionMode, effortLevel, modelProviders, selectedProviderId, selectedModelId } = get();
      const provider = modelProviders.find((p) => p.id === selectedProviderId);
      const { sessionId } = await window.electronAPI.claude.startOrResumeSession({
        cwd,
        permissionMode,
        model: selectedModelId,
        effort: effortLevel ?? undefined,
        extraEnv: provider?.env,
        contextWindowTokens: contextWindowForModel(provider, selectedModelId),
      });
      set({
        activeSessionId: sessionId,
        activeSession: emptySession(sessionId, cwd, projectName),
        isProcessing: false,
        contextUsage: null,
        slashCommands: [],
        queuedMessages: [],
      });
      await get().loadProjectList();
    },

    openHistoricalSession: async (cwd, sessionId) => {
      const state = get();
      if (state.activeSessionId === sessionId) return;
      if (state.activeSessionId) {
        await stopSessionInternal(state.activeSessionId);
      }

      set({ isProcessing: true });
      const { permissionMode, effortLevel, modelProviders, selectedProviderId, selectedModelId } = state;
      const provider = modelProviders.find((p) => p.id === selectedProviderId);
      const { session } = await window.electronAPI.claude.loadHistoricalSession({ cwd, sessionId });
      await window.electronAPI.claude.startOrResumeSession({
        cwd,
        resumeSessionId: sessionId,
        permissionMode,
        model: selectedModelId,
        effort: effortLevel ?? undefined,
        extraEnv: provider?.env,
        contextWindowTokens: contextWindowForModel(provider, selectedModelId),
      });
      set({ activeSessionId: sessionId, activeSession: session, isProcessing: false, contextUsage: null, slashCommands: [], queuedMessages: [] });
    },

    sendMessage: async (text, attachments) => {
      const state = get();
      if (!state.activeSessionId || !state.activeSession) return;
      // isQueryingContext: a /context side-channel query is using this same session's stdin —
      // see refreshContextUsage's comment for why writing a real message on top of it is unsafe.
      if (state.isProcessing || state.isQueryingContext) return;

      const isFirstMessage = state.activeSession.messages.length === 0;
      const userMsg: ChatMessage = { role: 'user', content: text, attachments };
      const placeholder: ChatMessage = {
        role: 'assistant',
        turn: { processingTime: 0, steps: [], response: '', isProcessing: true, startedAt: Date.now() },
      };

      set({
        activeSession: {
          ...state.activeSession,
          title: isFirstMessage ? truncateTitle(text) : state.activeSession.title,
          messages: [...state.activeSession.messages, userMsg, placeholder],
        },
        isProcessing: true,
      });

      armWatchdog(state.activeSessionId);
      const outgoingAttachments = attachments?.map((a) => ({
        mimeType: a.mimeType,
        base64Data: a.dataUrl.slice(a.dataUrl.indexOf(',') + 1),
      }));
      await window.electronAPI.claude.sendUserMessage({
        sessionId: state.activeSessionId,
        text,
        attachments: outgoingAttachments,
      });
    },

    queueMessage: (text, attachments) => {
      const id = crypto.randomUUID();
      set((s) => ({ queuedMessages: [...s.queuedMessages, { id, text, attachments }] }));
    },

    removeQueuedMessage: (id) => {
      set((s) => ({ queuedMessages: s.queuedMessages.filter((m) => m.id !== id) }));
    },

    stopSession: async () => {
      const state = get();
      if (!state.activeSessionId) return;
      await stopSessionInternal(state.activeSessionId);
    },

    // Called automatically (throttled — see the turn-completed handler above) and from the
    // ring's own manual hover handler. Never called on session-switch/session-start: `/context`
    // can take tens of seconds of real wall-clock time in an environment with several MCP
    // servers connected (confirmed by hand — it enumerates every connected server's tool
    // schemas), and while it's in flight it occupies the session's single stdin stream — a
    // real message sent during that window would otherwise queue up right behind it. Two
    // things make this safe now: isQueryingContext blocks sendMessage from writing to stdin
    // while a query is in flight (InputBar queues the message instead of losing it, same path
    // as an in-flight turn), and separately, the `/context` invocation's own bookkeeping lines
    // that persist to the real session .jsonl no longer corrupt anything on replay (see
    // historyReader.ts's isLocalCommandEcho for that read-side fix).
    refreshContextUsage: async () => {
      const state = get();
      if (!state.activeSessionId || state.isProcessing || state.isQueryingContext) return;
      set({ isQueryingContext: true });
      try {
        const result = await window.electronAPI.claude.getContextUsage({ sessionId: state.activeSessionId });
        if (result.ok && result.usage) set({ contextUsage: result.usage });
      } catch {
        // best-effort; keep showing the last known snapshot (or none) on failure
      } finally {
        set({ isQueryingContext: false });
      }
    },
  };
});
