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
};

export type RemoveInventoryInput = {
  id: string;
  quantity: number;
  expectedCurrentQuantity: number;
};

export type CreateInventoryInput = {
  name: string;
  category: string;
  quantity: number;
  location: string;
};

export type RemoveInventoryResult =
  | { deleted: true; id: string }
  | { deleted: false; item: InventoryItem };
