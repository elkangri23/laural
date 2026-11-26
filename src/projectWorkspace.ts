export type ProjectWorkspace = {
  paths: string[];
  activePath: string | null;
};

export const PROJECT_WORKSPACE_STORAGE_KEY = "laural.projects.v1";

const emptyWorkspace = (): ProjectWorkspace => ({ paths: [], activePath: null });

export function projectPathIdentity(path: string): string {
  const normalized = path.replace(/\\/g, "/").replace(/\/+$/, "");
  return (normalized || "/").toLowerCase();
}

function validProjectPath(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0 && value.length <= 4_096;
}

function uniquePaths(values: unknown[]): string[] {
  const seen = new Set<string>();
  return values.filter((value): value is string => {
    if (!validProjectPath(value)) return false;
    const identity = projectPathIdentity(value);
    if (seen.has(identity)) return false;
    seen.add(identity);
    return true;
  });
}

export function readProjectWorkspace(storage: Pick<Storage, "getItem">): ProjectWorkspace {
  try {
    const raw = storage.getItem(PROJECT_WORKSPACE_STORAGE_KEY);
    if (!raw) return emptyWorkspace();
    const value: unknown = JSON.parse(raw);
    if (!value || typeof value !== "object" || Array.isArray(value)) return emptyWorkspace();
    const record = value as { paths?: unknown; activePath?: unknown };
    if (!Array.isArray(record.paths)) return emptyWorkspace();
    const paths = uniquePaths(record.paths);
    const storedActivePath = record.activePath;
    const activePath = validProjectPath(storedActivePath)
      ? paths.find(path => projectPathIdentity(path) === projectPathIdentity(storedActivePath)) ?? null
      : null;
    return { paths, activePath: activePath ?? paths[0] ?? null };
  } catch {
    return emptyWorkspace();
  }
}

export function addProjectPath(workspace: ProjectWorkspace, path: string): ProjectWorkspace {
  if (!validProjectPath(path)) return workspace;
  const existing = workspace.paths.find(item => projectPathIdentity(item) === projectPathIdentity(path));
  return {
    paths: existing ? workspace.paths : [...workspace.paths, path],
    activePath: existing ?? path,
  };
}

export function removeProjectPath(workspace: ProjectWorkspace, path: string): ProjectWorkspace {
  if (!validProjectPath(path)) return workspace;
  const identity = projectPathIdentity(path);
  const paths = workspace.paths.filter(item => projectPathIdentity(item) !== identity);
  const activeRemoved = workspace.activePath !== null
    && projectPathIdentity(workspace.activePath) === identity;
  return {
    paths,
    activePath: activeRemoved ? paths[0] ?? null : workspace.activePath,
  };
}

export function writeProjectWorkspace(storage: Pick<Storage, "setItem">, workspace: ProjectWorkspace): void {
  try {
    storage.setItem(PROJECT_WORKSPACE_STORAGE_KEY, JSON.stringify(workspace));
  } catch {
    // The workspace remains usable for the current session if local storage is unavailable.
  }
}
