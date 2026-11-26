import { expect, test, vi } from "vitest";
import {
  PROJECT_WORKSPACE_STORAGE_KEY,
  addProjectPath,
  projectPathIdentity,
  readProjectWorkspace,
  removeProjectPath,
  writeProjectWorkspace,
  type ProjectWorkspace,
} from "../src/projectWorkspace";

const workspace: ProjectWorkspace = {
  paths: ["C:/repos/laural", "C:/repos/meridiano"],
  activePath: "C:/repos/laural",
};

test("restaura proyectos únicos, filtra rutas inválidas y valida el proyecto activo", () => {
  const storage = {
    getItem: () => JSON.stringify({
      paths: ["C:\\repos\\laural", "c:/repos/laural/", "", 4, "C:/repos/meridiano"],
      activePath: "c:/repos/meridiano/",
    }),
  };

  expect(readProjectWorkspace(storage)).toEqual({
    paths: ["C:\\repos\\laural", "C:/repos/meridiano"],
    activePath: "C:/repos/meridiano",
  });
});

test("usa el primer proyecto como fallback cuando el activo guardado no pertenece a la lista", () => {
  const storage = { getItem: () => JSON.stringify({ paths: ["C:/repos/laural"], activePath: "C:/otro" }) };
  expect(readProjectWorkspace(storage)).toEqual({ paths: ["C:/repos/laural"], activePath: "C:/repos/laural" });
  expect(readProjectWorkspace({ getItem: () => JSON.stringify({ paths: ["C:/repos/laural"] }) }))
    .toEqual({ paths: ["C:/repos/laural"], activePath: "C:/repos/laural" });
  expect(readProjectWorkspace({ getItem: () => JSON.stringify({ paths: [] }) }))
    .toEqual({ paths: [], activePath: null });
});

test("tolera almacenamiento ausente, JSON o estructura inválidos y errores de lectura", () => {
  expect(readProjectWorkspace({ getItem: () => null })).toEqual({ paths: [], activePath: null });
  expect(readProjectWorkspace({ getItem: () => "{" })).toEqual({ paths: [], activePath: null });
  expect(readProjectWorkspace({ getItem: () => JSON.stringify([]) })).toEqual({ paths: [], activePath: null });
  expect(readProjectWorkspace({ getItem: () => JSON.stringify({ paths: "not-an-array" }) })).toEqual({ paths: [], activePath: null });
  expect(readProjectWorkspace({ getItem: () => { throw new Error("blocked"); } })).toEqual({ paths: [], activePath: null });
});

test("normaliza separadores y mayúsculas de Windows para identificar una carpeta", () => {
  expect(projectPathIdentity("C:\\repos\\laural\\")).toBe("c:/repos/laural");
  expect(projectPathIdentity("/")).toBe("/");
});

test("añade y activa proyectos sin duplicar la misma ruta y rechaza entradas inválidas", () => {
  const added = addProjectPath(workspace, "C:/repos/nuevo");
  expect(added.paths).toEqual([...workspace.paths, "C:/repos/nuevo"]);
  expect(added.activePath).toBe("C:/repos/nuevo");

  const duplicate = addProjectPath(added, "c:\\repos\\nuevo\\");
  expect(duplicate).toEqual(added);
  expect(addProjectPath(workspace, "  ")).toBe(workspace);
  expect(addProjectPath(workspace, "x".repeat(4_097))).toBe(workspace);
});

test("al cerrar un proyecto activo activa el siguiente y al cerrar el último deja la lista vacía", () => {
  expect(removeProjectPath(workspace, "c:\\repos\\laural")).toEqual({
    paths: ["C:/repos/meridiano"],
    activePath: "C:/repos/meridiano",
  });
  expect(removeProjectPath(workspace, "C:/repos/meridiano")).toEqual({
    paths: ["C:/repos/laural"],
    activePath: "C:/repos/laural",
  });
  expect(removeProjectPath({ paths: ["C:/repos/laural"], activePath: "C:/repos/laural" }, "C:/repos/laural"))
    .toEqual({ paths: [], activePath: null });
  expect(removeProjectPath(workspace, " ")).toBe(workspace);
});

test("guarda solo el workspace local y tolera la cuota de almacenamiento agotada", () => {
  const setItem = vi.fn();
  writeProjectWorkspace({ setItem }, workspace);
  expect(setItem).toHaveBeenCalledWith(PROJECT_WORKSPACE_STORAGE_KEY, JSON.stringify(workspace));
  expect(() => writeProjectWorkspace({ setItem: () => { throw new Error("quota"); } }, workspace)).not.toThrow();
});
