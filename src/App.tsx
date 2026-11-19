import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import TerminalPane from "./components/TerminalPane";
import "./App.css";

type Shell = "powershell" | "cmd" | "wsl" | "git-bash";
type TerminalTab = { id: string; shell: Shell; title: string; cwd: string | null };
type ChatMessage = { role: "user" | "assistant"; content: string };
type Provider = { id: string; name: string; baseUrl: string; model: string; hasApiKey: boolean };
type ExecutionMode = "review" | "rules" | "automatic";
type PlanAction =
  | { type: "run_command"; command: string; reason: string; status?: string; result?: string }
  | { type: "write_file"; path: string; content: string; reason: string; status?: string; result?: string };
type AgentPlan = { summary: string; actions: PlanAction[] };

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
  const [shellMenuOpen, setShellMenuOpen] = useState(false);
  const [agentMode, setAgentMode] = useState(false);
  const [prompt, setPrompt] = useState("");
  const [providerDialogOpen, setProviderDialogOpen] = useState(false);
  const [provider, setProvider] = useState<Provider | null>(null);
  const [providers, setProviders] = useState<Provider[]>([]);
  const [editingProviderId, setEditingProviderId] = useState<string | null>(null);
  const [providerKind, setProviderKind] = useState("freellmapi");
  const [providerName, setProviderName] = useState("FreeLLMAPI");
  const [baseUrl, setBaseUrl] = useState("http://127.0.0.1:31415/v1");
  const [model, setModel] = useState("auto");
  const [apiKey, setApiKey] = useState("");
  const [models, setModels] = useState<string[]>([]);
  const [providerBusy, setProviderBusy] = useState(false);
  const [providerError, setProviderError] = useState("");
  const [providerNotice, setProviderNotice] = useState("");
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [chatBusy, setChatBusy] = useState(false);
  const [contextFiles, setContextFiles] = useState<string[]>([]);
  const [agentPlan, setAgentPlan] = useState<AgentPlan | null>(null);
  const [agentPlanBusy, setAgentPlanBusy] = useState(false);
  const [executionMode, setExecutionMode] = useState<ExecutionMode>("review");
  const [allowedPrefixes, setAllowedPrefixes] = useState(["git status", "git diff"]);
  const [ruleDraft, setRuleDraft] = useState("git status\ngit diff");
  const [policyNotice, setPolicyNotice] = useState("");
  const terminalContextRef = useRef<Record<string, string>>({});

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
    if (saved.name.toLowerCase().includes("freellmapi")) setProviderKind("freellmapi");
    else if (saved.name.toLowerCase().includes("ollama")) setProviderKind("ollama");
    else if (saved.name.toLowerCase().includes("lm studio")) setProviderKind("lmstudio");
    else setProviderKind("custom");
  }

  useEffect(() => {
    void invoke<{ mode: ExecutionMode; allowedPrefixes: string[] }>("get_agent_settings").then((settings) => {
      setExecutionMode(settings.mode);
      setAllowedPrefixes(settings.allowedPrefixes);
      setRuleDraft(settings.allowedPrefixes.join("\n"));
    }).catch(() => undefined);
  }, []);

  const captureTerminalOutput = useCallback((terminalId: string, text: string) => {
    const current = terminalContextRef.current[terminalId] ?? "";
    terminalContextRef.current[terminalId] = (current + text).slice(-24_000);
  }, []);

  const activeTab = useMemo(
    () => tabs.find((tab) => tab.id === activeTabId) ?? tabs[0],
    [activeTabId, tabs],
  );
  const editingHasApiKey = providers.some((item) => item.id === editingProviderId && item.hasApiKey);

  function addTerminal(shell: Shell, cwd: string | null = projectPath) {
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

  function closeTab(tabId: string) {
    const nextTabs = tabs.filter((tab) => tab.id !== tabId);
    setSplitTabId(null);
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
      setSplitTabId(null);
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
  }

  function submitPrompt(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const question = prompt.trim();
    if (!question || chatBusy) return;
    if (!provider) {
      setProviderDialogOpen(true);
      return;
    }
    if (agentMode) {
      setPrompt("");
      setAgentPlan(null);
      setAgentPlanBusy(true);
      setChatMessages((current) => [...current, { role: "user", content: question }]);
      const planTerminalId = activeTabId;
      const shell = activeTab?.shell ?? "powershell";
      void invoke<AgentPlan>("plan_agent", {
        task: question,
        shell,
        terminalContext: terminalContextRef.current[planTerminalId] ?? "",
        projectPath,
        selectedFiles: contextFiles,
      }).then(async (plan) => {
        const prepared: AgentPlan = { ...plan, actions: plan.actions.map((action) => ({ ...action, status: "pending" })) };
        setAgentPlan(prepared);
        setChatMessages((current) => [...current, { role: "assistant", content: `Plan preparado con ${plan.actions.length} acciones.` }]);
        if (executionMode !== "review") {
          for (let index = 0; index < prepared.actions.length; index += 1) {
            if (prepared.actions[index].type === "run_command") {
              await executeAgentCommand(index, false, prepared, planTerminalId);
            }
          }
        }
      }).catch((error) => {
        setChatMessages((current) => [...current, { role: "assistant", content: `No se pudo preparar el plan: ${String(error)}` }]);
      }).finally(() => setAgentPlanBusy(false));
      return;
    }
    const nextMessages = [...chatMessages, { role: "user" as const, content: question }];
    setChatMessages(nextMessages);
    setPrompt("");
    setChatBusy(true);
    void invoke<string>("send_chat", {
      messages: nextMessages,
      terminalContext: terminalContextRef.current[activeTabId] ?? "",
      projectPath,
      selectedFiles: contextFiles,
    }).then((reply) => {
      setChatMessages((current) => [...current, { role: "assistant", content: reply }]);
    }).catch((error) => {
      setChatMessages((current) => [...current, { role: "assistant", content: `No se pudo completar la consulta: ${String(error)}` }]);
    }).finally(() => setChatBusy(false));
  }

  function updateAgentAction(index: number, update: Partial<PlanAction>) {
    setAgentPlan((current) => {
      if (!current) return current;
      const actions = [...current.actions];
      actions[index] = { ...actions[index], ...update } as PlanAction;
      return { ...current, actions };
    });
  }

  async function executeAgentCommand(index: number, approved: boolean, plan = agentPlan, terminalId = activeTabId) {
    const action = plan?.actions[index];
    if (!action || action.type !== "run_command") return;
    updateAgentAction(index, { status: "running", result: undefined });
    try {
      await invoke("run_agent_command", { terminalId, command: action.command, approved });
      updateAgentAction(index, { status: "submitted", result: "Comando enviado a la terminal." });
    } catch (error) {
      const message = String(error);
      const status = message.toLowerCase().includes("requiere") || message.toLowerCase().includes("coincide") ? "needs_review" : "error";
      updateAgentAction(index, { status, result: message });
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

  async function changeExecutionMode(mode: ExecutionMode) {
    setExecutionMode(mode);
    setPolicyNotice("");
    try {
      await invoke("save_agent_settings", { settings: { mode, allowedPrefixes } });
      setPolicyNotice("Política guardada.");
    } catch (error) {
      setPolicyNotice(`No se pudo guardar: ${String(error)}`);
    }
  }

  async function saveExecutionRules() {
    const prefixes = ruleDraft.split(/\r?\n/).map((item) => item.trim()).filter(Boolean);
    setAllowedPrefixes(prefixes);
    try {
      await invoke("save_agent_settings", { settings: { mode: executionMode, allowedPrefixes: prefixes } });
      setPolicyNotice("Reglas guardadas.");
    } catch (error) {
      setPolicyNotice(`No se pudieron guardar las reglas: ${String(error)}`);
    }
  }

  function chooseProvider(kind: string) {
    setProviderKind(kind);
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
        id: editingProviderId ?? `${providerKind}-${providerName.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 48)}`,
        name: providerName,
        baseUrl,
        model,
        apiKey: apiKey.trim() || null,
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
    } catch (error) {
      setProviderError(String(error));
    } finally {
      setProviderBusy(false);
    }
  }

  function newProviderProfile() {
    setEditingProviderId(null);
    setProviderKind("custom"); setProviderName("Nuevo proveedor"); setBaseUrl(""); setModel(""); setApiKey(""); setModels([]);
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
          <button className="icon-button sidebar-menu" aria-label="Abrir menú"><DotsIcon /></button>
        </div>
        <button className="workspace-picker">
          <span className="workspace-avatar">A</span>
          <span className="workspace-copy"><strong>Mi equipo</strong><small>Espacio personal</small></span>
          <ChevronIcon />
        </button>
        <nav className="primary-nav" aria-label="Navegación principal">
          <button className="nav-item active"><TerminalIcon /><span>Terminal</span><kbd>⌘ 1</kbd></button>
          <button className="nav-item" onClick={() => setProviderDialogOpen(true)}><SparkIcon /><span>Asistente IA</span><span className="nav-dot" /></button>
          <button className="nav-item"><HistoryIcon /><span>Historial</span></button>
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
          <button className="profile-row"><span className="profile-avatar">AM</span><span className="profile-name">Perfil local</span><DotsIcon /></button>
        </div>
      </aside>

      <section className="main-column">
        <header className="topbar">
          <div className="breadcrumb"><span className="breadcrumb-muted">Mi equipo</span><ChevronRightIcon /><strong>Terminal</strong></div>
          <div className="topbar-actions">
            <button className="search-button"><SearchIcon /><span>Buscar comandos y sesiones</span><kbd>⌘ K</kbd></button>
            <button className="icon-button top-icon" aria-label="Ayuda"><HelpIcon /></button>
            <button className="icon-button top-icon" aria-label="Notificaciones"><BellIcon /></button>
          </div>
        </header>

        <div className="terminal-toolbar">
          <div className="tabs-strip" role="tablist" aria-label="Sesiones de terminal">
            {tabs.map((tab) => <button className={`terminal-tab ${tab.id === activeTabId ? "selected" : ""}`} key={tab.id} onClick={() => setActiveTabId(tab.id)} role="tab" aria-selected={tab.id === activeTabId}>
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
            <button className={`toolbar-icon ${splitTabId ? "active" : ""}`} aria-label={splitTabId ? "Cerrar panel dividido" : "Dividir panel"} title={splitTabId ? "Cerrar panel dividido" : "Dividir terminal"} onClick={toggleSplit}><SplitIcon /></button>
            <button className="toolbar-icon" aria-label="Más opciones"><DotsIcon /></button>
          </div>
        </div>

        <div className="workspace-body">
          <section className="terminal-area" aria-label="Terminal">
            <div className="terminal-heading">
              <div><div className="terminal-title-line"><span className="terminal-title-mark">⌁</span><h1>{activeTab?.title ?? "Terminal"}</h1><span className="connection-pill"><span /> Local</span></div><p className="terminal-path">{activeTab?.cwd ?? "Directorio de inicio"} <span>·</span> Windows</p></div>
              <div className="terminal-heading-actions"><button className="small-action"><CopyIcon /> Copiar</button><button className="small-action"><ClearIcon /> Limpiar</button></div>
            </div>
            <div className={`terminal-frame ${splitTabId ? "is-split" : ""}`}>
              {tabs.map((tab) => <TerminalPane key={tab.id} terminalId={tab.id} shell={tab.shell} cwd={tab.cwd} visible={tab.id === activeTabId || tab.id === splitTabId} onTextOutput={captureTerminalOutput} />)}
              <div className="terminal-caption"><span className="shortcut-hint"><kbd>Ctrl</kbd> + <kbd>`</kbd> alternar terminal</span><span><span className="activity-pulse" /> Shell conectado</span></div>
            </div>
            <div className="terminal-footer"><div className="footer-left"><span className="footer-branch"><BranchIcon /> main</span><span className="footer-divider" /><span>Sin cambios</span></div><div className="footer-right"><span>UTF-8</span><span>{activeTab?.title ?? "PowerShell"}</span><span>100%</span></div></div>
          </section>

          <aside className="assistant-panel">
            <div className="assistant-header"><div className="assistant-heading"><div className="assistant-avatar"><SparkIcon /></div><div><strong>Asistente</strong><span>Contexto de esta terminal</span></div></div><button className="icon-button" aria-label="Opciones del asistente"><DotsIcon /></button></div>
            <div className="mode-switch" role="tablist" aria-label="Modo de IA">
              <button className={!agentMode ? "active" : ""} onClick={() => setAgentMode(false)} role="tab" aria-selected={!agentMode}><MessageIcon /> Chat</button>
              <button className={agentMode ? "active" : ""} onClick={() => setAgentMode(true)} role="tab" aria-selected={agentMode}><AgentIcon /> Agente <span className="mode-beta">PREVIEW</span></button>
            </div>
            {agentMode && <div className="agent-policy-panel">
              <label>Permisos del agente
                <select value={executionMode} onChange={(event) => void changeExecutionMode(event.currentTarget.value as ExecutionMode)}>
                  <option value="review">Confirmar cada comando</option>
                  <option value="rules">Ejecutar reglas permitidas</option>
                  <option value="automatic">Automático con filtros de riesgo</option>
                </select>
              </label>
              {executionMode === "rules" && <div className="rules-editor">
                <textarea value={ruleDraft} onChange={(event) => setRuleDraft(event.currentTarget.value)} aria-label="Reglas de comandos, una por línea" rows={3} />
                <button onClick={() => void saveExecutionRules()}>Guardar reglas</button>
              </div>}
              {policyNotice && <span className="policy-notice">{policyNotice}</span>}
              <p>Los cambios de archivos siempre requieren aprobación.</p>
            </div>}
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
              {chatMessages.map((message, index) => <article className={`chat-message ${message.role}`} key={`${index}-${message.role}`}>
                <span className="message-avatar">{message.role === "user" ? "Tú" : <SparkIcon />}</span>
                <div className="message-content">{message.content}</div>
              </article>)}
              {agentPlan && <div className="agent-plan-card">
                <div className="agent-plan-header"><span className="plan-icon-small"><AgentIcon /></span><strong>Plan del agente</strong><span>{agentPlan.actions.length} acciones</span></div>
                <p className="agent-plan-summary">{agentPlan.summary}</p>
                <div className="agent-action-list">{agentPlan.actions.map((action, index) => <article className={`agent-action ${action.status ?? "pending"}`} key={`${index}-${action.type}`}>
                  <div className="agent-action-top"><span className="action-number">{index + 1}</span><span className="action-type">{action.type === "run_command" ? "COMANDO" : "CAMBIO DE ARCHIVO"}</span><span className="action-status">{action.status === "submitted" ? "ENVIADO" : action.status === "needs_review" ? "REVISAR" : action.status === "applied" ? "APLICADO" : action.status === "running" || action.status === "applying" ? "EN CURSO" : action.status === "error" ? "ERROR" : action.status === "rejected" ? "DESCARTADO" : "PENDIENTE"}</span></div>
                  <p className="action-reason">{action.reason}</p>
                  {action.type === "run_command" ? <pre className="action-code">{action.command}</pre> : <details className="file-preview"><summary>{action.path}</summary><pre>{action.content}</pre></details>}
                  {action.result && <p className={`action-result ${action.status === "error" || action.status === "needs_review" ? "warning" : ""}`}>{action.result}</p>}
                  <div className="action-buttons">{action.type === "run_command" ? action.status !== "submitted" && action.status !== "rejected" && <button className="action-primary" onClick={() => void executeAgentCommand(index, true)}>{action.status === "needs_review" ? "Revisar y ejecutar" : "Aprobar y ejecutar"}</button> : action.status !== "applied" && action.status !== "rejected" && <button className="action-primary" onClick={() => void applyAgentFile(index)} disabled={!projectPath || action.status === "applying"}>Aplicar cambio</button>}
                    {action.status !== "submitted" && action.status !== "applied" && action.status !== "rejected" && <button className="action-quiet" onClick={() => updateAgentAction(index, { status: "rejected", result: "Acción descartada." })}>Descartar</button>}</div>
                </article>)}</div>
              </div>}
              {(chatBusy || agentPlanBusy) && <div className="typing-indicator"><span /><span /><span /> {agentMode ? "El agente está preparando el plan" : "El modelo está respondiendo"}</div>}
            </div>}
            <div className="composer-wrap">
              <form className="composer" onSubmit={submitPrompt}>
                <textarea value={prompt} onChange={(event) => setPrompt(event.target.value)} placeholder={agentMode ? "Describe una tarea para el agente…" : "Pregunta sobre tu terminal…"} rows={3} />
                {contextFiles.length > 0 && <div className="context-file-list">{contextFiles.map((path) => <button type="button" className="context-file-chip" key={path} title={path} onClick={() => setContextFiles((current) => current.filter((item) => item !== path))}><PaperclipIcon /> {path.split(/[\\/]/).pop()} <span>×</span></button>)}</div>}
                <div className="composer-controls"><div className="composer-left"><button type="button" className="composer-tool" title="Adjuntar archivos" onClick={() => void addContextFiles()}><PaperclipIcon /></button><button type="button" className="context-chip" title="La salida reciente de esta terminal se adjunta al mensaje"><span className="context-indicator" /> Terminal <span>+</span></button>{projectPath && <span className="project-context-chip" title="Se incluirá contexto acotado del proyecto">Proyecto</span>}<button type="button" className="composer-tool" title="Seleccionar modelo" onClick={() => setProviderDialogOpen(true)}><ModelIcon /></button></div><button type="submit" className="send-button" aria-label="Enviar mensaje" disabled={!prompt.trim() || chatBusy || agentPlanBusy}><ArrowUpIcon /></button></div>
              </form>
              <div className="composer-note"><span>{agentMode ? "Modo agente: ejecución pendiente" : provider ? `El contexto seleccionado se enviará a ${provider.name}` : "Conecta un proveedor para empezar"}</span><button onClick={() => setProviderDialogOpen(true)}>{provider ? "Ajustes" : "Configurar modelo"}</button></div>
            </div>
          </aside>
        </div>
      </section>

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
            <input value={baseUrl} onChange={(event) => setBaseUrl(event.currentTarget.value)} placeholder="http://127.0.0.1:1234/v1" autoCapitalize="off" autoCorrect="off" />
          </label>
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
    </main>
  );
}

function TerminalIcon() { return <svg viewBox="0 0 20 20" aria-hidden="true"><rect x="2.5" y="3" width="15" height="14" rx="3"/><path d="m6 8 2.3 2-2.3 2M10.5 12h3.5"/></svg>; }
function SparkIcon() { return <svg viewBox="0 0 20 20" aria-hidden="true"><path d="m10 2 1.7 5.2L17 9l-5.3 1.8L10 16l-1.7-5.2L3 9l5.3-1.8L10 2Z"/><path d="m16 13 .8 2.2L19 16l-2.2.8L16 19l-.8-2.2L13 16l2.2-.8L16 13Z"/></svg>; }
function HistoryIcon() { return <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M3.5 5.8A7 7 0 1 1 3 10"/><path d="M3 3.5v3h3M10 6v4l2.5 1.5"/></svg>; }
function SearchIcon() { return <svg viewBox="0 0 20 20" aria-hidden="true"><circle cx="8.8" cy="8.8" r="5.8"/><path d="m13.2 13.2 4 4"/></svg>; }
function ChevronIcon() { return <svg viewBox="0 0 16 16" aria-hidden="true"><path d="m6 3.5 4.5 4.5L6 12.5"/></svg>; }
function ChevronRightIcon() { return <svg viewBox="0 0 16 16" aria-hidden="true"><path d="m6 3.5 4.5 4.5L6 12.5"/></svg>; }
function DotsIcon() { return <svg viewBox="0 0 20 20" aria-hidden="true"><circle cx="4" cy="10" r="1"/><circle cx="10" cy="10" r="1"/><circle cx="16" cy="10" r="1"/></svg>; }
function PlusIcon() { return <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M10 4v12M4 10h12"/></svg>; }
function HelpIcon() { return <svg viewBox="0 0 20 20" aria-hidden="true"><circle cx="10" cy="10" r="7.3"/><path d="M7.8 7.5a2.3 2.3 0 1 1 3.8 1.7c-.9.7-1.6 1.2-1.6 2.6M10 14.5v.1"/></svg>; }
function BellIcon() { return <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M15.5 8a5.5 5.5 0 0 0-11 0c0 6-2 6-2 7h15c0-1-2-1-2-7ZM8 17h4"/></svg>; }
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
