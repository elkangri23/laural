import { appendTerminalOutput, COMMAND_BLOCK_OUTPUT_LIMIT } from "./terminalOutput";
import { createChatHistoryPersistence } from "./chatPersistence";
import { limitChatMessages, prepareChatHistoryForRequest } from "./chatHistory";
import { HelpDialog, HelpIcon } from "./components/HelpDialog";
import { BellIcon, NotificationCenter } from "./components/NotificationCenter";
import { SettingsDialog } from "./components/SettingsDialog";
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
import "./App.css";

const TerminalPane = lazy(() => import("./components/TerminalPane"));
const BackupRetentionControl = lazy(() => import("./components/BackupRetentionControl").then(module => ({ default: module.BackupRetentionControl })));
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
type ExecutionMode = "review" | "rules" | "automatic";
type PlanAction =
  | { type: "run_command"; command: string; reason: string; status?: string; result?: string }
  | { type: "write_file"; path: string; content: string; reason: string; status?: string; result?: string };
type AgentPlan = { summary: string; actions: PlanAction[] };
const COMMAND_OUTPUT_BATCH_MS = 50;
const MAX_COMMAND_BLOCKS = 80;
const MAX_COMMAND_HISTORY = 100;
const MAX_OPEN_TERMINALS = 16;
const CHAT_DELTA_BATCH_MS = 50;
const SYNC_RISK_ACK_KEY = "laural.sync-risk-ack.v1";

const shellNames: Record<Shell, string> = {
  powershell: "PowerShell",
  cmd: "Command Prompt",
  wsl: "WSL",
  "git-bash": "Git Bash",
};
const shellIcons: Record<Shell, string> = {
  powershell: "PS", cmd: "$_", wsl: "WSL", "git-bash": "$",
};

