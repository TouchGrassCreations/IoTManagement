import type { InventoryItem } from "./types.ts";

type PendingQuantityRemoval = { item: Pick<InventoryItem, "id">; quantity: number };

export function projectInventoryWithPending<T extends InventoryItem>(authoritative: T[], pending: PendingQuantityRemoval[]): T[] {
  const removals = new Map(pending.map((operation) => [operation.item.id, operation.quantity]));
  return authoritative.flatMap((item) => {
    const quantity = removals.get(item.id);
    if (quantity === undefined) return [item];
    if (quantity >= item.quantity) return [];
    return [{ ...item, quantity: item.quantity - quantity }];
  });
}
