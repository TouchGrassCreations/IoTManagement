export type InventoryItem = {
  id: string;
  name: string;
  model: string | null;
  category: string;
  quantity: number;
  location: string;
  code: string;
  description: string;
  tags: string[];
  /** Thumbnails are fetched from the per-part photo endpoint, not inlined here. */
  hasImage: boolean;
  /** Doubles as the thumbnail cache key. */
  updatedAt: string;
};

export type InventoryPage = {
  items: InventoryItem[];
  nextCursor: string | null;
};

export type InventorySummary = {
  totalTypes: number;
  totalUnits: number;
  photographed: number;
  categories: { category: string; count: number }[];
  locations: { location: string; count: number }[];
};

export type RemoveInventoryInput = {
  id: string;
  quantity: number;
  expectedCurrentQuantity: number;
};

export type SetInventoryImageInput = {
  id: string;
  image: string | null;
};

export type RemoveInventoryResult =
  | { deleted: true; id: string }
  | { deleted: false; item: InventoryItem };

export type UpdateInventoryInput = {
  id: string;
  name?: string;
  model?: string | null;
  category?: string;
  location?: string;
  description?: string;
  tags?: string[];
  /** Signed delta applied to stock; the absolute quantity is never set directly. */
  quantityDelta?: number;
  expectedCurrentQuantity: number;
};

export type UpdateInventoryResult = {
  item: InventoryItem;
  /** Set when the edit collided with an existing identity and the rows merged. */
  mergedFromId: string | null;
};
