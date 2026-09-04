export type BoundingBox = { top: number; left: number; width: number; height: number };
export type Alternative = { name: string; model: string | null };
/** A build the model thinks this part makes possible. */
export type ProjectIdea = { name: string; reason: string };
export type Detection = {
  name: string;
  model: string | null;
  category: string;
  quantity: number;
  boundingBox: BoundingBox;
  confidence: number;
  visibleMarkings: string[];
  alternatives: Alternative[];
  description: string;
  tags: string[];
  /** An existing project name, copied from the list the server supplied. */
  projectMatch: string | null;
  projectIdeas: ProjectIdea[];
};
export type ReviewItem = Omit<Detection, "boundingBox" | "confidence"> & {
  id: string;
  accepted: boolean;
  source: "gemini" | "manual";
  /** Null for a manually added row, which was never located in a photo. */
  boundingBox: BoundingBox | null;
  confidence: number | null;
  detectedName: string | null;
  detectedModel: string | null;
  location: string;
  image: string | null;
  /** Exactly one of these is set once the reviewer picks a project. */
  projectId: string | null;
  newProjectName: string | null;
  projectReason: string | null;
};
export type ConfirmRequest = { token: string; items: ReviewItem[] };
export type InventoryResult = {
  id: string;
  name: string;
  model: string | null;
  category: string;
  quantity: number;
  location: string;
  description: string;
  tags: string[];
  image: string | null;
};
