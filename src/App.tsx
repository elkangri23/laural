import { appendTerminalOutput, COMMAND_BLOCK_OUTPUT_LIMIT } from "./terminalOutput";
import { createChatHistoryPersistence } from "./chatPersistence";
import { limitChatMessages, prepareChatHistoryForRequest } from "./chatHistory";
import { createStreamingTextBuffer } from "./streamingText";
import { addProjectPath, projectPathIdentity, readProjectWorkspace, removeProjectPath, writeProjectWorkspace } from "./projectWorkspace";
import { HelpDialog, HelpIcon } from "./components/HelpDialog";
import { BellIcon, NotificationCenter } from "./components/NotificationCenter";
import { SettingsDialog, type SettingsCategory } from "./components/SettingsDialog";
import type { ExecutionMode } from "./components/AgentSettings";
import { UpdateManager } from "./components/UpdateManager";
import { ChatMessageItem, type ChatMessage } from "./components/ChatMessageItem";
import { CommandBlockItem, type CommandBlock } from "./components/CommandBlockItem";
import { SparkIcon } from "./components/SparkIcon";
import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { open } from "@tauri-apps/plugin-dialog";
import type { ConfigurationImportResult } from "./components/ConfigurationTransfer";
import { themeVariables, themes, type AppearanceMode } from "./themes";
import { LanguageProvider, useLanguage } from "./i18n";
import "./App.css";

const TerminalPane = lazy(() => import("./components/TerminalPane"));
const AgentSettings = lazy(() => import("./components/AgentSettings").then(module => ({ default: module.AgentSettings })));
const AgentActivity = lazy(() => import("./components/AgentActivity").then(module => ({ default: module.AgentActivity })));
const AccountSettings = lazy(() => import("./components/AccountSettings").then(module => ({ default: module.AccountSettings })));
const CommandPalette = lazy(() => import("./components/CommandPalette").then(module => ({ default: module.CommandPalette })));
const GitPanel = lazy(() => import("./components/GitPanel").then(module => ({ default: module.GitPanel })));
const TaskRecipes = lazy(() => import("./components/TaskRecipes").then(module => ({ default: module.TaskRecipes })));
const ConfigurationTransfer = lazy(() => import("./components/ConfigurationTransfer").then(module => ({ default: module.ConfigurationTransfer })));

type Shell = "powershell" | "cmd" | "wsl" | "git-bash";
type TerminalTab = { id: string; shell: Shell; title: string; cwd: string | null };
type CommandHistoryEntry = { id: string; terminalId: string; command: string; shell: Shell };
type ContextPreview = { terminal: string; project: string; selectedFiles: string; gitDiff: string; totalCharacters: number };
type Provider = { id: string; providerKind: string; name: string; baseUrl: string; model: string; hasApiKey: boolean; shareCustomEndpoint: boolean };
type PlanAction =
  | { type: "run_command"; command: string; reason: string; status?: string; result?: string }
  | { type: "write_file"; path: string; content: string; reason: string; status?: string; result?: string };
type AgentPlan = { summary: string; clarifyingQuestion?: string | null; actions: PlanAction[] };
const COMMAND_OUTPUT_BATCH_MS = 50;
const MAX_COMMAND_BLOCKS = 80;
const MAX_COMMAND_HISTORY = 100;
const MAX_OPEN_TERMINALS = 16;
const CHAT_DELTA_BATCH_MS = 50;
const SYNC_RISK_ACK_KEY = "laural.sync-risk-ack.v1";
const POWERSHELL_PREDICTION_KEY = "laural.powershell-prediction.v1";

const shellNames: Record<Shell, string> = {
  powershell: "PowerShell",
  cmd: "Command Prompt",
  wsl: "WSL",
  "git-bash": "Git Bash",
};
const shellIcons: Record<Shell, string> = {
  powershell: "PS", cmd: "$_", wsl: "WSL", "git-bash": "$",
};

