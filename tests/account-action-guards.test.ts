import { describe, expect, test, vi } from "vitest";
import { removeHistoryVersion, runAccountActionWhenAllowed, runAccountActionWithSnapshot } from "../src/accountActionGuards";

describe("guardas de acciones de cuenta", () => {
  test("no ejecuta una acción sin autorización", async () => {
    const action = vi.fn<() => Promise<void>>();
    await runAccountActionWhenAllowed(false, action);
    expect(action).not.toHaveBeenCalled();
  });

  test("ejecuta una acción autorizada exactamente una vez", async () => {
    const action = vi.fn<() => Promise<void>>().mockResolvedValue(undefined);
    await runAccountActionWhenAllowed(true, action);
    expect(action).toHaveBeenCalledOnce();
  });

  test("solo expone snapshots si la acción está autorizada y el snapshot existe", async () => {
    const action = vi.fn<(snapshot: string) => Promise<void>>().mockResolvedValue(undefined);
    await runAccountActionWithSnapshot(false, "snapshot", action);
    await runAccountActionWithSnapshot(true, null, action);
    expect(action).not.toHaveBeenCalled();

    await runAccountActionWithSnapshot(true, "snapshot", action);
    expect(action).toHaveBeenCalledWith("snapshot");
  });

  test("conserva el historial vacío sin crear un objeto", () => {
    expect(removeHistoryVersion(null, 5)).toBeNull();
  });

  test("elimina solo la revisión solicitada y mantiene los metadatos", () => {
    const history = { entries: [{ revision: 4 }, { revision: 5 }], nextBefore: 3 };
    expect(removeHistoryVersion(history, 4)).toEqual({ entries: [{ revision: 5 }], nextBefore: 3 });
  });
});
