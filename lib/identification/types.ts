export type BoundingBox = { top: number; left: number; width: number; height: number };
export type Alternative = { name: string; model: string | null };
export type Detection = {
  name: string; model: string | null; category: string; quantity: number;
  boundingBox: BoundingBox; confidence: number; visibleMarkings: string[];
  alternatives: Alternative[]; description: string; tags: string[];
};
export type ReviewItem = Omit<Detection, "boundingBox" | "confidence"> & { id: string; accepted: boolean; source: "gemini" | "manual"; boundingBox: BoundingBox | null; confidence: number | null; detectedName: string | null; detectedModel: string | null; location: string; image: string | null };
export type ConfirmRequest = { token: string; items: ReviewItem[] };
export type InventoryResult = { id: string; name: string; model: string | null; category: string; quantity: number; location: string; description: string; tags: string[]; image: string | null };