function AppContent() {
  const { language, setLanguage, messages } = useLanguage();
  const appText = messages.app;
  const [projectWorkspace, setProjectWorkspace] = useState(() => readProjectWorkspace(localStorage));
  const projectPath = projectWorkspace.activePath;
  const projectPaths = projectWorkspace.paths;
  const [tabs, setTabs] = useState<TerminalTab[]>(() => [
    { id: crypto.randomUUID(), shell: "powershell", title: "PowerShell", cwd: projectWorkspace.activePath },
  ]);
  const [activeTabId, setActiveTabId] = useState(tabs[0].id);
  const [splitTabId, setSplitTabId] = useState<string | null>(null);
  const [splitOrientation, setSplitOrientation] = useState<"vertical" | "horizontal" | null>(null);
  const [commandBlocks, setCommandBlocks] = useState<CommandBlock[]>([]);
  const [terminalCopyRequest, setTerminalCopyRequest] = useState({ sequence: 0, terminalId: "" });
  const [terminalClearRequest, setTerminalClearRequest] = useState({ sequence: 0, terminalId: "" });
  const [terminalActionNotice, setTerminalActionNotice] = useState("");
  const [terminalMoreOpen, setTerminalMoreOpen] = useState(false);
  const [appMenuOpen, setAppMenuOpen] = useState(false);
  const [commandHistory, setCommandHistory] = useState<CommandHistoryEntry[]>([]);
  const [blocksOpen, setBlocksOpen] = useState(false);
  const [assistantVisible, setAssistantVisible] = useState(() => localStorage.getItem("laural.assistant-visible.v1") !== "false");
  const [commandPaletteOpen, setCommandPaletteOpen] = useState(false);
  const [commandPaletteView, setCommandPaletteView] = useState<"all" | "history">("all");
  const [gitPanelOpen, setGitPanelOpen] = useState(false);
  const [taskRecipesOpen, setTaskRecipesOpen] = useState(false);
  const [contextPreview, setContextPreview] = useState<ContextPreview | null>(null);
  const [contextPreviewBusy, setContextPreviewBusy] = useState(false);
  const [contextPreviewError, setContextPreviewError] = useState("");
  const [shellMenuOpen, setShellMenuOpen] = useState(false);
  const [agentMode, setAgentMode] = useState(false);
  const [prompt, setPrompt] = useState("");
  const [providerDialogOpen, setProviderDialogOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsCategory, setSettingsCategory] = useState<SettingsCategory>("personalization");
  const [returnToSettings, setReturnToSettings] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const [workspaceMenuOpen, setWorkspaceMenuOpen] = useState(false);
  const [profileMenuOpen, setProfileMenuOpen] = useState(false);
  const [transferOpen, setTransferOpen] = useState(false);
  const [accountSettingsOpen, setAccountSettingsOpen] = useState(false);
  const [updateSettingsOpen, setUpdateSettingsOpen] = useState(false);
  const [appearanceOpen, setAppearanceOpen] = useState(false);
  const [syncNotice, setSyncNotice] = useState("");
  const [powerShellPredictionEnabled, setPowerShellPredictionEnabled] = useState(() => localStorage.getItem(POWERSHELL_PREDICTION_KEY) === "true");
  const [syncRiskAcknowledged, setSyncRiskAcknowledged] = useState(() => localStorage.getItem(SYNC_RISK_ACK_KEY) === "true");
  const [themeId, setThemeId] = useState(() => localStorage.getItem("laural.theme") ?? "laurel");
  const [appearance, setAppearance] = useState<AppearanceMode>(() => localStorage.getItem("laural.appearance") === "light" ? "light" : "dark");
  const [provider, setProvider] = useState<Provider | null>(null);
  const [providers, setProviders] = useState<Provider[]>([]);
  const [editingProviderId, setEditingProviderId] = useState<string | null>(null);
  const [providerKind, setProviderKind] = useState("freellmapi");
  const [shareCustomEndpoint, setShareCustomEndpoint] = useState(false);
  const [providerName, setProviderName] = useState("FreeLLMAPI");
  const [baseUrl, setBaseUrl] = useState("http://127.0.0.1:31415/v1");
  const [model, setModel] = useState("auto");
  const [apiKey, setApiKey] = useState("");
  const [models, setModels] = useState<string[]>([]);
  const [providerBusy, setProviderBusy] = useState(false);
  const [providerError, setProviderError] = useState("");
  const [providerNotice, setProviderNotice] = useState("");
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>(() => {
    try {
      const stored: unknown = JSON.parse(localStorage.getItem("laural.chat.v1") ?? "[]");
      return Array.isArray(stored) ? limitChatMessages(stored.filter((item): item is ChatMessage => item && (item.role === "user" || item.role === "assistant") && typeof item.content === "string")) : [];
    } catch { return []; }
  });
  const chatHistoryPersistenceRef = useRef<ReturnType<typeof createChatHistoryPersistence> | null>(null);
  if (chatHistoryPersistenceRef.current === null) chatHistoryPersistenceRef.current = createChatHistoryPersistence(localStorage);
  const [chatBusy, setChatBusy] = useState(false);
  const [streamingMessageId, setStreamingMessageId] = useState<string | null>(null);
  const streamingContentRef = useRef<ReturnType<typeof createStreamingTextBuffer> | null>(null);
  if (streamingContentRef.current === null) streamingContentRef.current = createStreamingTextBuffer();
  const [contextFiles, setContextFiles] = useState<string[]>([]);
  const [gitDiffContext, setGitDiffContext] = useState("");
  const [gitDiffTruncated, setGitDiffTruncated] = useState(false);
  const [backupVersions, setBackupVersions] = useState<Record<number, string[]>>({});
  const [selectedBackups, setSelectedBackups] = useState<Record<number, string>>({});
  const [agentPlan, setAgentPlan] = useState<AgentPlan | null>(null);
  const [agentPlanProjectPath, setAgentPlanProjectPath] = useState<string | null>(null);
  const [agentPlanBusy, setAgentPlanBusy] = useState(false);
  const [agentCommandBusy, setAgentCommandBusy] = useState(false);
  const [executionMode, setExecutionMode] = useState<ExecutionMode>("review");
  const [allowedPrefixes, setAllowedPrefixes] = useState(["git status", "git diff"]);
  const [backupRetention, setBackupRetention] = useState<number | null>(null);
  const [ruleDraft, setRuleDraft] = useState("git status\ngit diff");
  const [policyNotice, setPolicyNotice] = useState("");
  const terminalContextRef = useRef<Record<string, string>>({});
  const pendingCommandOutputRef = useRef<Record<string, string>>({});
  const outputFlushTimerRef = useRef<number | null>(null);
  const activeChatRequestRef = useRef<string | null>(null);
  const activeCommandBlockRef = useRef<Record<string, string>>({});
  const activeAgentRequestRef = useRef<string | null>(null);
  const agentClarificationRef = useRef<{ task: string; question: string } | null>(null);
  const agentStopRequestedRef = useRef(false);
  const activeAgentTerminalRef = useRef<string | null>(null);
  const commandCompletionRef = useRef<Record<string, { resolve: (exitCode: number | null) => void; timer: ReturnType<typeof setTimeout>; requiresAgentToken?: boolean; token?: string }>>({});
  const syncTimerRef = useRef<number | null>(null);
  const workspaceMenuRef = useRef<HTMLDivElement>(null);
  const profileMenuRef = useRef<HTMLDivElement>(null);
  const terminalMoreRef = useRef<HTMLDivElement>(null);
  const appMenuRef = useRef<HTMLDivElement>(null);
  const appMenuButtonRef = useRef<HTMLButtonElement>(null);
  const appearanceSyncReadyRef = useRef(false);

  const syncSavedPreferences = useCallback(async () => {
    if (localStorage.getItem(SYNC_RISK_ACK_KEY) !== "true") return;
    try {
      const preferences = {
        themeId: localStorage.getItem("laural.theme") ?? themeId,
        appearance: localStorage.getItem("laural.appearance") === "light" ? "light" : "dark",
        updateMode: localStorage.getItem("laural.update-mode.v1") === "automatic" ? "automatic" : "manual",
        language,
      };
      const snapshot = await invoke<{
        schemaVersion: number;
        preferences: typeof preferences;
        activeProviderId: string | null;
        providers: { id: string; kind: string; name: string; model: string; customEndpoint?: string }[];
      }>("get_preference_snapshot", { preferences });
      const result = await invoke<{ status: "synced" | "pending" | "needsChoice" | "conflict" | "signedOut" }>("sync_local_preferences", { snapshot });
      if (result.status === "synced" || result.status === "signedOut") setSyncNotice("");
      else if (result.status === "pending") setSyncNotice(appText.syncPending);
      else if (result.status === "conflict") setSyncNotice(appText.syncConflict);
      else setSyncNotice(appText.syncChoose);
    } catch {
      setSyncNotice(appText.syncFailed);
    }
  }, [themeId, language, appText.syncPending, appText.syncConflict, appText.syncChoose, appText.syncFailed]);

  const schedulePreferenceSync = useCallback((delayMs = 700) => {
    if (syncTimerRef.current !== null) window.clearTimeout(syncTimerRef.current);
    syncTimerRef.current = window.setTimeout(() => {
      syncTimerRef.current = null;
      void syncSavedPreferences();
    }, delayMs);
  }, [syncSavedPreferences]);

  function clearSyncNotice() {
    setSyncNotice("");
  }

  function acknowledgeSyncRisk(): boolean {
    try {
      localStorage.setItem(SYNC_RISK_ACK_KEY, "true");
      setSyncRiskAcknowledged(true);
      schedulePreferenceSync(0);
      return true;
    } catch {
      return false;
    }
  }

  function requestTerminalCopy() {
    setTerminalActionNotice("");
    setTerminalCopyRequest((request) => ({ sequence: request.sequence + 1, terminalId: activeTabId }));
  }

  function requestTerminalClear() {
    setTerminalActionNotice("");
    setTerminalClearRequest((request) => ({ sequence: request.sequence + 1, terminalId: activeTabId }));
  }

  useEffect(() => {
    chatHistoryPersistenceRef.current?.schedule(chatMessages);
  }, [chatMessages]);

  useEffect(() => {
    const persistBeforeHide = () => chatHistoryPersistenceRef.current?.flush();
    window.addEventListener("pagehide", persistBeforeHide);
    return () => {
      window.removeEventListener("pagehide", persistBeforeHide);
      chatHistoryPersistenceRef.current?.cancel();
    };
  }, []);

  useEffect(() => {
    void invoke<{ pending: boolean }>("get_preference_sync_status").then((status) => {
      if (status.pending) setSyncNotice(appText.syncPendingAgain);
    }).catch(() => undefined);
    const startup = window.setTimeout(() => schedulePreferenceSync(0), 1_500);
    const interval = window.setInterval(() => schedulePreferenceSync(0), 3 * 60 * 60 * 1000);
    const updateModeChanged = () => schedulePreferenceSync();
    const accountConnected = () => schedulePreferenceSync(0);
    const accountDisconnected = () => {
      if (syncTimerRef.current !== null) window.clearTimeout(syncTimerRef.current);
      syncTimerRef.current = null;
    };
    const networkRestored = () => schedulePreferenceSync(0);
    const appResumed = () => {
      if (document.visibilityState === "visible") schedulePreferenceSync(0);
    };
    window.addEventListener("laural:update-mode-changed", updateModeChanged);
    window.addEventListener("laural:account-connected", accountConnected);
    window.addEventListener("laural:account-disconnected", accountDisconnected);
    window.addEventListener("online", networkRestored);
    window.addEventListener("focus", networkRestored);
    document.addEventListener("visibilitychange", appResumed);
    return () => {
      window.clearTimeout(startup);
      window.clearInterval(interval);
      window.removeEventListener("laural:update-mode-changed", updateModeChanged);
      window.removeEventListener("laural:account-connected", accountConnected);
      window.removeEventListener("laural:account-disconnected", accountDisconnected);
      window.removeEventListener("online", networkRestored);
      window.removeEventListener("focus", networkRestored);
      document.removeEventListener("visibilitychange", appResumed);
      if (syncTimerRef.current !== null) window.clearTimeout(syncTimerRef.current);
    };
  }, [schedulePreferenceSync, appText.syncPendingAgain]);

  useEffect(() => {
    if (!appearanceSyncReadyRef.current) {
      appearanceSyncReadyRef.current = true;
      return;
    }
    schedulePreferenceSync();
  }, [themeId, appearance, language, schedulePreferenceSync]);

  useEffect(() => {
    function handlePaletteShortcut(event: KeyboardEvent) {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setCommandPaletteView("all");
        setCommandPaletteOpen((open) => !open);
      }
    }
    window.addEventListener("keydown", handlePaletteShortcut);
    return () => window.removeEventListener("keydown", handlePaletteShortcut);
  }, []);

  useEffect(() => {
    void Promise.all([
      invoke<Provider | null>("get_provider"),
      invoke<Provider[]>("get_providers"),
    ]).then(([active, savedProviders]) => {
      setProviders(savedProviders);
      if (active) loadProviderIntoForm(active);
    }).catch(() => undefined);
  }, []);

  function loadProviderIntoForm(saved: Provider) {
    setProvider(saved);
    setEditingProviderId(saved.id);
    setProviderName(saved.name);
    setBaseUrl(saved.baseUrl);
    setModel(saved.model);
    if (saved.providerKind) setProviderKind(saved.providerKind);
    else if (saved.name.toLowerCase().includes("freellmapi")) setProviderKind("freellmapi");
    else if (saved.name.toLowerCase().includes("ollama")) setProviderKind("ollama");
    else if (saved.name.toLowerCase().includes("lm studio")) setProviderKind("lmstudio");
    else setProviderKind("custom");
    setShareCustomEndpoint(saved.shareCustomEndpoint ?? false);
  }

  function applyImportedConfiguration(result: ConfigurationImportResult) {
    localStorage.setItem("laural.theme", result.preferences.themeId);
    localStorage.setItem("laural.appearance", result.preferences.appearance);
    localStorage.setItem("laural.update-mode.v1", result.preferences.updateMode);
    setLanguage(result.preferences.language);
    window.dispatchEvent(new Event("laural:update-mode-changed"));
    setThemeId(result.preferences.themeId);
    setAppearance(result.preferences.appearance);
    setProviders(result.providers);
    setApiKey("");
    if (result.activeProvider) loadProviderIntoForm(result.activeProvider);
    else {
      setProvider(null);
      setEditingProviderId(null);
    }
  }

  useEffect(() => {
    void invoke<{ mode: ExecutionMode; allowedPrefixes: string[]; backupRetention?: number | null }>("get_agent_settings").then((settings) => {
      setExecutionMode(settings.mode);
      setAllowedPrefixes(settings.allowedPrefixes);
      setBackupRetention(settings.backupRetention ?? null);
      setRuleDraft(settings.allowedPrefixes.join("\n"));
    }).catch(() => undefined);
  }, []);

  const flushCommandOutput = useCallback(() => {
    if (outputFlushTimerRef.current !== null) {
      window.clearTimeout(outputFlushTimerRef.current);
      outputFlushTimerRef.current = null;
    }
    const pending = pendingCommandOutputRef.current;
    pendingCommandOutputRef.current = {};
    const outputByBlock = new Map<string, string>();
    for (const [terminalId, text] of Object.entries(pending)) {
      const blockId = activeCommandBlockRef.current[terminalId];
      if (blockId) outputByBlock.set(blockId, text);
    }
    if (outputByBlock.size === 0) return;
    setCommandBlocks((blocks) => blocks.map((block) => {
      const text = outputByBlock.get(block.id);
      return text ? { ...block, output: appendTerminalOutput(block.output, text, COMMAND_BLOCK_OUTPUT_LIMIT) } : block;
    }));
  }, []);

  const captureTerminalOutput = useCallback((terminalId: string, text: string) => {
    const current = terminalContextRef.current[terminalId] ?? "";
    terminalContextRef.current[terminalId] = appendTerminalOutput(current, text);
    const blockId = activeCommandBlockRef.current[terminalId];
    if (!blockId) return;
    const pending = pendingCommandOutputRef.current;
    pending[terminalId] = appendTerminalOutput(pending[terminalId] ?? "", text, COMMAND_BLOCK_OUTPUT_LIMIT);
    if (outputFlushTimerRef.current === null) {
      outputFlushTimerRef.current = window.setTimeout(flushCommandOutput, COMMAND_OUTPUT_BATCH_MS);
    }
  }, [flushCommandOutput]);

  const startCommandBlock = useCallback((terminalId: string, command: string) => {
    flushCommandOutput();
    const id = crypto.randomUUID();
    const previous = activeCommandBlockRef.current[terminalId];
    const pendingCompletion = commandCompletionRef.current[terminalId];
    if (pendingCompletion) {
      clearTimeout(pendingCompletion.timer);
      delete commandCompletionRef.current[terminalId];
      pendingCompletion.resolve(null);
    }
    activeCommandBlockRef.current[terminalId] = id;
    const shell = tabs.find((tab) => tab.id === terminalId)?.shell ?? "powershell";
    if (command !== "Comando editado en el shell; texto no capturado") {
      setCommandHistory((history) => [...history, { id, terminalId, command, shell }].slice(-MAX_COMMAND_HISTORY));
    }
    setCommandBlocks((blocks) => [
      ...blocks.map((block) => block.id === previous ? { ...block, status: "finished" as const } : block),
      { id, terminalId, command, output: "", status: "running" as const, exitCode: null },
    ].slice(-MAX_COMMAND_BLOCKS));
  }, [flushCommandOutput, tabs]);

  const finishCommandBlock = useCallback((terminalId: string, exitCode: number | null, force = false) => {
    const completion = commandCompletionRef.current[terminalId];
    if (completion?.requiresAgentToken && !force) return;
    flushCommandOutput();
    const id = activeCommandBlockRef.current[terminalId];
    if (!id) return;
    setCommandBlocks((blocks) => blocks.map((block) => block.id === id ? { ...block, status: "finished", exitCode } : block));
    delete activeCommandBlockRef.current[terminalId];
    if (completion) {
      clearTimeout(completion.timer);
      delete commandCompletionRef.current[terminalId];
      completion.resolve(exitCode);
    }
  }, [flushCommandOutput]);

  const finishAgentCommand = useCallback((terminalId: string, token: string, exitCode: number | null) => {
    const completion = commandCompletionRef.current[terminalId];
    if (!completion?.requiresAgentToken || !completion.token || completion.token !== token || exitCode === null) return;
    finishCommandBlock(terminalId, exitCode, true);
  }, [finishCommandBlock]);

  const activeTab = useMemo(
    () => tabs.find((tab) => tab.id === activeTabId) ?? tabs[0],
    [activeTabId, tabs],
  );
  const activeTheme = themes.find((theme) => theme.id === themeId) ?? themes[0];
  const visibleBlocks = commandBlocks.filter((block) => block.terminalId === activeTabId).slice(-30).reverse();
  const quickActions = messages.palette.quickActions;
  const paletteActions = [
    { id: "new-terminal", ...quickActions.newTerminal, run: () => addTerminal("powershell") },
    { id: "project", ...(projectPath ? quickActions.projectChange : quickActions.projectOpen), run: () => { void openProject(); } },
    { id: "git", ...quickActions.git, run: () => setGitPanelOpen(true) },
    { id: "settings", ...quickActions.settings, run: openSettings },
    { id: "provider", ...quickActions.provider, run: () => { setReturnToSettings(false); setProviderDialogOpen(true); } },
    { id: "appearance", ...quickActions.appearance, run: () => { setReturnToSettings(false); setAppearanceOpen(true); } },
    { id: "recipes", ...quickActions.recipes, run: () => setTaskRecipesOpen(true) },
    { id: "help", ...quickActions.help, run: () => setHelpOpen(true) },
    { id: "notifications", ...quickActions.notifications, run: () => setNotificationsOpen(true) },
    { id: "blocks", ...quickActions.blocks, run: () => setBlocksOpen((open) => !open) },
    ...tabs.map((tab) => ({ id: `tab-${tab.id}`, label: quickActions.tab.label.replace("{title}", tab.title), description: `${shellNames[tab.shell]} · ${tab.cwd ?? quickActions.tab.home}`, run: () => selectTab(tab.id) })),
  ];
  const editingHasApiKey = providers.some((item) => item.id === editingProviderId && item.hasApiKey);

  useEffect(() => {
    writeProjectWorkspace(localStorage, projectWorkspace);
  }, [projectWorkspace]);

  useEffect(() => {
    const root = document.documentElement;
    const colors = themeVariables(activeTheme, appearance);
    root.dataset.theme = activeTheme.id;
    root.dataset.mode = appearance;
    root.style.setProperty("--theme-accent", colors.accent);
    root.style.setProperty("--theme-accent-hover", colors.hover);
    root.style.setProperty("--theme-accent-strong", colors.strong);
    root.style.setProperty("--theme-accent-muted", colors.muted);
    localStorage.setItem("laural.theme", activeTheme.id);
    localStorage.setItem("laural.appearance", appearance);
  }, [activeTheme, appearance]);

  useEffect(() => {
    localStorage.setItem("laural.assistant-visible.v1", String(assistantVisible));
  }, [assistantVisible]);

  useEffect(() => {
    localStorage.setItem(POWERSHELL_PREDICTION_KEY, String(powerShellPredictionEnabled));
  }, [powerShellPredictionEnabled]);

  useEffect(() => () => {
    if (outputFlushTimerRef.current !== null) window.clearTimeout(outputFlushTimerRef.current);
  }, []);

  useEffect(() => {
    if (!workspaceMenuOpen) return;
    const closeOnOutsideClick = (event: MouseEvent) => {
      if (event.target instanceof Node && !workspaceMenuRef.current?.contains(event.target)) setWorkspaceMenuOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setWorkspaceMenuOpen(false);
    };
    document.addEventListener("mousedown", closeOnOutsideClick);
    window.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("mousedown", closeOnOutsideClick);
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [workspaceMenuOpen]);

  useEffect(() => {
    if (!profileMenuOpen) return;
    const closeOnOutsideClick = (event: MouseEvent) => {
      if (event.target instanceof Node && !profileMenuRef.current?.contains(event.target)) setProfileMenuOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setProfileMenuOpen(false);
    };
    document.addEventListener("mousedown", closeOnOutsideClick);
    window.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("mousedown", closeOnOutsideClick);
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [profileMenuOpen]);

  useEffect(() => {
    if (!terminalMoreOpen) return;
    const closeOnOutsideClick = (event: MouseEvent) => {
      if (event.target instanceof Node && !terminalMoreRef.current?.contains(event.target)) setTerminalMoreOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setTerminalMoreOpen(false);
    };
    document.addEventListener("mousedown", closeOnOutsideClick);
    window.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("mousedown", closeOnOutsideClick);
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [terminalMoreOpen]);

  useEffect(() => {
    if (!appMenuOpen) return;
    const closeOnOutsideClick = (event: MouseEvent) => {
      if (event.target instanceof Node && !appMenuRef.current?.contains(event.target)) setAppMenuOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setAppMenuOpen(false);
        appMenuButtonRef.current?.focus();
      }
    };
    document.addEventListener("mousedown", closeOnOutsideClick);
    window.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("mousedown", closeOnOutsideClick);
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [appMenuOpen]);

  useEffect(() => {
    if (appMenuOpen) appMenuRef.current?.querySelector<HTMLButtonElement>('[role="menuitem"]')?.focus();
  }, [appMenuOpen]);

  function navigateAppMenu(event: React.KeyboardEvent<HTMLDivElement>) {
    if (!(["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key))) return;
    const items = [...(appMenuRef.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]') ?? [])];
    if (items.length === 0) return;
    event.preventDefault();
    const currentIndex = items.indexOf(document.activeElement as HTMLButtonElement);
    const nextIndex = event.key === "Home"
      ? 0
      : event.key === "End"
        ? items.length - 1
        : (currentIndex + (event.key === "ArrowDown" ? 1 : -1) + items.length) % items.length;
    items[nextIndex].focus();
  }

  function addTerminal(shell: Shell, cwd: string | null = projectPath) {
    if (tabs.length >= MAX_OPEN_TERMINALS) {
      setTerminalActionNotice(appText.terminalLimit.replace("{count}", String(MAX_OPEN_TERMINALS)));
      return;
    }
    const count = tabs.filter((tab) => tab.shell === shell).length + 1;
    const title = count === 1 ? shellNames[shell] : `${shellNames[shell]} ${count}`;
    const nextTab = { id: crypto.randomUUID(), shell, title, cwd };
    setTabs((current) => [...current, nextTab]);
    setActiveTabId(nextTab.id);
    setShellMenuOpen(false);
  }

  function resetProjectContext() {
    setContextFiles([]);
    setGitDiffContext("");
    setGitDiffTruncated(false);
    setContextPreview(null);
    setContextPreviewError("");
  }

  function openProjectTerminal(path: string): boolean {
    const existing = tabs.find(tab => tab.cwd && projectPathIdentity(tab.cwd) === projectPathIdentity(path));
    if (existing) {
      setActiveTabId(existing.id);
      return true;
    }
    if (tabs.length >= MAX_OPEN_TERMINALS) {
      setTerminalActionNotice(appText.terminalLimit.replace("{count}", String(MAX_OPEN_TERMINALS)));
      return false;
    }
    addTerminal(activeTab?.shell ?? "powershell", path);
    return true;
  }

  function activateProject(path: string): boolean {
    if (!openProjectTerminal(path)) return false;
    setProjectWorkspace(current => addProjectPath(current, path));
    resetProjectContext();
    return true;
  }

  function removeProject(path: string) {
    const wasActive = projectPath !== null && projectPathIdentity(projectPath) === projectPathIdentity(path);
    const next = removeProjectPath(projectWorkspace, path);
    if (wasActive && next.activePath) {
      const existing = tabs.find(tab => tab.cwd && projectPathIdentity(tab.cwd) === projectPathIdentity(next.activePath!));
      if (existing) setActiveTabId(existing.id);
      else if (tabs.length < MAX_OPEN_TERMINALS) addTerminal(activeTab?.shell ?? "powershell", next.activePath);
      else next.activePath = null;
    }
    setProjectWorkspace(next);
    if (wasActive) resetProjectContext();
  }

  async function openProject() {
    try {
      const selected = await open({ directory: true, multiple: false });
      if (typeof selected !== "string") return;
      activateProject(selected);
    } catch (error) {
      setProviderError(appText.openFolderError.replace("{error}", String(error)));
      setProviderDialogOpen(true);
    }
  }

  async function addContextFiles() {
    try {
      const selected = await open({ multiple: true, directory: false });
      const paths = Array.isArray(selected) ? selected : selected ? [selected] : [];
      if (paths.length) setContextFiles((current) => [...new Set([...current, ...paths])].slice(0, 12));
    } catch (error) {
      setProviderError(appText.attachFilesError.replace("{error}", String(error)));
      setProviderDialogOpen(true);
    }
  }

  const releaseTabContext = useCallback((tabId: string) => {
    finishCommandBlock(tabId, null);
    delete terminalContextRef.current[tabId];
    setCommandBlocks(blocks => blocks.filter(block => block.terminalId !== tabId));
  }, [finishCommandBlock]);

  const restartTab = useCallback((tabId: string) => {
    releaseTabContext(tabId);
    const id = crypto.randomUUID();
    setTabs(current => current.map(tab => tab.id === tabId ? { ...tab, id } : tab));
    setActiveTabId(current => current === tabId ? id : current);
    setSplitTabId(current => current === tabId ? id : current);
  }, [releaseTabContext]);

  function selectTab(tabId: string) {
    if (splitTabId === tabId) setSplitTabId(activeTabId);
    setActiveTabId(tabId);
    const selected = tabs.find(tab => tab.id === tabId);
    const matchingProject = selected?.cwd
      ? projectPaths.find(path => projectPathIdentity(path) === projectPathIdentity(selected.cwd!))
      : undefined;
    if (matchingProject && (!projectPath || projectPathIdentity(matchingProject) !== projectPathIdentity(projectPath))) {
      setProjectWorkspace(current => ({ ...current, activePath: matchingProject }));
      resetProjectContext();
    }
  }

  function closeTab(tabId: string) {
    releaseTabContext(tabId);
    const nextTabs = tabs.filter((tab) => tab.id !== tabId);
    if (splitTabId === tabId || tabId === activeTabId) { setSplitTabId(null); setSplitOrientation(null); }
    if (nextTabs.length === 0) {
      const replacement = { id: crypto.randomUUID(), shell: "powershell" as Shell, title: "PowerShell", cwd: projectPath };
      setTabs([replacement]);
      setActiveTabId(replacement.id);
      return;
    }
    setTabs(nextTabs);
    if (activeTabId === tabId && nextTabs.length > 0) {
      setActiveTabId(nextTabs[nextTabs.length - 1].id);
    }
  }

  function toggleSplit() {
    if (splitTabId) {
      if (splitOrientation === "vertical") setSplitOrientation("horizontal");
      else { setSplitTabId(null); setSplitOrientation(null); }
      return;
    }
    const shell = activeTab?.shell ?? "powershell";
    const count = tabs.filter((tab) => tab.shell === shell).length + 1;
    const nextTab = {
      id: crypto.randomUUID(),
      shell,
      title: count === 1 ? shellNames[shell] : `${shellNames[shell]} ${count}`,
      cwd: activeTab?.cwd ?? projectPath,
    };
    setTabs((current) => [...current, nextTab]);
    setSplitTabId(nextTab.id);
    setSplitOrientation("vertical");
  }

  function submitPrompt(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const question = prompt.trim();
    if (!question || chatBusy || agentPlanBusy || agentCommandBusy) return;
    if (!provider) {
      setProviderDialogOpen(true);
      return;
    }
    if (agentMode) {
      const clarification = agentClarificationRef.current;
      agentClarificationRef.current = null;
      const agentTask = clarification
        ? `Tarea original: ${clarification.task}\n\nAclaración solicitada: ${clarification.question}\n\nRespuesta del usuario: ${question}`
        : question;
      setPrompt("");
      setAgentPlan(null);
      setAgentPlanProjectPath(projectPath);
      setAgentPlanBusy(true);
      const requestId = crypto.randomUUID();
      activeAgentRequestRef.current = requestId;
      agentStopRequestedRef.current = false;
      setChatMessages((current) => limitChatMessages([...current, { role: "user", content: question }]));
      const planTerminalId = activeTabId;
      const shell = activeTab?.shell ?? "powershell";
      void invoke<AgentPlan>("plan_agent", {
        requestId,
        task: agentTask,
        shell,
        terminalContext: terminalContextRef.current[planTerminalId] ?? "",
        projectPath,
        selectedFiles: contextFiles,
        gitDiffContext,
      }).then(async (plan) => {
        if (agentStopRequestedRef.current) {
          setAgentPlanProjectPath(null);
          return;
        }
        const prepared: AgentPlan = { ...plan, actions: plan.actions.map((action) => ({ ...action, status: "pending" })) };
        agentClarificationRef.current = plan.clarifyingQuestion ? { task: agentTask, question: plan.clarifyingQuestion } : null;
        setAgentPlan(prepared);
        const statusMessage = plan.clarifyingQuestion
          ? appText.agentNeedsClarification.replace("{question}", plan.clarifyingQuestion)
          : appText.agentPlanPrepared.replace("{count}", String(plan.actions.length));
        setChatMessages((current) => limitChatMessages([...current, { role: "assistant", content: statusMessage }]));
        if (executionMode !== "review") {
          for (let index = 0; index < prepared.actions.length; index += 1) {
            if (agentStopRequestedRef.current) break;
            if (prepared.actions[index].type === "run_command") {
              const completed = await executeAgentCommand(index, false, prepared, planTerminalId);
              if (!completed) {
                if (!agentStopRequestedRef.current) setChatMessages((current) => limitChatMessages([...current, { role: "assistant", content: appText.agentSequenceStopped }]));
                break;
              }
            }
          }
          if (agentStopRequestedRef.current) setChatMessages((current) => limitChatMessages([...current, { role: "assistant", content: appText.agentExecutionStopped }]));
        }
      }).catch((error) => {
        setAgentPlanProjectPath(null);
        setChatMessages((current) => limitChatMessages([...current, { role: "assistant", content: agentStopRequestedRef.current ? appText.agentPlanningCancelled : appText.agentPlanFailed.replace("{error}", String(error)) }]));
      }).finally(() => {
        if (activeAgentRequestRef.current === requestId) activeAgentRequestRef.current = null;
        setAgentPlanBusy(false);
      });
      return;
    }
    const requestId = crypto.randomUUID();
    const assistantMessageId = crypto.randomUUID();
    const nextMessages = limitChatMessages([...chatMessages, { role: "user" as const, content: question }, { role: "assistant" as const, content: "", id: assistantMessageId }]);
    setChatMessages(nextMessages);
    setPrompt("");
    setChatBusy(true);
    streamingContentRef.current?.clear();
    setStreamingMessageId(assistantMessageId);
    activeChatRequestRef.current = requestId;
    let unlisten: (() => void) | undefined;
    let pendingDelta = "";
    let deltaTimer: number | undefined;
    let streamFailed = false;
    let hasPublishedStreamContent = false;
    const publishStreamContent = () => {
      hasPublishedStreamContent = true;
      const content = streamingContentRef.current?.snapshot() ?? "";
      setChatMessages((current) => {
        let changed = false;
        const next = current.map((message) => {
          if (message.id !== assistantMessageId || message.content === content) return message;
          changed = true;
          return { ...message, content };
        });
        return changed ? next : current;
      });
    };
    const flushDelta = (forceUiFlush = false) => {
      if (deltaTimer !== undefined) {
        window.clearTimeout(deltaTimer);
        deltaTimer = undefined;
      }
      if (pendingDelta) {
        streamingContentRef.current?.append(pendingDelta);
        pendingDelta = "";
      }
      if (forceUiFlush) {
        publishStreamContent();
        return;
      }
      if (!hasPublishedStreamContent) publishStreamContent();
    };
    const queueDelta = (delta: string) => {
      pendingDelta += delta;
      if (deltaTimer === undefined) deltaTimer = window.setTimeout(flushDelta, CHAT_DELTA_BATCH_MS);
    };
    void listen<{ requestId: string; delta: string }>("chat-stream-delta", (event) => {
      if (event.payload.requestId !== requestId) return;
      queueDelta(event.payload.delta);
    }).then((stopListening) => {
      unlisten = stopListening;
      return invoke("send_chat_stream", {
      requestId,
      messages: prepareChatHistoryForRequest(nextMessages.slice(0, -1)),
      terminalContext: terminalContextRef.current[activeTabId] ?? "",
      projectPath,
      selectedFiles: contextFiles,
      gitDiffContext,
      });
    }).catch((error) => {
      flushDelta(true);
      streamFailed = true;
      const message = String(error);
      setChatMessages((current) => current.map((item) => item.id === assistantMessageId ? { ...item, content: item.content ? `${item.content}\n\n[${message}]` : appText.assistantRequestFailed.replace("{error}", message) } : item));
    }).finally(() => {
      if (!streamFailed) flushDelta(true);
      unlisten?.();
      activeChatRequestRef.current = null;
      setChatBusy(false);
      setStreamingMessageId(null);
    });
  }

  async function stopChat() {
    const requestId = activeChatRequestRef.current;
    if (requestId) await invoke("cancel_chat_stream", { requestId }).catch(() => undefined);
  }

  async function stopAgent() {
    agentStopRequestedRef.current = true;
    const requestId = activeAgentRequestRef.current;
    if (requestId) await invoke("cancel_agent_plan", { requestId }).catch(() => undefined);
    const terminalId = activeAgentTerminalRef.current;
    if (terminalId) await invoke("write_terminal", { terminalId, data: "\u0003" }).catch(() => undefined);
  }

  function clearChat() {
    setChatMessages([]);
    setAgentPlan(null);
    setAgentPlanProjectPath(null);
    agentClarificationRef.current = null;
    localStorage.removeItem("laural.chat.v1");
  }

  async function openContextPreview() {
    setContextPreviewBusy(true);
    setContextPreviewError("");
    try {
      setContextPreview(await invoke<ContextPreview>("preview_context", {
        terminalContext: terminalContextRef.current[activeTabId] ?? "",
        projectPath,
        selectedFiles: contextFiles,
        gitDiffContext,
      }));
    } catch (error) {
      setContextPreviewError(String(error));
    } finally {
      setContextPreviewBusy(false);
    }
  }

  function updateAgentAction(index: number, update: Partial<PlanAction>) {
    setAgentPlan((current) => {
      if (!current) return current;
      const actions = [...current.actions];
      actions[index] = { ...actions[index], ...update } as PlanAction;
      return { ...current, actions };
    });
  }

  async function executeAgentCommand(index: number, approved: boolean, plan = agentPlan, terminalId = activeTabId): Promise<boolean> {
    const action = plan?.actions[index];
    if (!action || action.type !== "run_command") return false;
    setAgentCommandBusy(true);
    activeAgentTerminalRef.current = terminalId;
    startCommandBlock(terminalId, action.command);
    let completionResolve: (exitCode: number | null) => void = () => undefined;
    const completion = new Promise<number | null>((resolve) => { completionResolve = resolve; });
    const completionToken = crypto.randomUUID();
    const timer = setTimeout(() => finishCommandBlock(terminalId, null, true), 120_000);
    commandCompletionRef.current[terminalId] = { resolve: completionResolve, timer, requiresAgentToken: true, token: completionToken };
    updateAgentAction(index, { status: "running", result: undefined });
    try {
      await invoke("run_agent_command", { terminalId, command: action.command, approved, completionToken });
      const exitCode = await completion;
      if (agentStopRequestedRef.current) { updateAgentAction(index, { status: "cancelled", result: appText.agentInterrupted }); return false; }
      if (exitCode === 0) { updateAgentAction(index, { status: "completed", result: appText.agentCommandSuccess }); return true; }
      if (exitCode !== null) { updateAgentAction(index, { status: "error", result: appText.agentCommandExit.replace("{code}", String(exitCode)) }); return false; }
      updateAgentAction(index, { status: "submitted", result: appText.agentCommandSubmitted });
      return false;
    } catch (error) {
      clearTimeout(timer);
      delete commandCompletionRef.current[terminalId];
      const message = String(error);
      const status = message.toLowerCase().includes("requiere") || message.toLowerCase().includes("coincide") ? "needs_review" : "error";
      updateAgentAction(index, { status, result: message });
      return false;
    } finally {
      activeAgentTerminalRef.current = null;
      setAgentCommandBusy(false);
    }
  }

  async function applyAgentFile(index: number) {
    const action = agentPlan?.actions[index];
    const targetProjectPath = agentPlanProjectPath;
    if (!action || action.type !== "write_file" || !targetProjectPath) return;
    updateAgentAction(index, { status: "applying", result: undefined });
    try {
      const result = await invoke<string>("apply_agent_file", {
        projectPath: targetProjectPath,
        relativePath: action.path,
        content: action.content,
        approved: true,
      });
      updateAgentAction(index, { status: "applied", result });
    } catch (error) {
      updateAgentAction(index, { status: "error", result: String(error) });
    }
  }

  async function showBackups(index: number, path: string) {
    const targetProjectPath = agentPlanProjectPath;
    if (!targetProjectPath) return;
    try {
      const versions = await invoke<string[]>("list_agent_backups", { projectPath: targetProjectPath, relativePath: path });
      setBackupVersions(current => ({ ...current, [index]: versions }));
      if (versions[0]) setSelectedBackups(current => ({ ...current, [index]: versions[0] }));
      else updateAgentAction(index, { result: appText.noBackupsForFile });
    } catch (error) { updateAgentAction(index, { result: String(error) }); }
  }

  async function restoreBackup(index: number, path: string) {
    const version = selectedBackups[index];
    const targetProjectPath = agentPlanProjectPath;
    if (!targetProjectPath || !version || !window.confirm(appText.restoreBackupConfirm.replace("{path}", path).replace("{version}", version))) return;
    try {
      const result = await invoke<string>("restore_agent_backup", { projectPath: targetProjectPath, relativePath: path, version, approved: true });
      updateAgentAction(index, { result });
      await showBackups(index, path);
    } catch (error) { updateAgentAction(index, { result: String(error) }); }
  }
  async function clearBackups(index: number, path: string) {
    const targetProjectPath = agentPlanProjectPath;
    if (!targetProjectPath || !window.confirm(appText.clearBackupsConfirm.replace("{path}", path))) return;
    try {
      const removed = await invoke<number>("clear_agent_backups", { projectPath: targetProjectPath, relativePath: path, approved: true });
      setBackupVersions(current => ({ ...current, [index]: [] }));
      updateAgentAction(index, { result: appText.backupsRemoved.replace("{count}", String(removed)) });
    } catch (error) { updateAgentAction(index, { result: String(error) }); }
  }
  async function changeExecutionMode(mode: ExecutionMode) {
    setExecutionMode(mode);
    setPolicyNotice("");
    try {
      await invoke("save_agent_settings", { settings: { mode, allowedPrefixes, backupRetention } });
      setPolicyNotice(appText.policySaved);
    } catch (error) {
      setPolicyNotice(appText.policySaveError.replace("{error}", String(error)));
    }
  }

  async function saveExecutionRules() {
    const prefixes = ruleDraft.split(/\r?\n/).map((item) => item.trim()).filter(Boolean);
    setAllowedPrefixes(prefixes);
    try {
      await invoke("save_agent_settings", { settings: { mode: executionMode, allowedPrefixes: prefixes, backupRetention } });
      setPolicyNotice(appText.rulesSaved);
    } catch (error) {
      setPolicyNotice(appText.rulesSaveError.replace("{error}", String(error)));
    }
  }

  async function changeBackupRetention(value: number | null) {
    setBackupRetention(value);
    setPolicyNotice("");
    try {
      await invoke("save_agent_settings", { settings: { mode: executionMode, allowedPrefixes, backupRetention: value } });
      setPolicyNotice(appText.retentionSaved);
    } catch (error) {
      setPolicyNotice(appText.policySaveError.replace("{error}", String(error)));
    }
  }

  function chooseProvider(kind: string) {
    setProviderKind(kind);
    setShareCustomEndpoint(false);
    setApiKey("");
    setModels([]);
    setEditingProviderId(null);
    setProviderError("");
    setProviderNotice("");
    if (kind === "ollama") {
      setProviderName("Ollama"); setBaseUrl("http://127.0.0.1:11434/v1"); setModel("");
    } else if (kind === "lmstudio") {
      setProviderName("LM Studio"); setBaseUrl("http://127.0.0.1:1234/v1"); setModel("");
    } else if (kind === "freellmapi") {
      setProviderName("FreeLLMAPI"); setBaseUrl("http://127.0.0.1:31415/v1"); setModel("auto");
    } else {
      setProviderName(appText.otherEndpoint); setBaseUrl(""); setModel("");
    }
  }

  function providerInput() {
    return {
      input: {
        id: editingProviderId ?? crypto.randomUUID(),
        providerKind,
        name: providerName,
        baseUrl,
        model,
        apiKey: apiKey.trim() || null,
        shareCustomEndpoint,
      },
    };
  }

  async function testProvider() {
    setProviderBusy(true); setProviderError(""); setProviderNotice("");
    try {
      const found = await invoke<string[]>("test_provider", providerInput());
      setModels(found);
      if (!found.includes(model)) setModel(found.includes("auto") ? "auto" : found[0]);
      setProviderNotice(appText.providerConnectionSuccess.replace("{count}", String(found.length)));
    } catch (error) {
      setProviderError(String(error));
    } finally {
      setProviderBusy(false);
    }
  }

  async function saveProvider() {
    setProviderBusy(true); setProviderError(""); setProviderNotice("");
    try {
      const saved = await invoke<Provider>("save_provider", providerInput());
      loadProviderIntoForm(saved);
      setProviders(await invoke<Provider[]>("get_providers"));
      setApiKey("");
      setProviderNotice(appText.providerSavedLocal);
      closeProviderDialog();
      schedulePreferenceSync();
    } catch (error) {
      setProviderError(String(error));
    } finally {
      setProviderBusy(false);
    }
  }

  async function selectSavedProvider(id: string) {
    if (!id) return;
    setProviderBusy(true); setProviderError(""); setProviderNotice("");
    try {
      const saved = await invoke<Provider>("select_provider", { providerId: id });
      loadProviderIntoForm(saved);
      setApiKey("");
      setProviderNotice(appText.providerActivated);
      schedulePreferenceSync();
    } catch (error) {
      setProviderError(String(error));
    } finally {
      setProviderBusy(false);
    }
  }

  function newProviderProfile() {
    setEditingProviderId(null);
    setProviderKind("custom"); setShareCustomEndpoint(false); setProviderName(appText.newProviderName); setBaseUrl(""); setModel(""); setApiKey(""); setModels([]);
    setProviderError(""); setProviderNotice("");
  }

  function closeProviderDialog() {
    setProviderDialogOpen(false);
    setApiKey("");
    setProviderError("");
    returnFromSettingsChild();
  }

  function openSettings() {
    setReturnToSettings(false);
    setSettingsOpen(true);
  }

  function closeSettings() {
    setSettingsOpen(false);
    setReturnToSettings(false);
  }

  function openSettingsChild(open: (value: boolean) => void) {
    setReturnToSettings(true);
    setSettingsOpen(false);
    open(true);
  }

  function returnFromSettingsChild() {
    if (!returnToSettings) return;
    setReturnToSettings(false);
    setSettingsOpen(true);
  }

  function closeSettingsChild(close: (value: boolean) => void) {
    close(false);
    returnFromSettingsChild();
  }

  return (
    <main className="app-shell">
      <aside className="sidebar">
        <div className="brand-row">
          <div className="brand-mark" aria-hidden="true"><span /><span /></div>
          <span className="brand-name">Laural</span>
          <div className="app-menu-wrap" ref={appMenuRef}>
            <button ref={appMenuButtonRef} className="icon-button sidebar-menu" aria-label={appText.menuOpen} aria-expanded={appMenuOpen} aria-haspopup="menu" aria-controls="app-menu" onClick={() => setAppMenuOpen((open) => !open)}><DotsIcon /></button>
            {appMenuOpen && <div className="app-menu" id="app-menu" role="menu" aria-label={appText.menuLabel} onKeyDown={navigateAppMenu}>
              <button role="menuitem" onClick={() => { setAppMenuOpen(false); addTerminal("powershell"); }}>{appText.newTerminal}</button>
              <button role="menuitem" onClick={() => { setAppMenuOpen(false); void openProject(); }}>{appText.openProject}</button>
              <button role="menuitem" onClick={() => { setAppMenuOpen(false); setCommandPaletteView("all"); setCommandPaletteOpen(true); }}>{appText.searchActions}</button>
              <button role="menuitem" onClick={() => { setAppMenuOpen(false); setReturnToSettings(false); setProviderDialogOpen(true); }}>{appText.configureProvider}</button>
              <button role="menuitem" onClick={() => { setAppMenuOpen(false); openSettings(); }}>{appText.settings}</button>
              <button role="menuitem" onClick={() => { setAppMenuOpen(false); setHelpOpen(true); }}>{appText.help}</button>
            </div>}
          </div>
        </div>
        <div className="workspace-picker-wrap" ref={workspaceMenuRef}>
          <button className="workspace-picker" aria-expanded={workspaceMenuOpen} aria-haspopup="menu" aria-controls="workspace-menu" onClick={() => setWorkspaceMenuOpen((open) => !open)}>
            <span className="workspace-avatar">A</span>
            <span className="workspace-copy"><strong>{appText.workspace}</strong><small>{appText.personalSpace}</small></span>
            <ChevronIcon />
          </button>
          {workspaceMenuOpen && <div className="workspace-menu" id="workspace-menu" role="menu" aria-label={appText.workspace}>
            <p className="workspace-menu-label">{appText.currentSpace}</p>
            <div className="workspace-menu-current"><span className="workspace-avatar">A</span><span><strong>{appText.personalSpace}</strong><small>{appText.onlyThisDevice}</small></span><span className="workspace-menu-check" aria-label={appText.selected}>✓</span></div>
            <p className="workspace-menu-note">{appText.workspaceUnavailable}</p>
            <button role="menuitem" onClick={() => { setWorkspaceMenuOpen(false); void openProject(); }}><FolderIcon /><span>{projectPath ? appText.changeProject : appText.openProject}</span></button>
            <button role="menuitem" onClick={() => { setWorkspaceMenuOpen(false); setReturnToSettings(false); setAccountSettingsOpen(true); }}><SyncIcon /><span>{appText.syncAccount}</span></button>
          </div>}
        </div>
        <nav className="primary-nav" aria-label={appText.primaryNavigation}>
          <button className={`nav-item ${!(commandPaletteOpen && commandPaletteView === "history") ? "active" : ""}`}><TerminalIcon /><span>{appText.terminal}</span><kbd>⌘ 1</kbd></button>
          <button className="nav-item" onClick={() => { setReturnToSettings(false); setProviderDialogOpen(true); }}><SparkIcon /><span>{appText.aiAssistant}</span><span className="nav-dot" /></button>
          <button className={`nav-item ${commandPaletteOpen && commandPaletteView === "history" ? "active" : ""}`} onClick={() => { setCommandPaletteView("history"); setCommandPaletteOpen(true); }}><HistoryIcon /><span>{appText.history}</span></button>
        </nav>
        <div className="sidebar-section">
          <div className="section-label"><span>{appText.projects}</span><button className="quiet-icon" aria-label={appText.addProject} title={appText.addProject} onClick={() => void openProject()}><PlusIcon /></button></div>
          <div className="project-list" role="list" aria-label={appText.projects}>
            {projectPaths.map((path) => {
              const name = path.split(/[\\/]/).filter(Boolean).pop() ?? path;
              const active = projectPath !== null && projectPathIdentity(projectPath) === projectPathIdentity(path);
              return <div className={`project-item ${active ? "active" : ""}`} key={projectPathIdentity(path)} role="listitem">
                <button type="button" className="project-select" aria-current={active ? "true" : undefined} title={path} onClick={() => activateProject(path)}>
                  <span className="project-glyph">{name.slice(0, 1).toUpperCase()}</span><span className="project-name">{name}</span>
                </button>
                <button type="button" className="project-remove" aria-label={appText.removeProject.replace("{project}", name)} title={appText.removeProject.replace("{project}", name)} onClick={() => removeProject(path)}>×</button>
              </div>;
            })}
          </div>
          <button className="add-project" onClick={() => void openProject()}><PlusIcon /><span>{appText.openAProject}</span></button>
        </div>
        <div className="sidebar-spacer" />
        <div className="sidebar-bottom">
          <div className="plan-card">
            <div className="plan-icon"><SparkIcon /></div>
            <div>
              <strong>{provider ? provider.name : appText.connectModel}</strong>
              <p>{provider ? `${appText.model}: ${provider.model || appText.automatic}` : appText.endpointHint}</p>
            </div>
            <button className="plan-arrow" onClick={() => { setReturnToSettings(false); setProviderDialogOpen(true); }} aria-label={appText.configure}><ChevronIcon /></button>
          </div>
          <button className="appearance-entry" onClick={openSettings}><PaletteIcon /><span>{appText.appearance}</span><span className="appearance-entry-meta">{appearance === "dark" ? appText.dark : appText.light}</span></button>
          {syncNotice && <div className="sync-notice" role="status"><span>{syncNotice}</span><button onClick={() => setAccountSettingsOpen(true)}>{appText.reviewSync}</button><button className="sync-notice-close" onClick={clearSyncNotice} aria-label={appText.closeSyncNotice}>×</button></div>}
          <UpdateManager settingsOpen={updateSettingsOpen} onSettingsOpen={() => { setReturnToSettings(false); setUpdateSettingsOpen(true); }} onSettingsClose={() => closeSettingsChild(setUpdateSettingsOpen)} />
          <div className="profile-menu-wrap" ref={profileMenuRef}>
            <button className="profile-row" aria-expanded={profileMenuOpen} aria-haspopup="menu" aria-controls="profile-menu" onClick={() => setProfileMenuOpen((open) => !open)}><span className="profile-avatar">AM</span><span className="profile-name">{appText.localProfile}</span><DotsIcon /></button>
            {profileMenuOpen && <div className="profile-menu" id="profile-menu" role="menu" aria-label={appText.profileOptions}>
              <p className="profile-menu-label">{appText.localProfile.toUpperCase()}</p>
              <p className="profile-menu-description">{appText.profileDescription}</p>
              <button role="menuitem" onClick={() => { setProfileMenuOpen(false); openSettings(); }}>{appText.settings}</button>
              <button role="menuitem" onClick={() => { setProfileMenuOpen(false); setReturnToSettings(false); setTransferOpen(true); }}>{appText.transfer}</button>
              <button role="menuitem" onClick={() => { setProfileMenuOpen(false); setReturnToSettings(false); setAccountSettingsOpen(true); }}>{appText.syncAccount}</button>
            </div>}
          </div>
        </div>
      </aside>

      <section className="main-column">
        <header className="topbar">
          <div className="breadcrumb"><span className="breadcrumb-muted">{appText.workspace}</span><ChevronRightIcon /><strong>{appText.breadcrumbTerminal}</strong></div>
          <div className="topbar-actions">
            <button className="search-button" onClick={() => { setCommandPaletteView("all"); setCommandPaletteOpen(true); }}><SearchIcon /><span>{appText.searchCommands}</span><kbd>Ctrl K</kbd></button>
            <button className="icon-button top-icon" aria-label={appText.helpTitle} title={appText.helpTitle} onClick={() => setHelpOpen(true)}><HelpIcon /></button>
            <button className="icon-button top-icon" aria-label={appText.notificationsTitle} title={appText.notificationsTitle} onClick={() => setNotificationsOpen(true)}><BellIcon /></button>
          </div>
        </header>

        <div className="terminal-toolbar">
          <div className="tabs-strip" role="tablist" aria-label={appText.sessions}>
            {tabs.map((tab) => <button className={`terminal-tab ${tab.id === activeTabId ? "selected" : ""}`} key={tab.id} onClick={() => selectTab(tab.id)} role="tab" aria-selected={tab.id === activeTabId}>
              <span className={`shell-badge ${tab.shell}`}>{shellIcons[tab.shell]}</span><span>{tab.title}</span>
              <span className="tab-close" role="button" tabIndex={0} aria-label={appText.closeTab.replace("{title}", tab.title)} onClick={(event) => { event.stopPropagation(); closeTab(tab.id); }} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.stopPropagation(); closeTab(tab.id); } }}>×</span>
            </button>)}
            <div className="new-tab-wrap">
              <button className="new-tab-button" aria-label={appText.newTerminal} onClick={() => setShellMenuOpen((open) => !open)}><PlusIcon /></button>
              {shellMenuOpen && <div className="shell-menu">{(Object.keys(shellNames) as Shell[]).map((shell) => <button key={shell} onClick={() => addTerminal(shell)}><span className={`shell-badge ${shell}`}>{shellIcons[shell]}</span><span>{shellNames[shell]}</span></button>)}</div>}
            </div>
          </div>
          <div className="terminal-tools">
            <button className="toolbar-chip" onClick={() => setProviderDialogOpen(true)}><span className={`status-led ${provider ? "connected" : ""}`} /><span>{provider ? `${provider.name} · ${provider.model}` : appText.providerUnconfigured}</span><ChevronIcon /></button>
            <button className="toolbar-icon git-toolbar-button" aria-label={appText.openGit} title={messages.git.readOnly} onClick={() => setGitPanelOpen(true)}><BranchIcon /></button>
            <button className={`toolbar-icon ${splitTabId ? "active" : ""}`} aria-label={splitTabId ? splitOrientation === "vertical" ? appText.splitVertical : appText.splitHorizontal : appText.splitPanel} title={splitTabId ? appText.splitChange.replace("{orientation}", splitOrientation === "vertical" ? appText.vertical : appText.horizontal) : appText.splitTerminal} onClick={toggleSplit}><SplitIcon /></button>
            <button className={`toolbar-icon assistant-toggle ${assistantVisible ? "active" : ""}`} aria-label={assistantVisible ? appText.hideAssistant : appText.showAssistant} aria-pressed={assistantVisible} title={assistantVisible ? appText.hideAssistant : appText.showAssistant} onClick={() => setAssistantVisible((visible) => !visible)}><PanelRightIcon /></button>
            <div className="toolbar-more-wrap" ref={terminalMoreRef}>
              <button className="toolbar-icon" aria-label={appText.terminalMore} aria-expanded={terminalMoreOpen} aria-haspopup="menu" aria-controls="terminal-more-menu" onClick={() => setTerminalMoreOpen((open) => !open)}><DotsIcon /></button>
              {terminalMoreOpen && <div className="toolbar-more-menu" id="terminal-more-menu" role="menu" aria-label={appText.terminalMoreLabel}>
                <button role="menuitem" onClick={() => { setTerminalMoreOpen(false); setGitPanelOpen(true); }}>{appText.openGit}</button>
                <button role="menuitem" onClick={() => { setTerminalMoreOpen(false); setBlocksOpen((open) => !open); }}>{blocksOpen ? appText.hideBlocks : appText.showBlocks}</button>
                <button role="menuitem" onClick={() => { setTerminalMoreOpen(false); setAssistantVisible((visible) => !visible); }}>{assistantVisible ? appText.hideAssistant : appText.showAssistant}</button>
                <button role="menuitem" onClick={() => { setTerminalMoreOpen(false); setProviderDialogOpen(true); }}>{appText.configureProviderShort}</button>
                <button role="menuitem" onClick={() => { setTerminalMoreOpen(false); requestTerminalCopy(); }}>{appText.copySelection}</button>
                <button role="menuitem" onClick={() => { setTerminalMoreOpen(false); requestTerminalClear(); }}>{appText.clearTerminal}</button>
              </div>}
            </div>
          </div>
        </div>

        <div className={`workspace-body ${assistantVisible ? "" : "assistant-hidden"}`}>
          <section className="terminal-area" aria-label={appText.terminal}>
            <div className="terminal-heading">
              <div><div className="terminal-title-line"><span className="terminal-title-mark">⌁</span><h1>{activeTab?.title ?? appText.terminal}</h1><span className="connection-pill"><span /> {appText.connectionLocal}</span></div><p className="terminal-path">{activeTab?.cwd ?? appText.homeDirectory} <span>·</span> {appText.windows}</p></div>
              <div className="terminal-heading-actions"><button className={`small-action ${blocksOpen ? "selected" : ""}`} onClick={() => setBlocksOpen((open) => !open)} aria-pressed={blocksOpen}>{appText.blockHeading} <span className="block-count">{visibleBlocks.length}</span></button><button className="small-action" title={appText.copySelectedTitle} onClick={requestTerminalCopy}><CopyIcon /> {appText.copySelection}</button><button className="small-action" title={appText.clearScreenTitle} onClick={requestTerminalClear}><ClearIcon /> {appText.clearTerminal}</button>{terminalActionNotice && <span className="terminal-action-notice" role="status">{terminalActionNotice}</span>}</div>
            </div>
            <div className={`terminal-frame ${blocksOpen ? "with-blocks" : ""} ${splitTabId ? `is-split split-${splitOrientation}` : ""}`}>
              <Suspense fallback={<div className="terminal-loading" role="status">{appText.terminalLoading}</div>}>
                {tabs.map((tab) => <TerminalPane key={tab.id} terminalId={tab.id} active={tab.id === activeTabId} copyRequest={terminalCopyRequest} clearRequest={terminalClearRequest} onActionNotice={setTerminalActionNotice} onRestart={restartTab} shell={tab.shell} cwd={tab.cwd} powerShellPredictionEnabled={powerShellPredictionEnabled} visible={tab.id === activeTabId || tab.id === splitTabId} theme={activeTheme} appearance={appearance} onTextOutput={captureTerminalOutput} onCommandSubmit={startCommandBlock} onCommandFinish={finishCommandBlock} onAgentCommandFinish={finishAgentCommand} />)}
              </Suspense>
              <div className="terminal-caption"><span className="shortcut-hint"><kbd>Ctrl</kbd> + <kbd>`</kbd> {appText.toggleTerminal}</span><span><span className="activity-pulse" /> {appText.shellConnected}</span></div>
            </div>
            {blocksOpen && <section className="command-blocks-panel" aria-label={appText.commandBlocks}>
              {visibleBlocks.length === 0 ? <p className="blocks-empty">{appText.blocksEmpty}</p> : visibleBlocks.map((block) => {
                return <CommandBlockItem block={block} key={block.id} />;
              })}
            </section>}
            <div className="terminal-footer"><div className="footer-left"><button className="footer-branch" onClick={() => setGitPanelOpen(true)} title={messages.git.title}><BranchIcon /> {messages.git.branch}</button></div><div className="footer-right"><span>UTF-8</span><span>{activeTab?.title ?? "PowerShell"}</span><span>100%</span></div></div>
          </section>

          {assistantVisible && <aside className="assistant-panel">
            <div className="assistant-header"><div className="assistant-heading"><div className="assistant-avatar"><SparkIcon /></div><div><strong>{appText.assistant}</strong><span>{appText.terminalContext}</span></div></div><button className="action-quiet" onClick={clearChat} disabled={chatBusy || agentPlanBusy || agentCommandBusy}>{appText.clearChat}</button></div>
            <div className="mode-switch" role="tablist" aria-label={appText.aiMode}>
              <button className={!agentMode ? "active" : ""} onClick={() => { setAgentMode(false); agentClarificationRef.current = null; }} role="tab" aria-selected={!agentMode}><MessageIcon /> {appText.chat}</button>
              <button className={agentMode ? "active" : ""} onClick={() => setAgentMode(true)} role="tab" aria-selected={agentMode}><AgentIcon /> {appText.agent} <span className="mode-beta">{appText.preview}</span></button>
            </div>
            {agentMode && <div className="agent-mode-actions"><button className="action-quiet" onClick={() => setTaskRecipesOpen(true)}>{appText.recipes}</button><button className="action-quiet" onClick={() => { setSettingsCategory("agent"); openSettings(); }}>{appText.agentPermissions}</button></div>}
            {chatMessages.length === 0 ? <div className="assistant-empty">
              <div className="empty-orbit orbit-one" /><div className="empty-orbit orbit-two" /><div className="empty-spark"><SparkIcon /></div>
              <h2>{agentMode ? appText.agentHeadline : appText.chatHeadline}</h2>
              <p>{agentMode ? projectPath ? appText.agentTaskPrompt : appText.openProjectForAgent : appText.chatPrompt}</p>
              {agentMode && !projectPath && <button className="open-project-cta" onClick={() => void openProject()}>{appText.openAProject}</button>}
              <div className="suggestion-list">
                <button onClick={() => setPrompt(appText.explainOutput)}><span className="suggestion-icon"><InfoIcon /></span><span>{appText.explainOutputLabel}</span><ArrowUpRightIcon /></button>
                <button onClick={() => setPrompt(appText.findError)}><span className="suggestion-icon"><SearchIcon /></span><span>{appText.findErrorLabel}</span><ArrowUpRightIcon /></button>
                <button onClick={() => setPrompt(appText.gitCommand)}><span className="suggestion-icon"><TerminalIcon /></span><span>{appText.generateCommand}</span><ArrowUpRightIcon /></button>
              </div>
            </div> : <div className="message-thread">
              {chatMessages.map((message, index) => <ChatMessageItem key={message.id ?? `${index}-${message.role}`} message={message} isStreaming={message.id === streamingMessageId} streamingContentRef={message.id === streamingMessageId ? streamingContentRef : undefined} />)}
              {agentPlan && <div className="agent-plan-card">
                <div className="agent-plan-header"><span className="plan-icon-small"><AgentIcon /></span><strong>{appText.agentPlan}</strong>{agentPlanProjectPath && <span className="agent-plan-root" title={agentPlanProjectPath}>{agentPlanProjectPath}</span>}{!agentPlan.clarifyingQuestion && <span className="agent-plan-count">{appText.actionsCount.replace("{count}", String(agentPlan.actions.length))}</span>}</div>
                <p className="agent-plan-summary">{agentPlan.clarifyingQuestion ?? agentPlan.summary}</p>
                <div className="agent-action-list">{agentPlan.actions.map((action, index) => <article className={`agent-action ${action.status ?? "pending"}`} key={`${index}-${action.type}`}>
                  <div className="agent-action-top"><span className="action-number">{index + 1}</span><span className="action-type">{action.type === "run_command" ? appText.command : appText.fileChange}</span><span className="action-status">{action.status === "completed" ? appText.completed : action.status === "cancelled" ? appText.stopped : action.status === "submitted" ? appText.sent : action.status === "needs_review" ? appText.review : action.status === "applied" ? appText.applied : action.status === "running" || action.status === "applying" ? appText.running : action.status === "error" ? appText.error : action.status === "rejected" ? appText.discarded : appText.pending}</span></div>
                  <p className="action-reason">{action.reason}</p>
                  {action.type === "run_command" ? <pre className="action-code">{action.command}</pre> : <details className="file-preview"><summary>{action.path}</summary><pre>{action.content}</pre></details>}
                  {action.type === "write_file" && backupVersions[index]?.length ? <div className="backup-controls"><select aria-label={appText.backupVersion} value={selectedBackups[index] ?? ""} onChange={event => setSelectedBackups(current => ({ ...current, [index]: event.currentTarget.value }))}>{backupVersions[index].map(version => <option key={version} value={version}>{version}</option>)}</select><button className="action-quiet" onClick={() => void restoreBackup(index, action.path)}>{appText.restoreBackup}</button><button className="action-quiet" onClick={() => void clearBackups(index, action.path)}>{appText.deleteBackups}</button></div> : null}{action.result && <p className={`action-result ${action.status === "error" || action.status === "needs_review" ? "warning" : ""}`}>{action.result}</p>}
                  <div className="action-buttons">{action.type === "write_file" && action.status === "applied" ? <button className="action-quiet" onClick={() => void showBackups(index, action.path)}>{appText.backups}</button> : null}{action.type === "run_command" ? !["submitted", "completed", "cancelled", "rejected", "running"].includes(action.status ?? "") && <button className="action-primary" onClick={() => void executeAgentCommand(index, true)}>{action.status === "needs_review" ? appText.approveReviewRun : appText.approveRun}</button> : action.status !== "applied" && action.status !== "rejected" && <button className="action-primary" onClick={() => void applyAgentFile(index)} disabled={!agentPlanProjectPath || action.status === "applying"}>{appText.applyChange}</button>}
                    {!(["submitted", "completed", "cancelled", "applied", "rejected", "running", "applying"].includes(action.status ?? "")) && <button className="action-quiet" onClick={() => updateAgentAction(index, { status: "rejected", result: appText.discardedResult })}>{appText.discard}</button>}</div>
                </article>)}</div>
              </div>}
              {(chatBusy || agentPlanBusy || agentCommandBusy) && <div className="typing-indicator"><span /><span /><span /> {agentMode ? agentCommandBusy ? appText.agentWaiting : appText.agentPlanning : appText.modelResponding} {chatBusy && !agentMode && <button className="action-quiet" onClick={() => void stopChat()}>{appText.stop}</button>}{agentMode && <button className="action-quiet" onClick={() => void stopAgent()}>{appText.stopAgent}</button>}</div>}
            </div>}
            <div className="composer-wrap">
              <form className="composer" onSubmit={submitPrompt}>
                <textarea value={prompt} onChange={(event) => setPrompt(event.target.value)} placeholder={agentMode ? appText.agentPlaceholder : appText.chatPlaceholder} rows={3} />
                {(contextFiles.length > 0 || gitDiffContext) && <div className="context-file-list">{contextFiles.map((path) => <button type="button" className="context-file-chip" key={path} title={path} onClick={() => setContextFiles((current) => current.filter((item) => item !== path))}><PaperclipIcon /> {path.split(/[\\/]/).pop()} <span>×</span></button>)}{gitDiffContext && <button type="button" className="context-file-chip" title={appText.removeGitDiff} onClick={() => { setGitDiffContext(""); setGitDiffTruncated(false); }}><BranchIcon /> {appText.selectedGitDiff}{gitDiffTruncated ? ` (${appText.partial})` : ""} <span>×</span></button>}</div>}
                <div className="composer-controls"><div className="composer-left"><button type="button" className="composer-tool" title={appText.attachFiles} onClick={() => void addContextFiles()}><PaperclipIcon /></button><button type="button" className="context-chip" title={appText.contextReviewTitle} onClick={() => void openContextPreview()}><span className="context-indicator" /> {appText.reviewContext}</button>{projectPath && <span className="project-context-chip" title={appText.projectContext}>{appText.project}</span>}<button type="button" className="composer-tool" title={appText.selectModel} onClick={() => setProviderDialogOpen(true)}><ModelIcon /></button></div><button type="submit" className="send-button" aria-label={appText.sendMessage} disabled={!prompt.trim() || chatBusy || agentPlanBusy || agentCommandBusy}><ArrowUpIcon /></button></div>
              </form>
              <div className="composer-note"><span>{agentMode ? appText.agentModePending : provider ? appText.contextWillSend.replace("{provider}", provider.name) : appText.connectToStart}</span><button onClick={() => setProviderDialogOpen(true)}>{provider ? appText.modelSettings : appText.configureModel}</button></div>
            </div>
          </aside>}
        </div>
      </section>

      {contextPreviewError && <div className="dialog-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setContextPreviewError(""); }}><section className="provider-dialog context-error-dialog" role="alertdialog" aria-modal="true"><button className="dialog-close" onClick={() => setContextPreviewError("")} aria-label={appText.close}>×</button><p className="eyebrow">{appText.previewEyebrow}</p><h2>{appText.previewErrorTitle}</h2><p className="dialog-copy">{contextPreviewError}</p></section></div>}

      <Suspense fallback={<div className="context-preview-loading" role="status">{appText.previewOpen}</div>}>
      {gitPanelOpen && <GitPanel projectPath={projectPath} onClose={() => setGitPanelOpen(false)} onOpenProject={() => { setGitPanelOpen(false); void openProject(); }} onIncludeDiff={(content, truncated) => { setGitDiffContext(content); setGitDiffTruncated(truncated); setGitPanelOpen(false); }} />}
      {taskRecipesOpen && <TaskRecipes onClose={() => setTaskRecipesOpen(false)} onUse={(recipePrompt) => { setAgentMode(true); setPrompt(recipePrompt); }} />}
      {commandPaletteOpen && <CommandPalette commands={commandHistory.map((item) => ({ ...item, shell: shellNames[item.shell] }))} actions={paletteActions} view={commandPaletteView} onClose={() => setCommandPaletteOpen(false)} />}
      {helpOpen && <HelpDialog onClose={() => setHelpOpen(false)} onConfigureProvider={() => { setHelpOpen(false); setReturnToSettings(false); setProviderDialogOpen(true); }} onOpenSettings={() => { setHelpOpen(false); openSettings(); }} onOpenPalette={() => { setHelpOpen(false); setCommandPaletteView("all"); setCommandPaletteOpen(true); }} />}
      {notificationsOpen && <NotificationCenter syncNotice={syncNotice} onClose={() => setNotificationsOpen(false)} onOpenUpdates={() => { setNotificationsOpen(false); setReturnToSettings(false); setUpdateSettingsOpen(true); }} onOpenAccount={() => { setNotificationsOpen(false); setReturnToSettings(false); setAccountSettingsOpen(true); }} />}

      {contextPreview && <div className="dialog-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setContextPreview(null); }}>
        <section className="context-preview-dialog" role="dialog" aria-modal="true" aria-labelledby="context-preview-title">
          <button className="dialog-close" onClick={() => setContextPreview(null)} aria-label={appText.close}>×</button>
          <div className="dialog-mark"><PaperclipIcon /></div><p className="eyebrow">{appText.attachedData}</p><h2 id="context-preview-title">{appText.reviewContextTitle}</h2>
          <p className="dialog-copy">{appText.contextWillSendInfo}</p>
          <span className="context-size">{contextPreview.totalCharacters.toLocaleString(language)} {appText.characters}</span>
          {[ [appText.terminalOutput, contextPreview.terminal], [appText.project, contextPreview.project], [appText.selectedFiles, contextPreview.selectedFiles], [appText.selectedGitDiff, contextPreview.gitDiff] ].map(([title, content]) => <details className="context-preview-section" key={title} open={Boolean(content)}>
            <summary>{title}<span>{content ? `${content.length.toLocaleString(language)} ${appText.characters}` : appText.noContent}</span></summary>
            <pre>{content || appText.sourceNotSent}</pre>
          </details>)}
          <div className="provider-actions"><button className="primary-button" onClick={() => setContextPreview(null)}>{appText.done}</button></div>
        </section>
      </div>}

      {contextPreviewBusy && <div className="context-preview-loading" role="status">{appText.preparingPreview}</div>}

      {providerDialogOpen && <div className="dialog-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) closeProviderDialog(); }}>
        <section className="provider-dialog" role="dialog" aria-modal="true" aria-labelledby="provider-title">
          <button className="dialog-close" onClick={closeProviderDialog} aria-label={appText.close}>×</button>
          <div className="dialog-mark"><SparkIcon /></div><p className="eyebrow">{appText.localSettings}</p><h2 id="provider-title">{appText.connectProvider}</h2>
          <p className="dialog-copy">{appText.providerInfo}</p>
          <div className="form-row">
            <label className="form-label">{appText.savedProfiles}
              <select value={editingProviderId ?? ""} onChange={(event) => event.currentTarget.value ? void selectSavedProvider(event.currentTarget.value) : newProviderProfile()} disabled={providerBusy}>
                <option value="">{appText.newProfile}</option>{providers.map((item) => <option key={item.id} value={item.id}>{item.name} · {item.model}</option>)}
              </select>
            </label>
            <button className="secondary-button model-refresh" onClick={newProviderProfile} disabled={providerBusy}>{appText.new}</button>
          </div>
          <label className="form-label">{appText.providerType}
            <select value={providerKind} onChange={(event) => chooseProvider(event.currentTarget.value)}>
              <option value="freellmapi">FreeLLMAPI</option><option value="ollama">Ollama</option><option value="lmstudio">LM Studio</option><option value="custom">{appText.otherEndpoint}</option>
            </select>
          </label>
          <label className="form-label">{appText.name}
            <input value={providerName} onChange={(event) => setProviderName(event.currentTarget.value)} placeholder={appText.myProvider} />
          </label>
          <label className="form-label">{appText.baseUrl}
            <input readOnly={editingProviderId !== null} title={editingProviderId ? appText.changeDestinationHint : undefined} value={baseUrl} onChange={(event) => setBaseUrl(event.currentTarget.value)} placeholder="http://127.0.0.1:1234/v1" autoCapitalize="off" autoCorrect="off" />
          </label>
          <label className="transfer-check"><input type="checkbox" checked={shareCustomEndpoint} onChange={(event) => setShareCustomEndpoint(event.currentTarget.checked)} /> {appText.shareEndpoint}</label>
          <p className="dialog-copy">{appText.shareEndpointInfo}</p>
          <div className="form-row">
            <label className="form-label">{appText.model}
              <input value={model} onChange={(event) => setModel(event.currentTarget.value)} list="provider-model-list" placeholder={appText.selectOrTypeModel} autoCapitalize="off" autoCorrect="off" />
              <datalist id="provider-model-list">{models.map((item) => <option key={item} value={item} />)}</datalist>
            </label>
            <button className="secondary-button model-refresh" onClick={() => void testProvider()} disabled={providerBusy}>{appText.test}</button>
          </div>
          <label className="form-label">{appText.apiKey} <span className="optional-label">{appText.localOptional}</span>
            <input type="password" value={apiKey} onChange={(event) => setApiKey(event.currentTarget.value)} placeholder={editingHasApiKey ? appText.savedKeyHint : appText.pasteNewKey} autoComplete="new-password" />
          </label>
          {providerError && <div className="form-message error">{providerError}</div>}
          {providerNotice && <div className="form-message success">{providerNotice}</div>}
          <div className="provider-actions"><button className="secondary-button" onClick={() => void testProvider()} disabled={providerBusy}>{providerBusy ? appText.connecting : appText.testModels}</button><button className="primary-button" onClick={() => void saveProvider()} disabled={providerBusy || !model.trim()}>{providerBusy ? appText.saving : appText.saveProvider}</button></div>
          <div className="dialog-footnote"><LockIcon /> {appText.keyStorage}</div>
        </section>
      </div>}

      {settingsOpen && <SettingsDialog
        activeCategory={settingsCategory}
        onCategoryChange={setSettingsCategory}
        onClose={closeSettings}
        sections={{
          personalization: <section className="settings-section" aria-labelledby="settings-personalization-title">
            <h3 id="settings-personalization-title">{messages.settings.categories.personalization}</h3>
            <p>{messages.settings.personalization.description}</p>
            <button className="settings-link" onClick={() => openSettingsChild(setAppearanceOpen)}>{messages.settings.personalization.appearance} <span>{messages.appearance.themeNames[activeTheme.id as keyof typeof messages.appearance.themeNames]} · {appearance === "dark" ? messages.appearance.dark : messages.appearance.light}</span></button>
            <label className="settings-field">
              <span>{messages.settings.personalization.language}<small>{messages.settings.personalization.languageDescription}</small></span>
              <select aria-label={messages.settings.personalization.language} value={language} onChange={(event) => setLanguage(event.currentTarget.value === "en" ? "en" : "es")}>
                <option value="es">{messages.settings.personalization.spanish}</option>
                <option value="en">{messages.settings.personalization.english}</option>
              </select>
            </label>
          </section>,
          ai: <section className="settings-section" aria-labelledby="settings-ai-title">
            <h3 id="settings-ai-title">{appText.settingsAi}</h3>
            <p>{appText.settingsAiDescription}</p>
            <button className="settings-link" onClick={() => openSettingsChild(setProviderDialogOpen)}>{appText.providersModels} <span>{provider?.name ?? appText.configure}</span></button>
          </section>,
          agent: <section className="settings-section" aria-labelledby="settings-agent-title">
            <h3 id="settings-agent-title">{appText.settingsAgent}</h3>
            <AgentSettings
              mode={executionMode}
              onModeChange={(mode) => void changeExecutionMode(mode)}
              rules={ruleDraft}
              onRulesChange={setRuleDraft}
              onSaveRules={() => void saveExecutionRules()}
              backupRetention={backupRetention}
              onBackupRetentionChange={(value) => void changeBackupRetention(value)}
              powerShellPredictionEnabled={powerShellPredictionEnabled}
              onPowerShellPredictionChange={setPowerShellPredictionEnabled}
              policyNotice={policyNotice}
            >
              <AgentActivity />
              <button className="action-quiet" onClick={clearChat} disabled={!chatMessages.length || chatBusy || agentPlanBusy || agentCommandBusy}>{appText.clearChatHistory}</button>
            </AgentSettings>
          </section>,
          data: <section className="settings-section" aria-labelledby="settings-data-title">
            <h3 id="settings-data-title">{appText.settingsData}</h3>
            <p>{appText.settingsDataDescription}</p>
            <button className="settings-link" onClick={() => openSettingsChild(setTransferOpen)}>{appText.importExport} <span>{appText.configFile}</span></button>
            <button className="settings-link" onClick={() => openSettingsChild(setAccountSettingsOpen)}>{appText.accountSync} <span>{appText.lauralLogin}</span></button>
          </section>,
          application: <section className="settings-section" aria-labelledby="settings-application-title">
            <h3 id="settings-application-title">{appText.settingsApp}</h3>
            <p>{appText.settingsAppDescription}</p>
            <button className="settings-link" onClick={() => openSettingsChild(setUpdateSettingsOpen)}>{appText.updates} <span>{appText.versionPreferences}</span></button>
          </section>,
        }}
      />}
      {transferOpen && <ConfigurationTransfer
        preferences={{
          themeId,
          appearance,
          updateMode: localStorage.getItem("laural.update-mode.v1") === "automatic" ? "automatic" : "manual",
          language,
        }}
        onClose={() => closeSettingsChild(setTransferOpen)}
        onImported={applyImportedConfiguration}
      />}
      {accountSettingsOpen && <AccountSettings
        preferences={{
          themeId,
          appearance,
          updateMode: localStorage.getItem("laural.update-mode.v1") === "automatic" ? "automatic" : "manual",
          language,
        }}
        onImported={applyImportedConfiguration}
        onSyncSettled={clearSyncNotice}
        syncRiskAcknowledged={syncRiskAcknowledged}
        onAcknowledgeSyncRisk={acknowledgeSyncRisk}
        onClose={() => closeSettingsChild(setAccountSettingsOpen)}
      />}
      </Suspense>
      {appearanceOpen && <div className="dialog-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) closeSettingsChild(setAppearanceOpen); }}>
        <section className="appearance-dialog" role="dialog" aria-modal="true" aria-labelledby="appearance-title">
          <button className="dialog-close" onClick={() => closeSettingsChild(setAppearanceOpen)} aria-label={messages.appearance.close}>×</button>
          <div className="dialog-mark"><PaletteIcon /></div><p className="eyebrow">{messages.appearance.eyebrow}</p><h2 id="appearance-title">{messages.appearance.title}</h2>
          <p className="dialog-copy">{messages.appearance.description}</p>
          <div className="appearance-mode" role="group" aria-label={messages.appearance.mode}>
            <button className={appearance === "light" ? "selected" : ""} aria-pressed={appearance === "light"} onClick={() => setAppearance("light")}><SunIcon /> {messages.appearance.light}</button>
            <button className={appearance === "dark" ? "selected" : ""} aria-pressed={appearance === "dark"} onClick={() => setAppearance("dark")}><MoonIcon /> {messages.appearance.dark}</button>
          </div>
          <div className="theme-picker-heading"><strong>{messages.appearance.themes}</strong><span>{themes.length} {messages.appearance.available}</span></div>
          <div className="theme-grid" role="group" aria-label={messages.appearance.colorThemes}>
            {themes.map((theme) => <button key={theme.id} className={`theme-choice ${themeId === theme.id ? "selected" : ""}`} aria-pressed={themeId === theme.id} onClick={() => setThemeId(theme.id)}>
              <span className="theme-swatch"><i style={{ backgroundColor: theme.accentDark }} /><i style={{ backgroundColor: theme.accentLight }} /><i className="theme-swatch-surface" /></span>
              <span className="theme-choice-name">{messages.appearance.themeNames[theme.id as keyof typeof messages.appearance.themeNames]}</span><span className="theme-choice-check" aria-hidden="true">{themeId === theme.id ? "✓" : ""}</span>
            </button>)}
          </div>
        </section>
      </div>}
    </main>
  );
}

export default function App() {
  return <LanguageProvider><AppContent /></LanguageProvider>;
}

function TerminalIcon() { return <svg viewBox="0 0 20 20" aria-hidden="true"><rect x="2.5" y="3" width="15" height="14" rx="3"/><path d="m6 8 2.3 2-2.3 2M10.5 12h3.5"/></svg>; }
function PaletteIcon() { return <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M10 2.5a7.5 7.5 0 1 0 0 15h1.1a1.7 1.7 0 0 0 1.2-2.9l-.5-.5a1.4 1.4 0 0 1 1-2.4h1.3A4.4 4.4 0 0 0 18.5 7c0-2.5-3.8-4.5-8.5-4.5Z"/><circle cx="6.2" cy="9.7" r=".8"/><circle cx="9.2" cy="6.2" r=".8"/><circle cx="13.1" cy="6.4" r=".8"/></svg>; }
function SunIcon() { return <svg viewBox="0 0 20 20" aria-hidden="true"><circle cx="10" cy="10" r="3.2"/><path d="M10 2v2m0 12v2M2 10h2m12 0h2M4.35 4.35l1.4 1.4m8.5 8.5 1.4 1.4m0-11.3-1.4 1.4m-8.5 8.5-1.4 1.4"/></svg>; }
function MoonIcon() { return <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M16.8 12.3A7.2 7.2 0 0 1 7.7 3.2 7.5 7.5 0 1 0 16.8 12.3Z"/></svg>; }
function HistoryIcon() { return <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M3.5 5.8A7 7 0 1 1 3 10"/><path d="M3 3.5v3h3M10 6v4l2.5 1.5"/></svg>; }
function SearchIcon() { return <svg viewBox="0 0 20 20" aria-hidden="true"><circle cx="8.8" cy="8.8" r="5.8"/><path d="m13.2 13.2 4 4"/></svg>; }
function ChevronIcon() { return <svg viewBox="0 0 16 16" aria-hidden="true"><path d="m6 3.5 4.5 4.5L6 12.5"/></svg>; }
function ChevronRightIcon() { return <svg viewBox="0 0 16 16" aria-hidden="true"><path d="m6 3.5 4.5 4.5L6 12.5"/></svg>; }
function DotsIcon() { return <svg viewBox="0 0 20 20" aria-hidden="true"><circle cx="4" cy="10" r="1"/><circle cx="10" cy="10" r="1"/><circle cx="16" cy="10" r="1"/></svg>; }
function PlusIcon() { return <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M10 4v12M4 10h12"/></svg>; }
function FolderIcon() { return <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M2.5 5.5A1.5 1.5 0 0 1 4 4h4l2 2h6A1.5 1.5 0 0 1 17.5 7.5v7A1.5 1.5 0 0 1 16 16H4a1.5 1.5 0 0 1-1.5-1.5v-9Z"/><path d="M2.8 8h14.4"/></svg>; }
function SyncIcon() { return <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M16.5 8A6.5 6.5 0 0 0 5.3 4.3L3.5 6M3.5 6V2.8M3.5 6h3.2M3.5 12a6.5 6.5 0 0 0 11.2 3.7l1.8-1.7m0 0v3.2m0-3.2h-3.2"/></svg>; }
function PanelRightIcon() { return <svg viewBox="0 0 20 20" aria-hidden="true"><rect x="2.5" y="3" width="15" height="14" rx="2"/><path d="M12 3v14"/></svg>; }
function SplitIcon() { return <svg viewBox="0 0 20 20" aria-hidden="true"><rect x="3" y="3" width="14" height="14" rx="2"/><path d="M10 3v14"/></svg>; }
function CopyIcon() { return <svg viewBox="0 0 18 18" aria-hidden="true"><rect x="6" y="5" width="9" height="10" rx="2"/><path d="M12 5V4a1 1 0 0 0-1-1H4a1 1 0 0 0-1 1v8a1 1 0 0 0 1 1h2"/></svg>; }
function ClearIcon() { return <svg viewBox="0 0 18 18" aria-hidden="true"><path d="M3 5h12M7 5V3h4v2m3 0-.6 9.2a1 1 0 0 1-1 .8H5.6a1 1 0 0 1-1-.8L4 5m3 3v4m4-4v4"/></svg>; }
function BranchIcon() { return <svg viewBox="0 0 18 18" aria-hidden="true"><circle cx="5" cy="4" r="2"/><circle cx="13" cy="14" r="2"/><circle cx="13" cy="5" r="2"/><path d="M5 6v4a4 4 0 0 0 4 4h2M11 5H9a4 4 0 0 0-4 4"/></svg>; }
function MessageIcon() { return <svg viewBox="0 0 18 18" aria-hidden="true"><path d="M3 4.5A2.5 2.5 0 0 1 5.5 2h7A2.5 2.5 0 0 1 15 4.5v5a2.5 2.5 0 0 1-2.5 2.5H8l-4 3v-3.4A2.5 2.5 0 0 1 3 9.5v-5Z"/></svg>; }
function AgentIcon() { return <svg viewBox="0 0 18 18" aria-hidden="true"><rect x="3" y="4" width="12" height="10" rx="3"/><path d="M9 1.5v2M6.5 8h.1m4.8 0h.1M6.5 11h5M1.5 8v3m15-3v3"/></svg>; }
function InfoIcon() { return <svg viewBox="0 0 18 18" aria-hidden="true"><circle cx="9" cy="9" r="6.5"/><path d="M9 8v4m0-7h.1"/></svg>; }
function ArrowUpRightIcon() { return <svg viewBox="0 0 18 18" aria-hidden="true"><path d="M5 13 13 5M6 5h7v7"/></svg>; }
function PaperclipIcon() { return <svg viewBox="0 0 18 18" aria-hidden="true"><path d="m6.5 9.5 4.4-4.4a2.5 2.5 0 0 1 3.6 3.6l-6.4 6.4a4 4 0 0 1-5.7-5.7l6.1-6.1"/></svg>; }
function ModelIcon() { return <svg viewBox="0 0 18 18" aria-hidden="true"><path d="M9 2.5v13M2.5 9h13M4.4 4.4l9.2 9.2m0-9.2-9.2 9.2"/></svg>; }
function ArrowUpIcon() { return <svg viewBox="0 0 18 18" aria-hidden="true"><path d="M9 14V4m-4 4 4-4 4 4"/></svg>; }
function LockIcon() { return <svg viewBox="0 0 18 18" aria-hidden="true"><rect x="3.2" y="7.5" width="11.6" height="8" rx="2"/><path d="M5.5 7.5V5a3.5 3.5 0 0 1 7 0v2.5m-3.5 3v2"/></svg>; }
