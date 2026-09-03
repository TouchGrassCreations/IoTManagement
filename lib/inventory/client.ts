import type { InventoryItem, InventoryPage, InventorySummary, RemoveInventoryResult, UpdateInventoryResult } from "./types.ts";

/** An API failure that carries the status and any payload the route attached. */
export class ApiError extends Error {
  status: number;
  item?: InventoryItem;
  constructor(message: string, status: number, item?: InventoryItem) {
    super(message);
    this.status = status;
    this.item = item;
  }
}

export const SIGN_IN_MESSAGE = "Sign in to open your cabinet.";

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, { cache: "no-store", ...init });
  const payload = (await response.json().catch(() => null)) as (T & { error?: string; item?: InventoryItem }) | null;
  if (!response.ok) {
    throw new ApiError(payload?.error || "That request could not be completed.", response.status, payload?.item);
  }
  if (!payload) throw new ApiError("The server returned an unreadable response.", response.status);
  return payload;
}

export type InventoryListParams = {
  search?: string;
  category?: string | null;
  location?: string | null;
  sort?: string;
  cursor?: string | null;
  limit?: number;
};

export function inventoryListUrl(params: InventoryListParams): string {
  const search = new URLSearchParams();
  if (params.search) search.set("search", params.search);
  if (params.category) search.set("category", params.category);
  if (params.location) search.set("location", params.location);
  if (params.sort) search.set("sort", params.sort);
  if (params.cursor) search.set("cursor", params.cursor);
  if (params.limit) search.set("limit", String(params.limit));
  const query = search.toString();
  return query ? `/api/inventory?${query}` : "/api/inventory";
}

/** Thumbnails are versioned by `updatedAt`, so a changed photo busts the cache. */
export function partPhotoUrl(item: Pick<InventoryItem, "id" | "updatedAt">): string {
  return `/api/inventory/${encodeURIComponent(item.id)}/photo?v=${encodeURIComponent(item.updatedAt)}`;
}

export const fetchInventory = (params: InventoryListParams) => request<InventoryPage>(inventoryListUrl(params));

export const fetchSummary = () => request<InventorySummary>("/api/inventory/summary");

const jsonInit = (method: string, body: unknown): RequestInit => ({
  method,
  headers: { "content-type": "application/json" },
  body: JSON.stringify(body),
});

export const savePartPhoto = (id: string, image: string | null) =>
  request<{ item: InventoryItem }>(`/api/inventory/${encodeURIComponent(id)}/photo`, jsonInit("POST", { image }));

export const updatePart = (id: string, changes: Record<string, unknown>) =>
  request<UpdateInventoryResult>(`/api/inventory/${encodeURIComponent(id)}`, jsonInit("PATCH", changes));

export const removePart = (id: string, quantity: number, expectedCurrentQuantity: number) =>
  request<RemoveInventoryResult>(
    `/api/inventory/${encodeURIComponent(id)}/remove`,
    jsonInit("POST", { quantity, expectedCurrentQuantity }),
  );
