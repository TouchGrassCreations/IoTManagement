import type { InventoryItem, RemoveInventoryResult } from "./types.ts";

type Timer = {
  setTimeout(callback: () => void | Promise<void>, delayMs: number): unknown;
  clearTimeout(id: unknown): void;
};

export type PendingRemovalOperation = {
  item: InventoryItem;
  quantity: number;
  commit: () => Promise<RemoveInventoryResult | void>;
  onOptimistic: () => void;
  onRestore: () => void;
  onCommitted?: (result: RemoveInventoryResult | void) => void;
  onError?: (error: unknown) => void;
};

export function createPendingRemoval(options?: { delayMs?: number; timer?: Timer }) {
  const delayMs = options?.delayMs ?? 10_000;
  const timer: Timer = options?.timer ?? {
    setTimeout: (callback, delay) => globalThis.setTimeout(callback, delay),
    clearTimeout: (id) => globalThis.clearTimeout(id as ReturnType<typeof setTimeout>),
  };
  const pending = new Map<string, { operation: PendingRemovalOperation; timeout: unknown }>();

  return {
    schedule(operation: PendingRemovalOperation): boolean {
      const id = operation.item.id;
      if (pending.has(id)) return false;
      operation.onOptimistic();
      const timeout = timer.setTimeout(async () => {
        const entry = pending.get(id);
        if (!entry || entry.operation !== operation) return;
        pending.delete(id);
        try {
          const result = await operation.commit();
          operation.onCommitted?.(result);
        } catch (error) {
          operation.onRestore();
          operation.onError?.(error);
        }
      }, delayMs);
      pending.set(id, { operation, timeout });
      return true;
    },
    undo(id: string): boolean {
      const entry = pending.get(id);
      if (!entry) return false;
      timer.clearTimeout(entry.timeout);
      pending.delete(id);
      const { operation } = entry;
      operation.onRestore();
      return true;
    },
    hasPending(id?: string): boolean { return id === undefined ? pending.size > 0 : pending.has(id); },
    pendingIds(): string[] { return [...pending.keys()]; },
    dispose(): void {
      for (const entry of pending.values()) timer.clearTimeout(entry.timeout);
      pending.clear();
    },
  };
}
