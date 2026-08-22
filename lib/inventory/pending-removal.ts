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
  let pending: { operation: PendingRemovalOperation; timeout: unknown } | null = null;

  return {
    schedule(operation: PendingRemovalOperation): boolean {
      if (pending) return false;
      operation.onOptimistic();
      const timeout = timer.setTimeout(async () => {
        if (!pending || pending.operation !== operation) return;
        pending = null;
        try {
          const result = await operation.commit();
          operation.onCommitted?.(result);
        } catch (error) {
          operation.onRestore();
          operation.onError?.(error);
        }
      }, delayMs);
      pending = { operation, timeout };
      return true;
    },
    undo(): boolean {
      if (!pending) return false;
      timer.clearTimeout(pending.timeout);
      const { operation } = pending;
      pending = null;
      operation.onRestore();
      return true;
    },
    hasPending(): boolean { return pending !== null; },
    dispose(): void {
      if (!pending) return;
      timer.clearTimeout(pending.timeout);
      pending = null;
    },
  };
}