function App() {
  const [tabs, setTabs] = useState<TerminalTab[]>([
    { id: crypto.randomUUID(), shell: "powershell", title: "PowerShell", cwd: null },
  ]);
  const [activeTabId, setActiveTabId] = useState(tabs[0].id);
  const [projectPath, setProjectPath] = useState<string | null>(null);
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
  const [helpOpen, setHelpOpen] = useState(false);
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const [workspaceMenuOpen, setWorkspaceMenuOpen] = useState(false);
  const [profileMenuOpen, setProfileMenuOpen] = useState(false);
  const [transferOpen, setTransferOpen] = useState(false);
  const [accountSettingsOpen, setAccountSettingsOpen] = useState(false);
  const [updateSettingsOpen, setUpdateSettingsOpen] = useState(false);
  const [appearanceOpen, setAppearanceOpen] = useState(false);
  const [syncNotice, setSyncNotice] = useState("");
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
  const streamingContentRef = useRef("");
  const [contextFiles, setContextFiles] = useState<string[]>([]);
  const [gitDiffContext, setGitDiffContext] = useState("");
  const [gitDiffTruncated, setGitDiffTruncated] = useState(false);
  const [backupVersions, setBackupVersions] = useState<Record<number, string[]>>({});
  const [selectedBackups, setSelectedBackups] = useState<Record<number, string>>({});
  const [agentPlan, setAgentPlan] = useState<AgentPlan | null>(null);
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
  const agentStopRequestedRef = useRef(false);
  const activeAgentTerminalRef = useRef<string | null>(null);
  const commandCompletionRef = useRef<Record<string, { resolve: (exitCode: number | null) => void; timer: ReturnType<typeof setTimeout> }>>({});
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
      };
      const snapshot = await invoke<{
        schemaVersion: number;
        preferences: typeof preferences;
        activeProviderId: string | null;
        providers: { id: string; kind: string; name: string; model: string; customEndpoint?: string }[];
      }>("get_preference_snapshot", { preferences });
      const result = await invoke<{ status: "synced" | "pending" | "needsChoice" | "conflict" | "signedOut" }>("sync_local_preferences", { snapshot });
      if (result.status === "synced" || result.status === "signedOut") setSyncNotice("");
      else if (result.status === "pending") setSyncNotice("Cambios locales guardados. Se intentará sincronizar cuando el servicio vuelva a estar disponible.");
      else if (result.status === "conflict") setSyncNotice("La configuración de este equipo y la nube han cambiado. Elige cuál conservar en Cuenta y sincronización.");
      else setSyncNotice("Revisa Cuenta y sincronización para elegir qué configuración conservar.");
    } catch {
      setSyncNotice("No se pudo comprobar la sincronización. Revisa Cuenta y sincronización.");
    }
  }, [themeId]);

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
      if (status.pending) setSyncNotice("Hay cambios locales pendientes de sincronizar; Laural los volverá a intentar.");
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
  }, [schedulePreferenceSync]);

  useEffect(() => {
    if (!appearanceSyncReadyRef.current) {
      appearanceSyncReadyRef.current = true;
      return;
    }
    schedulePreferenceSync();
  }, [themeId, appearance, schedulePreferenceSync]);

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

  const finishCommandBlock = useCallback((terminalId: string, exitCode: number | null) => {
    flushCommandOutput();
    const id = activeCommandBlockRef.current[terminalId];
    if (!id) return;
    setCommandBlocks((blocks) => blocks.map((block) => block.id === id ? { ...block, status: "finished", exitCode } : block));
    delete activeCommandBlockRef.current[terminalId];
    const completion = commandCompletionRef.current[terminalId];
    if (completion) {
      clearTimeout(completion.timer);
      delete commandCompletionRef.current[terminalId];
      completion.resolve(exitCode);
    }
  }, [flushCommandOutput]);

  const activeTab = useMemo(
    () => tabs.find((tab) => tab.id === activeTabId) ?? tabs[0],
    [activeTabId, tabs],
  );
  const activeTheme = themes.find((theme) => theme.id === themeId) ?? themes[0];
  const visibleBlocks = commandBlocks.filter((block) => block.terminalId === activeTabId).slice(-30).reverse();
  const paletteActions = [
    { id: "new-terminal", label: "Nueva terminal", description: "Abrir una sesión PowerShell", run: () => addTerminal("powershell") },
    { id: "project", label: projectPath ? "Cambiar carpeta de proyecto" : "Abrir carpeta de proyecto", description: "Elegir el directorio de trabajo local", run: () => { void openProject(); } },
    { id: "git", label: "Abrir panel Git", description: "Consultar la rama y los cambios del proyecto", run: () => setGitPanelOpen(true) },
    { id: "settings", label: "Abrir configuración", description: "Preferencias, seguridad y proveedores", run: () => setSettingsOpen(true) },
    { id: "provider", label: "Conectar proveedor de IA", description: "Ollama, LM Studio o API compatible", run: () => setProviderDialogOpen(true) },
    { id: "appearance", label: "Cambiar apariencia", description: "Temas y modo claro u oscuro", run: () => setAppearanceOpen(true) },
    { id: "recipes", label: "Abrir recetas de tareas", description: "Preparar una instrucción local para el agente", run: () => setTaskRecipesOpen(true) },
    { id: "help", label: "Abrir ayuda", description: "Accesos rápidos y atajos de teclado", run: () => setHelpOpen(true) },
    { id: "notifications", label: "Abrir notificaciones", description: "Avisos de sincronización y actualizaciones", run: () => setNotificationsOpen(true) },
    { id: "blocks", label: "Alternar bloques", description: "Mostrar u ocultar los resultados de comandos", run: () => setBlocksOpen((open) => !open) },
    ...tabs.map((tab) => ({ id: `tab-${tab.id}`, label: `Ir a ${tab.title}`, description: `${shellNames[tab.shell]} · ${tab.cwd ?? "Directorio de inicio"}`, run: () => selectTab(tab.id) })),
  ];
  const editingHasApiKey = providers.some((item) => item.id === editingProviderId && item.hasApiKey);

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
      setTerminalActionNotice(`Puedes mantener abiertas hasta ${MAX_OPEN_TERMINALS} terminales.`);
      return;
    }
    const count = tabs.filter((tab) => tab.shell === shell).length + 1;
    const title = count === 1 ? shellNames[shell] : `${shellNames[shell]} ${count}`;
    const nextTab = { id: crypto.randomUUID(), shell, title, cwd };
    setTabs((current) => [...current, nextTab]);
    setActiveTabId(nextTab.id);
    setShellMenuOpen(false);
  }

  async function openProject() {
    try {
      const selected = await open({ directory: true, multiple: false });
      if (typeof selected !== "string") return;
      setProjectPath(selected);
      setGitDiffContext("");
      setGitDiffTruncated(false);
      addTerminal(activeTab?.shell ?? "powershell", selected);
    } catch (error) {
      setProviderError(`No se pudo abrir el selector de carpetas: ${String(error)}`);
      setProviderDialogOpen(true);
    }
  }

  async function addContextFiles() {
    try {
      const selected = await open({ multiple: true, directory: false });
      const paths = Array.isArray(selected) ? selected : selected ? [selected] : [];
      if (paths.length) setContextFiles((current) => [...new Set([...current, ...paths])].slice(0, 12));
    } catch (error) {
      setProviderError(`No se pudieron adjuntar los archivos: ${String(error)}`);
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
      setPrompt("");
      setAgentPlan(null);
      setAgentPlanBusy(true);
      const requestId = crypto.randomUUID();
      activeAgentRequestRef.current = requestId;
      agentStopRequestedRef.current = false;
      setChatMessages((current) => limitChatMessages([...current, { role: "user", content: question }]));
      const planTerminalId = activeTabId;
      const shell = activeTab?.shell ?? "powershell";
      void invoke<AgentPlan>("plan_agent", {
        requestId,
        task: question,
        shell,
        terminalContext: terminalContextRef.current[planTerminalId] ?? "",
        projectPath,
        selectedFiles: contextFiles,
        gitDiffContext,
      }).then(async (plan) => {
        if (agentStopRequestedRef.current) return;
        const prepared: AgentPlan = { ...plan, actions: plan.actions.map((action) => ({ ...action, status: "pending" })) };
        setAgentPlan(prepared);
        setChatMessages((current) => limitChatMessages([...current, { role: "assistant", content: `Plan preparado con ${plan.actions.length} acciones.` }]));
        if (executionMode !== "review") {
          for (let index = 0; index < prepared.actions.length; index += 1) {
            if (agentStopRequestedRef.current) break;
            if (prepared.actions[index].type === "run_command") {
              const completed = await executeAgentCommand(index, false, prepared, planTerminalId);
              if (!completed) {
                if (!agentStopRequestedRef.current) setChatMessages((current) => limitChatMessages([...current, { role: "assistant", content: "La secuencia automática se detuvo porque un comando no devolvió un código de salida correcto." }]));
                break;
              }
            }
          }
          if (agentStopRequestedRef.current) setChatMessages((current) => limitChatMessages([...current, { role: "assistant", content: "Ejecución del agente detenida. Los cambios de archivo pendientes no se aplicaron." }]));
        }
      }).catch((error) => {
        setChatMessages((current) => limitChatMessages([...current, { role: "assistant", content: agentStopRequestedRef.current ? "Planificación del agente cancelada." : `No se pudo preparar el plan: ${String(error)}` }]));
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
    streamingContentRef.current = "";
    setStreamingMessageId(assistantMessageId);
    activeChatRequestRef.current = requestId;
    let unlisten: (() => void) | undefined;
    let pendingDelta = "";
    let deltaTimer: number | undefined;
    const flushDelta = () => {
      if (deltaTimer !== undefined) {
        window.clearTimeout(deltaTimer);
        deltaTimer = undefined;
      }
      if (!pendingDelta) return;
      const delta = pendingDelta;
      pendingDelta = "";
      streamingContentRef.current += delta;
      setChatMessages((current) => current.map((message) => message.id === assistantMessageId ? { ...message, content: message.content + delta } : message));
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
      flushDelta();
      const message = String(error);
      setChatMessages((current) => current.map((item) => item.id === assistantMessageId ? { ...item, content: item.content ? `${item.content}\n\n[${message}]` : `No se pudo completar la consulta: ${message}` } : item));
    }).finally(() => {
      flushDelta();
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
    const timer = setTimeout(() => finishCommandBlock(terminalId, null), 120_000);
    commandCompletionRef.current[terminalId] = { resolve: completionResolve, timer };
    updateAgentAction(index, { status: "running", result: undefined });
    try {
      await invoke("run_agent_command", { terminalId, command: action.command, approved });
      const exitCode = await completion;
      if (agentStopRequestedRef.current) { updateAgentAction(index, { status: "cancelled", result: "Interrupción enviada a la terminal." }); return false; }
      if (exitCode === 0) { updateAgentAction(index, { status: "completed", result: "El comando terminó correctamente." }); return true; }
      if (exitCode !== null) { updateAgentAction(index, { status: "error", result: `El comando terminó con código ${exitCode}.` }); return false; }
      updateAgentAction(index, { status: "submitted", result: "Comando enviado; este shell no comunicó el código de salida." });
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
    if (!action || action.type !== "write_file" || !projectPath) return;
    updateAgentAction(index, { status: "applying", result: undefined });
    try {
      const result = await invoke<string>("apply_agent_file", {
        projectPath,
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
    if (!projectPath) return;
    try {
      const versions = await invoke<string[]>("list_agent_backups", { projectPath, relativePath: path });
      setBackupVersions(current => ({ ...current, [index]: versions }));
      if (versions[0]) setSelectedBackups(current => ({ ...current, [index]: versions[0] }));
      else updateAgentAction(index, { result: "No hay copias para este archivo." });
    } catch (error) { updateAgentAction(index, { result: String(error) }); }
  }

  async function restoreBackup(index: number, path: string) {
    const version = selectedBackups[index];
    if (!projectPath || !version || !window.confirm(`¿Restaurar ${path} desde ${version}? La versión actual se guardará como otra copia.`)) return;
    try {
      const result = await invoke<string>("restore_agent_backup", { projectPath, relativePath: path, version, approved: true });
      updateAgentAction(index, { result });
      await showBackups(index, path);
    } catch (error) { updateAgentAction(index, { result: String(error) }); }
  }
  async function clearBackups(index: number, path: string) {
    if (!projectPath || !window.confirm(`¿Eliminar todas las copias de ${path}? El archivo actual permanecerá intacto.`)) return;
    try {
      const removed = await invoke<number>("clear_agent_backups", { projectPath, relativePath: path, approved: true });
      setBackupVersions(current => ({ ...current, [index]: [] }));
      updateAgentAction(index, { result: `Copias eliminadas: ${removed}.` });
    } catch (error) { updateAgentAction(index, { result: String(error) }); }
  }
  async function changeExecutionMode(mode: ExecutionMode) {
    setExecutionMode(mode);
    setPolicyNotice("");
    try {
      await invoke("save_agent_settings", { settings: { mode, allowedPrefixes, backupRetention } });
      setPolicyNotice("Política guardada.");
    } catch (error) {
      setPolicyNotice(`No se pudo guardar: ${String(error)}`);
    }
  }

  async function saveExecutionRules() {
    const prefixes = ruleDraft.split(/\r?\n/).map((item) => item.trim()).filter(Boolean);
    setAllowedPrefixes(prefixes);
    try {
      await invoke("save_agent_settings", { settings: { mode: executionMode, allowedPrefixes: prefixes, backupRetention } });
      setPolicyNotice("Reglas guardadas.");
    } catch (error) {
      setPolicyNotice(`No se pudieron guardar las reglas: ${String(error)}`);
    }
  }

  async function changeBackupRetention(value: number | null) {
    setBackupRetention(value);
    setPolicyNotice("");
    try {
      await invoke("save_agent_settings", { settings: { mode: executionMode, allowedPrefixes, backupRetention: value } });
      setPolicyNotice("Retención guardada.");
    } catch (error) {
      setPolicyNotice(`No se pudo guardar: ${String(error)}`);
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
      setProviderName("API compatible"); setBaseUrl(""); setModel("");
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
      setProviderNotice(`Conexión correcta · ${found.length} modelos disponibles`);
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
      setProviderNotice("Proveedor guardado en este equipo.");
      setProviderDialogOpen(false);
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
      setProviderNotice("Proveedor activo actualizado.");
      schedulePreferenceSync();
    } catch (error) {
      setProviderError(String(error));
    } finally {
      setProviderBusy(false);
    }
  }

  function newProviderProfile() {
    setEditingProviderId(null);
    setProviderKind("custom"); setShareCustomEndpoint(false); setProviderName("Nuevo proveedor"); setBaseUrl(""); setModel(""); setApiKey(""); setModels([]);
    setProviderError(""); setProviderNotice("");
  }

  function closeProviderDialog() {
    setProviderDialogOpen(false);
    setApiKey("");
    setProviderError("");
  }

  return (
    <main className="app-shell">
      <aside className="sidebar">
        <div className="brand-row">
          <div className="brand-mark" aria-hidden="true"><span /><span /></div>
          <span className="brand-name">Laural</span>
          <div className="app-menu-wrap" ref={appMenuRef}>
            <button ref={appMenuButtonRef} className="icon-button sidebar-menu" aria-label="Abrir menú" aria-expanded={appMenuOpen} aria-haspopup="menu" aria-controls="app-menu" onClick={() => setAppMenuOpen((open) => !open)}><DotsIcon /></button>
            {appMenuOpen && <div className="app-menu" id="app-menu" role="menu" aria-label="Menú de Laural" onKeyDown={navigateAppMenu}>
              <button role="menuitem" onClick={() => { setAppMenuOpen(false); addTerminal("powershell"); }}>Nueva terminal</button>
              <button role="menuitem" onClick={() => { setAppMenuOpen(false); void openProject(); }}>Abrir carpeta de proyecto</button>
              <button role="menuitem" onClick={() => { setAppMenuOpen(false); setCommandPaletteView("all"); setCommandPaletteOpen(true); }}>Buscar acciones e historial</button>
              <button role="menuitem" onClick={() => { setAppMenuOpen(false); setProviderDialogOpen(true); }}>Configurar proveedor de IA</button>
              <button role="menuitem" onClick={() => { setAppMenuOpen(false); setSettingsOpen(true); }}>Configuración</button>
              <button role="menuitem" onClick={() => { setAppMenuOpen(false); setHelpOpen(true); }}>Ayuda</button>
            </div>}
          </div>
        </div>
        <div className="workspace-picker-wrap" ref={workspaceMenuRef}>
          <button className="workspace-picker" aria-expanded={workspaceMenuOpen} aria-haspopup="menu" aria-controls="workspace-menu" onClick={() => setWorkspaceMenuOpen((open) => !open)}>
            <span className="workspace-avatar">A</span>
            <span className="workspace-copy"><strong>Mi equipo</strong><small>Espacio personal</small></span>
            <ChevronIcon />
          </button>
          {workspaceMenuOpen && <div className="workspace-menu" id="workspace-menu" role="menu" aria-label="Espacio de trabajo">
            <p className="workspace-menu-label">ESPACIO ACTUAL</p>
            <div className="workspace-menu-current"><span className="workspace-avatar">A</span><span><strong>Espacio personal</strong><small>Solo disponible en este equipo</small></span><span className="workspace-menu-check" aria-label="Seleccionado">✓</span></div>
            <p className="workspace-menu-note">Los espacios compartidos aún no están disponibles. Tus proyectos se abren dentro de este espacio local.</p>
            <button role="menuitem" onClick={() => { setWorkspaceMenuOpen(false); void openProject(); }}><FolderIcon /><span>{projectPath ? "Cambiar carpeta de proyecto" : "Abrir carpeta de proyecto"}</span></button>
            <button role="menuitem" onClick={() => { setWorkspaceMenuOpen(false); setAccountSettingsOpen(true); }}><SyncIcon /><span>Cuenta y sincronización</span></button>
          </div>}
        </div>
        <nav className="primary-nav" aria-label="Navegación principal">
          <button className={`nav-item ${!(commandPaletteOpen && commandPaletteView === "history") ? "active" : ""}`}><TerminalIcon /><span>Terminal</span><kbd>⌘ 1</kbd></button>
          <button className="nav-item" onClick={() => setProviderDialogOpen(true)}><SparkIcon /><span>Asistente IA</span><span className="nav-dot" /></button>
          <button className={`nav-item ${commandPaletteOpen && commandPaletteView === "history" ? "active" : ""}`} onClick={() => { setCommandPaletteView("history"); setCommandPaletteOpen(true); }}><HistoryIcon /><span>Historial</span></button>
        </nav>
        <div className="sidebar-section">
          <div className="section-label"><span>PROYECTOS</span><button className="quiet-icon" aria-label="Añadir proyecto"><PlusIcon /></button></div>
          <button className="project-item" onClick={() => void openProject()}><span className="project-glyph">L</span><span>{projectPath ? projectPath.split(/[\\/]/).filter(Boolean).pop() : "Laural"}</span><span className="project-menu">···</span></button>
          <button className="add-project" onClick={() => void openProject()}><PlusIcon /><span>Abrir un proyecto</span></button>
        </div>
        <div className="sidebar-spacer" />
        <div className="sidebar-bottom">
          <div className="plan-card">
            <div className="plan-icon"><SparkIcon /></div>
            <div><strong>Conecta tu modelo</strong><p>Usa Ollama, LM Studio o tu endpoint.</p></div>
            <button className="plan-arrow" onClick={() => setProviderDialogOpen(true)} aria-label="Configurar proveedor"><ChevronIcon /></button>
          </div>
          <button className="appearance-entry" onClick={() => setSettingsOpen(true)}><PaletteIcon /><span>Configuración</span><span className="appearance-entry-meta">{appearance === "dark" ? "Oscuro" : "Claro"}</span></button>
          {syncNotice && <div className="sync-notice" role="status"><span>{syncNotice}</span><button onClick={() => setAccountSettingsOpen(true)}>Revisar</button><button className="sync-notice-close" onClick={clearSyncNotice} aria-label="Cerrar aviso de sincronización">×</button></div>}
          <UpdateManager settingsOpen={updateSettingsOpen} onSettingsOpen={() => setUpdateSettingsOpen(true)} onSettingsClose={() => setUpdateSettingsOpen(false)} />
          <div className="profile-menu-wrap" ref={profileMenuRef}>
            <button className="profile-row" aria-expanded={profileMenuOpen} aria-haspopup="menu" aria-controls="profile-menu" onClick={() => setProfileMenuOpen((open) => !open)}><span className="profile-avatar">AM</span><span className="profile-name">Perfil local</span><DotsIcon /></button>
            {profileMenuOpen && <div className="profile-menu" id="profile-menu" role="menu" aria-label="Opciones del perfil local">
              <p className="profile-menu-label">PERFIL LOCAL</p>
              <p className="profile-menu-description">Preferencias y proveedores guardados en este equipo.</p>
              <button role="menuitem" onClick={() => { setProfileMenuOpen(false); setSettingsOpen(true); }}>Configuración</button>
              <button role="menuitem" onClick={() => { setProfileMenuOpen(false); setTransferOpen(true); }}>Importar y exportar configuración</button>
              <button role="menuitem" onClick={() => { setProfileMenuOpen(false); setAccountSettingsOpen(true); }}>Cuenta y sincronización</button>
            </div>}
          </div>
        </div>
      </aside>

      <section className="main-column">
        <header className="topbar">
          <div className="breadcrumb"><span className="breadcrumb-muted">Mi equipo</span><ChevronRightIcon /><strong>Terminal</strong></div>
          <div className="topbar-actions">
            <button className="search-button" onClick={() => { setCommandPaletteView("all"); setCommandPaletteOpen(true); }}><SearchIcon /><span>Buscar comandos y sesiones</span><kbd>Ctrl K</kbd></button>
            <button className="icon-button top-icon" aria-label="Ayuda" title="Ayuda" onClick={() => setHelpOpen(true)}><HelpIcon /></button>
            <button className="icon-button top-icon" aria-label="Notificaciones" title="Notificaciones" onClick={() => setNotificationsOpen(true)}><BellIcon /></button>
          </div>
        </header>

        <div className="terminal-toolbar">
          <div className="tabs-strip" role="tablist" aria-label="Sesiones de terminal">
            {tabs.map((tab) => <button className={`terminal-tab ${tab.id === activeTabId ? "selected" : ""}`} key={tab.id} onClick={() => selectTab(tab.id)} role="tab" aria-selected={tab.id === activeTabId}>
              <span className={`shell-badge ${tab.shell}`}>{shellIcons[tab.shell]}</span><span>{tab.title}</span>
              <span className="tab-close" role="button" tabIndex={0} aria-label={`Cerrar ${tab.title}`} onClick={(event) => { event.stopPropagation(); closeTab(tab.id); }} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.stopPropagation(); closeTab(tab.id); } }}>×</span>
            </button>)}
            <div className="new-tab-wrap">
              <button className="new-tab-button" aria-label="Nueva terminal" onClick={() => setShellMenuOpen((open) => !open)}><PlusIcon /></button>
              {shellMenuOpen && <div className="shell-menu">{(Object.keys(shellNames) as Shell[]).map((shell) => <button key={shell} onClick={() => addTerminal(shell)}><span className={`shell-badge ${shell}`}>{shellIcons[shell]}</span><span>{shellNames[shell]}</span></button>)}</div>}
            </div>
          </div>
          <div className="terminal-tools">
            <button className="toolbar-chip" onClick={() => setProviderDialogOpen(true)}><span className={`status-led ${provider ? "connected" : ""}`} /><span>{provider ? `${provider.name} · ${provider.model}` : "Proveedor sin configurar"}</span><ChevronIcon /></button>
            <button className="toolbar-icon git-toolbar-button" aria-label="Abrir panel Git" title="Panel Git de solo lectura" onClick={() => setGitPanelOpen(true)}><BranchIcon /></button>
            <button className={`toolbar-icon ${splitTabId ? "active" : ""}`} aria-label={splitTabId ? `División ${splitOrientation === "vertical" ? "vertical" : "horizontal"}; cambiar o cerrar` : "Dividir panel"} title={splitTabId ? `${splitOrientation === "vertical" ? "Vertical" : "Horizontal"} · clic para cambiar/cerrar` : "Dividir terminal"} onClick={toggleSplit}><SplitIcon /></button>
            <button className={`toolbar-icon assistant-toggle ${assistantVisible ? "active" : ""}`} aria-label={assistantVisible ? "Ocultar asistente IA" : "Mostrar asistente IA"} aria-pressed={assistantVisible} title={assistantVisible ? "Ocultar asistente IA" : "Mostrar asistente IA"} onClick={() => setAssistantVisible((visible) => !visible)}><PanelRightIcon /></button>
            <div className="toolbar-more-wrap" ref={terminalMoreRef}>
              <button className="toolbar-icon" aria-label="Más opciones" aria-expanded={terminalMoreOpen} aria-haspopup="menu" aria-controls="terminal-more-menu" onClick={() => setTerminalMoreOpen((open) => !open)}><DotsIcon /></button>
              {terminalMoreOpen && <div className="toolbar-more-menu" id="terminal-more-menu" role="menu" aria-label="Más opciones de terminal">
                <button role="menuitem" onClick={() => { setTerminalMoreOpen(false); setGitPanelOpen(true); }}>Abrir panel Git</button>
                <button role="menuitem" onClick={() => { setTerminalMoreOpen(false); setBlocksOpen((open) => !open); }}>{blocksOpen ? "Ocultar bloques" : "Mostrar bloques"}</button>
                <button role="menuitem" onClick={() => { setTerminalMoreOpen(false); setAssistantVisible((visible) => !visible); }}>{assistantVisible ? "Ocultar asistente IA" : "Mostrar asistente IA"}</button>
                <button role="menuitem" onClick={() => { setTerminalMoreOpen(false); setProviderDialogOpen(true); }}>Configurar proveedor</button>
                <button role="menuitem" onClick={() => { setTerminalMoreOpen(false); requestTerminalCopy(); }}>Copiar selección</button>
                <button role="menuitem" onClick={() => { setTerminalMoreOpen(false); requestTerminalClear(); }}>Limpiar terminal</button>
              </div>}
            </div>
          </div>
        </div>

        <div className={`workspace-body ${assistantVisible ? "" : "assistant-hidden"}`}>
          <section className="terminal-area" aria-label="Terminal">
            <div className="terminal-heading">
              <div><div className="terminal-title-line"><span className="terminal-title-mark">⌁</span><h1>{activeTab?.title ?? "Terminal"}</h1><span className="connection-pill"><span /> Local</span></div><p className="terminal-path">{activeTab?.cwd ?? "Directorio de inicio"} <span>·</span> Windows</p></div>
              <div className="terminal-heading-actions"><button className={`small-action ${blocksOpen ? "selected" : ""}`} onClick={() => setBlocksOpen((open) => !open)} aria-pressed={blocksOpen}>Bloques <span className="block-count">{visibleBlocks.length}</span></button><button className="small-action" title="Copiar el texto seleccionado en la terminal" onClick={requestTerminalCopy}><CopyIcon /> Copiar selección</button><button className="small-action" title="Limpiar la pantalla de la terminal activa" onClick={requestTerminalClear}><ClearIcon /> Limpiar</button>{terminalActionNotice && <span className="terminal-action-notice" role="status">{terminalActionNotice}</span>}</div>
            </div>
            <div className={`terminal-frame ${blocksOpen ? "with-blocks" : ""} ${splitTabId ? `is-split split-${splitOrientation}` : ""}`}>
              <Suspense fallback={<div className="terminal-loading" role="status">Iniciando terminal…</div>}>
                {tabs.map((tab) => <TerminalPane key={tab.id} terminalId={tab.id} active={tab.id === activeTabId} copyRequest={terminalCopyRequest} clearRequest={terminalClearRequest} onActionNotice={setTerminalActionNotice} onRestart={restartTab} shell={tab.shell} cwd={tab.cwd} visible={tab.id === activeTabId || tab.id === splitTabId} theme={activeTheme} appearance={appearance} onTextOutput={captureTerminalOutput} onCommandSubmit={startCommandBlock} onCommandFinish={finishCommandBlock} />)}
              </Suspense>
              <div className="terminal-caption"><span className="shortcut-hint"><kbd>Ctrl</kbd> + <kbd>`</kbd> alternar terminal</span><span><span className="activity-pulse" /> Shell conectado</span></div>
            </div>
            {blocksOpen && <section className="command-blocks-panel" aria-label="Bloques de comandos">
              {visibleBlocks.length === 0 ? <p className="blocks-empty">Los comandos que envíes desde esta terminal aparecerán aquí con su salida.</p> : visibleBlocks.map((block) => {
                return <CommandBlockItem block={block} key={block.id} />;
              })}
            </section>}
            <div className="terminal-footer"><div className="footer-left"><button className="footer-branch" onClick={() => setGitPanelOpen(true)} title="Consultar rama y cambios reales del proyecto"><BranchIcon /> Consultar Git</button></div><div className="footer-right"><span>UTF-8</span><span>{activeTab?.title ?? "PowerShell"}</span><span>100%</span></div></div>
          </section>

          {assistantVisible && <aside className="assistant-panel">
            <div className="assistant-header"><div className="assistant-heading"><div className="assistant-avatar"><SparkIcon /></div><div><strong>Asistente</strong><span>Contexto de esta terminal</span></div></div><button className="action-quiet" onClick={clearChat} disabled={chatBusy || agentPlanBusy || agentCommandBusy}>Borrar historial</button></div>
            <div className="mode-switch" role="tablist" aria-label="Modo de IA">
              <button className={!agentMode ? "active" : ""} onClick={() => setAgentMode(false)} role="tab" aria-selected={!agentMode}><MessageIcon /> Chat</button>
              <button className={agentMode ? "active" : ""} onClick={() => setAgentMode(true)} role="tab" aria-selected={agentMode}><AgentIcon /> Agente <span className="mode-beta">PREVIEW</span></button>
            </div>
            {agentMode && <div className="agent-mode-actions"><button className="action-quiet" onClick={() => setTaskRecipesOpen(true)}>Recetas</button><button className="action-quiet" onClick={() => setSettingsOpen(true)}>Permisos del agente</button></div>}
            {chatMessages.length === 0 ? <div className="assistant-empty">
              <div className="empty-orbit orbit-one" /><div className="empty-orbit orbit-two" /><div className="empty-spark"><SparkIcon /></div>
              <h2>{agentMode ? "Trabaja junto al agente" : "¿Qué quieres hacer?"}</h2>
              <p>{agentMode ? projectPath ? "Describe una tarea. El agente prepara un plan y aplica tus reglas antes de ejecutar." : "Abre una carpeta de proyecto antes de iniciar una tarea del agente." : "Pregunta sobre la salida de la terminal, explora tu proyecto o pide ayuda con un comando."}</p>
              {agentMode && !projectPath && <button className="open-project-cta" onClick={() => void openProject()}>Abrir proyecto</button>}
              <div className="suggestion-list">
                <button onClick={() => setPrompt("Explícame la salida de este comando")}><span className="suggestion-icon"><InfoIcon /></span><span>Explícame la salida de este comando</span><ArrowUpRightIcon /></button>
                <button onClick={() => setPrompt("Ayúdame a encontrar un error en este proyecto")}><span className="suggestion-icon"><SearchIcon /></span><span>Ayúdame a encontrar un error</span><ArrowUpRightIcon /></button>
                <button onClick={() => setPrompt("Dame un comando para revisar el estado de Git")}><span className="suggestion-icon"><TerminalIcon /></span><span>Genera un comando con contexto</span><ArrowUpRightIcon /></button>
              </div>
            </div> : <div className="message-thread">
              {chatMessages.map((message, index) => <ChatMessageItem key={message.id ?? `${index}-${message.role}`} message={message} isStreaming={message.id === streamingMessageId} streamingContentRef={message.id === streamingMessageId ? streamingContentRef : undefined} />)}
              {agentPlan && <div className="agent-plan-card">
                <div className="agent-plan-header"><span className="plan-icon-small"><AgentIcon /></span><strong>Plan del agente</strong><span>{agentPlan.actions.length} acciones</span></div>
                <p className="agent-plan-summary">{agentPlan.summary}</p>
                <div className="agent-action-list">{agentPlan.actions.map((action, index) => <article className={`agent-action ${action.status ?? "pending"}`} key={`${index}-${action.type}`}>
                  <div className="agent-action-top"><span className="action-number">{index + 1}</span><span className="action-type">{action.type === "run_command" ? "COMANDO" : "CAMBIO DE ARCHIVO"}</span><span className="action-status">{action.status === "completed" ? "COMPLETADO" : action.status === "cancelled" ? "DETENIDO" : action.status === "submitted" ? "ENVIADO" : action.status === "needs_review" ? "REVISAR" : action.status === "applied" ? "APLICADO" : action.status === "running" || action.status === "applying" ? "EN CURSO" : action.status === "error" ? "ERROR" : action.status === "rejected" ? "DESCARTADO" : "PENDIENTE"}</span></div>
                  <p className="action-reason">{action.reason}</p>
                  {action.type === "run_command" ? <pre className="action-code">{action.command}</pre> : <details className="file-preview"><summary>{action.path}</summary><pre>{action.content}</pre></details>}
                  {action.type === "write_file" && backupVersions[index]?.length ? <div className="backup-controls"><select aria-label="Versión de copia" value={selectedBackups[index] ?? ""} onChange={event => setSelectedBackups(current => ({ ...current, [index]: event.currentTarget.value }))}>{backupVersions[index].map(version => <option key={version} value={version}>{version}</option>)}</select><button className="action-quiet" onClick={() => void restoreBackup(index, action.path)}>Restaurar copia</button><button className="action-quiet" onClick={() => void clearBackups(index, action.path)}>Eliminar copias</button></div> : null}{action.result && <p className={`action-result ${action.status === "error" || action.status === "needs_review" ? "warning" : ""}`}>{action.result}</p>}
                  <div className="action-buttons">{action.type === "write_file" && action.status === "applied" ? <button className="action-quiet" onClick={() => void showBackups(index, action.path)}>Copias de seguridad</button> : null}{action.type === "run_command" ? !["submitted", "completed", "cancelled", "rejected", "running"].includes(action.status ?? "") && <button className="action-primary" onClick={() => void executeAgentCommand(index, true)}>{action.status === "needs_review" ? "Revisar y ejecutar" : "Aprobar y ejecutar"}</button> : action.status !== "applied" && action.status !== "rejected" && <button className="action-primary" onClick={() => void applyAgentFile(index)} disabled={!projectPath || action.status === "applying"}>Aplicar cambio</button>}
                    {!(["submitted", "completed", "cancelled", "applied", "rejected", "running", "applying"].includes(action.status ?? "")) && <button className="action-quiet" onClick={() => updateAgentAction(index, { status: "rejected", result: "Acción descartada." })}>Descartar</button>}</div>
                </article>)}</div>
              </div>}
              {(chatBusy || agentPlanBusy || agentCommandBusy) && <div className="typing-indicator"><span /><span /><span /> {agentMode ? agentCommandBusy ? "El agente está esperando al shell" : "El agente está preparando el plan" : "El modelo está respondiendo"} {chatBusy && !agentMode && <button className="action-quiet" onClick={() => void stopChat()}>Detener</button>}{agentMode && <button className="action-quiet" onClick={() => void stopAgent()}>Detener agente</button>}</div>}
            </div>}
            <div className="composer-wrap">
              <form className="composer" onSubmit={submitPrompt}>
                <textarea value={prompt} onChange={(event) => setPrompt(event.target.value)} placeholder={agentMode ? "Describe una tarea para el agente…" : "Pregunta sobre tu terminal…"} rows={3} />
                {(contextFiles.length > 0 || gitDiffContext) && <div className="context-file-list">{contextFiles.map((path) => <button type="button" className="context-file-chip" key={path} title={path} onClick={() => setContextFiles((current) => current.filter((item) => item !== path))}><PaperclipIcon /> {path.split(/[\\/]/).pop()} <span>×</span></button>)}{gitDiffContext && <button type="button" className="context-file-chip" title="Quitar el diff Git del contexto" onClick={() => { setGitDiffContext(""); setGitDiffTruncated(false); }}><BranchIcon /> Diff Git{gitDiffTruncated ? " (parcial)" : ""} <span>×</span></button>}</div>}
                <div className="composer-controls"><div className="composer-left"><button type="button" className="composer-tool" title="Adjuntar archivos" onClick={() => void addContextFiles()}><PaperclipIcon /></button><button type="button" className="context-chip" title="Revisar el contenido de terminal, proyecto y archivos que se enviará" onClick={() => void openContextPreview()}><span className="context-indicator" /> Revisar contexto</button>{projectPath && <span className="project-context-chip" title="Se incluirá contexto acotado del proyecto">Proyecto</span>}<button type="button" className="composer-tool" title="Seleccionar modelo" onClick={() => setProviderDialogOpen(true)}><ModelIcon /></button></div><button type="submit" className="send-button" aria-label="Enviar mensaje" disabled={!prompt.trim() || chatBusy || agentPlanBusy || agentCommandBusy}><ArrowUpIcon /></button></div>
              </form>
              <div className="composer-note"><span>{agentMode ? "Modo agente: ejecución pendiente" : provider ? `El contexto seleccionado se enviará a ${provider.name}` : "Conecta un proveedor para empezar"}</span><button onClick={() => setProviderDialogOpen(true)}>{provider ? "Ajustes" : "Configurar modelo"}</button></div>
            </div>
          </aside>}
        </div>
      </section>

      {contextPreviewError && <div className="dialog-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setContextPreviewError(""); }}><section className="provider-dialog context-error-dialog" role="alertdialog" aria-modal="true"><button className="dialog-close" onClick={() => setContextPreviewError("")} aria-label="Cerrar">×</button><p className="eyebrow">VISTA PREVIA</p><h2>No se pudo preparar el contexto</h2><p className="dialog-copy">{contextPreviewError}</p></section></div>}

      <Suspense fallback={<div className="context-preview-loading" role="status">Abriendo panel…</div>}>
      {gitPanelOpen && <GitPanel projectPath={projectPath} onClose={() => setGitPanelOpen(false)} onOpenProject={() => { setGitPanelOpen(false); void openProject(); }} onIncludeDiff={(content, truncated) => { setGitDiffContext(content); setGitDiffTruncated(truncated); setGitPanelOpen(false); }} />}
      {taskRecipesOpen && <TaskRecipes onClose={() => setTaskRecipesOpen(false)} onUse={(recipePrompt) => { setAgentMode(true); setPrompt(recipePrompt); }} />}
      {commandPaletteOpen && <CommandPalette commands={commandHistory.map((item) => ({ ...item, shell: shellNames[item.shell] }))} actions={paletteActions} view={commandPaletteView} onClose={() => setCommandPaletteOpen(false)} />}
      {helpOpen && <HelpDialog onClose={() => setHelpOpen(false)} onConfigureProvider={() => { setHelpOpen(false); setProviderDialogOpen(true); }} onOpenSettings={() => { setHelpOpen(false); setSettingsOpen(true); }} onOpenPalette={() => { setHelpOpen(false); setCommandPaletteView("all"); setCommandPaletteOpen(true); }} />}
      {notificationsOpen && <NotificationCenter syncNotice={syncNotice} onClose={() => setNotificationsOpen(false)} onOpenUpdates={() => { setNotificationsOpen(false); setUpdateSettingsOpen(true); }} onOpenAccount={() => { setNotificationsOpen(false); setAccountSettingsOpen(true); }} />}

      {contextPreview && <div className="dialog-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setContextPreview(null); }}>
        <section className="context-preview-dialog" role="dialog" aria-modal="true" aria-labelledby="context-preview-title">
          <button className="dialog-close" onClick={() => setContextPreview(null)} aria-label="Cerrar">×</button>
          <div className="dialog-mark"><PaperclipIcon /></div><p className="eyebrow">DATOS QUE SE ADJUNTAN</p><h2 id="context-preview-title">Revisa el contexto</h2>
          <p className="dialog-copy">Este contenido se enviará al proveedor activo al mandar el siguiente mensaje. Comprueba que no incluya credenciales o datos privados.</p>
          <span className="context-size">{contextPreview.totalCharacters.toLocaleString("es-ES")} caracteres</span>
          {[ ["Salida de terminal", contextPreview.terminal], ["Proyecto", contextPreview.project], ["Archivos elegidos", contextPreview.selectedFiles], ["Diff Git seleccionado", contextPreview.gitDiff] ].map(([title, content]) => <details className="context-preview-section" key={title} open={Boolean(content)}>
            <summary>{title}<span>{content ? `${content.length.toLocaleString("es-ES")} caracteres` : "Sin contenido"}</span></summary>
            <pre>{content || "No se enviará contenido de esta fuente."}</pre>
          </details>)}
          <div className="provider-actions"><button className="primary-button" onClick={() => setContextPreview(null)}>Listo</button></div>
        </section>
      </div>}

      {contextPreviewBusy && <div className="context-preview-loading" role="status">Preparando vista previa…</div>}

      {providerDialogOpen && <div className="dialog-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) closeProviderDialog(); }}>
        <section className="provider-dialog" role="dialog" aria-modal="true" aria-labelledby="provider-title">
          <button className="dialog-close" onClick={closeProviderDialog} aria-label="Cerrar">×</button>
          <div className="dialog-mark"><SparkIcon /></div><p className="eyebrow">CONFIGURACIÓN LOCAL</p><h2 id="provider-title">Conecta tu proveedor</h2>
          <p className="dialog-copy">Usa Ollama, LM Studio o cualquier endpoint compatible con OpenAI. La clave se guarda en el almacén de credenciales de Windows.</p>
          <div className="form-row">
            <label className="form-label">Perfiles guardados
              <select value={editingProviderId ?? ""} onChange={(event) => event.currentTarget.value ? void selectSavedProvider(event.currentTarget.value) : newProviderProfile()} disabled={providerBusy}>
                <option value="">Nuevo perfil…</option>{providers.map((item) => <option key={item.id} value={item.id}>{item.name} · {item.model}</option>)}
              </select>
            </label>
            <button className="secondary-button model-refresh" onClick={newProviderProfile} disabled={providerBusy}>Nuevo</button>
          </div>
          <label className="form-label">Tipo de proveedor
            <select value={providerKind} onChange={(event) => chooseProvider(event.currentTarget.value)}>
              <option value="freellmapi">FreeLLMAPI</option><option value="ollama">Ollama</option><option value="lmstudio">LM Studio</option><option value="custom">Otro endpoint compatible</option>
            </select>
          </label>
          <label className="form-label">Nombre
            <input value={providerName} onChange={(event) => setProviderName(event.currentTarget.value)} placeholder="Mi proveedor" />
          </label>
          <label className="form-label">URL base
            <input readOnly={editingProviderId !== null} title={editingProviderId ? "Crea un perfil nuevo para cambiar el destino" : undefined} value={baseUrl} onChange={(event) => setBaseUrl(event.currentTarget.value)} placeholder="http://127.0.0.1:1234/v1" autoCapitalize="off" autoCorrect="off" />
          </label>
          <label className="transfer-check"><input type="checkbox" checked={shareCustomEndpoint} onChange={(event) => setShareCustomEndpoint(event.currentTarget.checked)} /> Permitir sincronizar esta URL si activo la sincronización</label>
          <p className="dialog-copy">Desactivado por defecto. La URL solo se enviará a la cuenta de Laural si activas la sincronización; ese servicio todavía no está disponible.</p>
          <div className="form-row">
            <label className="form-label">Modelo
              <input value={model} onChange={(event) => setModel(event.currentTarget.value)} list="provider-model-list" placeholder="Selecciona o escribe un modelo" autoCapitalize="off" autoCorrect="off" />
              <datalist id="provider-model-list">{models.map((item) => <option key={item} value={item} />)}</datalist>
            </label>
            <button className="secondary-button model-refresh" onClick={() => void testProvider()} disabled={providerBusy}>Probar</button>
          </div>
          <label className="form-label">Clave API <span className="optional-label">opcional para endpoints locales</span>
            <input type="password" value={apiKey} onChange={(event) => setApiKey(event.currentTarget.value)} placeholder={editingHasApiKey ? "Clave guardada · deja vacío para mantenerla" : "Pega una clave nueva"} autoComplete="new-password" />
          </label>
          {providerError && <div className="form-message error">{providerError}</div>}
          {providerNotice && <div className="form-message success">{providerNotice}</div>}
          <div className="provider-actions"><button className="secondary-button" onClick={() => void testProvider()} disabled={providerBusy}>{providerBusy ? "Conectando…" : "Probar conexión y modelos"}</button><button className="primary-button" onClick={() => void saveProvider()} disabled={providerBusy || !model.trim()}>{providerBusy ? "Guardando…" : "Guardar proveedor"}</button></div>
          <div className="dialog-footnote"><LockIcon /> La clave nunca se escribe en el archivo de configuración.</div>
        </section>
      </div>}

      {settingsOpen && <SettingsDialog onClose={() => setSettingsOpen(false)}>
        <button className="settings-link" onClick={() => { setSettingsOpen(false); setAppearanceOpen(true); }}>Apariencia <span>{activeTheme.name} · {appearance === "dark" ? "Oscuro" : "Claro"}</span></button>
        <button className="settings-link" onClick={() => { setSettingsOpen(false); setProviderDialogOpen(true); }}>Proveedores y modelos <span>{provider?.name ?? "Configurar"}</span></button>
        <button className="settings-link" onClick={() => { setSettingsOpen(false); setTransferOpen(true); }}>Importar y exportar <span>Configuración entre equipos</span></button>
        <button className="settings-link" onClick={() => { setSettingsOpen(false); setAccountSettingsOpen(true); }}>Cuenta y sincronización <span>Inicio de sesión de Laural</span></button>
        <button className="settings-link" onClick={() => { setSettingsOpen(false); setUpdateSettingsOpen(true); }}>Actualizaciones <span>Versión y preferencias</span></button>
        <div className="agent-policy-panel">
              <label>Permisos del agente
                <select value={executionMode} onChange={(event) => void changeExecutionMode(event.currentTarget.value as ExecutionMode)}>
                  <option value="review">Confirmar cada comando</option>
                  <option value="rules">Ejecutar reglas permitidas</option>
                  <option value="automatic">Automático para consultas de estado de Git</option>
                </select>
              </label>
              {executionMode === "rules" && <div className="rules-editor">
                <textarea value={ruleDraft} onChange={(event) => setRuleDraft(event.currentTarget.value)} placeholder="Un comando exacto por línea" aria-label="Comandos exactos permitidos, uno por línea" rows={3} />
                <button onClick={() => void saveExecutionRules()}>Guardar reglas</button>
              </div>}
              <BackupRetentionControl value={backupRetention} onChange={(value) => void changeBackupRetention(value)} />
              {policyNotice && <span className="policy-notice">{policyNotice}</span>}
              <p>Los cambios de archivos siempre requieren aprobación.</p>
              <p>Los filtros no aíslan el shell. PowerShell, WSL y Git Bash pueden cargar perfiles con alias y funciones personalizados, así que los modos automático y por reglas requieren confirmación manual. CMD se inicia con AutoRun desactivado. Revisa cada comando antes de aprobarlo.</p>
            </div>
        <AgentActivity />
        <button className="action-quiet" onClick={clearChat} disabled={!chatMessages.length || chatBusy || agentPlanBusy || agentCommandBusy}>Borrar historial del chat</button>
      </SettingsDialog>}
      {transferOpen && <ConfigurationTransfer
        preferences={{
          themeId,
          appearance,
          updateMode: localStorage.getItem("laural.update-mode.v1") === "automatic" ? "automatic" : "manual",
        }}
        onClose={() => { setTransferOpen(false); setSettingsOpen(true); }}
        onImported={applyImportedConfiguration}
      />}
      {accountSettingsOpen && <AccountSettings
        preferences={{
          themeId,
          appearance,
          updateMode: localStorage.getItem("laural.update-mode.v1") === "automatic" ? "automatic" : "manual",
        }}
        onImported={applyImportedConfiguration}
        onSyncSettled={clearSyncNotice}
        syncRiskAcknowledged={syncRiskAcknowledged}
        onAcknowledgeSyncRisk={acknowledgeSyncRisk}
        onClose={() => setAccountSettingsOpen(false)}
      />}
      </Suspense>
      {appearanceOpen && <div className="dialog-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setAppearanceOpen(false); }}>
        <section className="appearance-dialog" role="dialog" aria-modal="true" aria-labelledby="appearance-title">
          <button className="dialog-close" onClick={() => setAppearanceOpen(false)} aria-label="Cerrar">×</button>
          <div className="dialog-mark"><PaletteIcon /></div><p className="eyebrow">PERSONALIZACIÓN</p><h2 id="appearance-title">Apariencia</h2>
          <p className="dialog-copy">Elige un tema de color y el modo de visualización. La preferencia se guarda solo en este equipo.</p>
          <div className="appearance-mode" role="group" aria-label="Modo de color">
            <button className={appearance === "light" ? "selected" : ""} aria-pressed={appearance === "light"} onClick={() => setAppearance("light")}><SunIcon /> Claro</button>
            <button className={appearance === "dark" ? "selected" : ""} aria-pressed={appearance === "dark"} onClick={() => setAppearance("dark")}><MoonIcon /> Oscuro</button>
          </div>
          <div className="theme-picker-heading"><strong>Temas</strong><span>{themes.length} disponibles</span></div>
          <div className="theme-grid" role="group" aria-label="Temas de color">
            {themes.map((theme) => <button key={theme.id} className={`theme-choice ${themeId === theme.id ? "selected" : ""}`} aria-pressed={themeId === theme.id} onClick={() => setThemeId(theme.id)}>
              <span className="theme-swatch"><i style={{ backgroundColor: theme.accentDark }} /><i style={{ backgroundColor: theme.accentLight }} /><i className="theme-swatch-surface" /></span>
              <span className="theme-choice-name">{theme.name}</span><span className="theme-choice-check" aria-hidden="true">{themeId === theme.id ? "✓" : ""}</span>
            </button>)}
          </div>
        </section>
      </div>}
    </main>
  );
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

export default App;
