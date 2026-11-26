export async function runAccountActionWhenAllowed(allowed: boolean, action: () => Promise<void>): Promise<void> {
  if (allowed) await action();
}

export async function runAccountActionWithSnapshot<T>(
  allowed: boolean,
  snapshot: T | null | undefined,
  action: (snapshot: T) => Promise<void>,
): Promise<void> {
  if (allowed && snapshot) await action(snapshot);
}

export function removeHistoryVersion<TVersion extends { revision: number }, THistory extends { entries: TVersion[] }>(
  history: THistory | null,
  revision: number,
): THistory | null {
  if (!history) return history;
  return { ...history, entries: history.entries.filter((entry) => entry.revision !== revision) };
}
