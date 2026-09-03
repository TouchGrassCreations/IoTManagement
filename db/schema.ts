import { sql } from "drizzle-orm";
import { index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

const createdAt = () => text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`);
const updatedAt = () => text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`);
const ownerId = () => text("owner_id").notNull();

export const inventoryParts = sqliteTable(
  "inventory_parts",
  {
    id: text("id").primaryKey(),
    ownerId: ownerId(),
    name: text("name").notNull(),
    normalizedName: text("normalized_name").notNull(),
    model: text("model"),
    modelKey: text("model_key").notNull(),
    category: text("category").notNull(),
    quantity: integer("quantity").notNull().default(0),
    location: text("location").notNull().default("Unsorted"),
    code: text("code").notNull().default("MODEL-UNKNOWN"),
    description: text("description").notNull().default(""),
    tags: text("tags").notNull().default("[]"),
    image: text("image"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    uniqueIndex("idx_inventory_identity").on(table.ownerId, table.normalizedName, table.modelKey),
    index("idx_inventory_owner_name").on(table.ownerId, table.name),
    index("idx_inventory_owner_category_name").on(table.ownerId, table.category, table.name),
    index("idx_inventory_owner_location_name").on(table.ownerId, table.location, table.name),
  ],
);

export const identificationScans = sqliteTable(
  "identification_scans",
  {
    id: text("id").primaryKey(),
    ownerId: ownerId(),
    confirmationTokenHash: text("confirmation_token_hash").notNull().unique(),
    /** Superseded by ownerId; retained so historical rows keep their value. */
    userId: text("user_id"),
    provider: text("provider").notNull(),
    providerModel: text("provider_model").notNull(),
    acceptedDetectionCount: integer("accepted_detection_count").notNull(),
    createdAt: createdAt(),
  },
  (table) => [index("idx_identification_scans_owner").on(table.ownerId, table.createdAt)],
);

export const identificationEvents = sqliteTable(
  "identification_events",
  {
    id: text("id").primaryKey(),
    ownerId: ownerId(),
    scanId: text("scan_id").notNull(),
    inventoryPartId: text("inventory_part_id").notNull(),
    source: text("source").notNull(),
    detectedName: text("detected_name"),
    detectedModel: text("detected_model"),
    confirmedName: text("confirmed_name").notNull(),
    confirmedModel: text("confirmed_model"),
    quantityAdded: integer("quantity_added").notNull(),
    confidence: integer("confidence"),
    visibleMarkings: text("visible_markings").notNull().default("[]"),
    boundingBox: text("bounding_box"),
    alternatives: text("alternatives").notNull().default("[]"),
    wasEdited: integer("was_edited", { mode: "boolean" }).notNull(),
    capturedImage: integer("captured_image", { mode: "boolean" }).notNull().default(false),
    createdAt: createdAt(),
  },
  (table) => [index("idx_identification_events_owner").on(table.ownerId, table.createdAt)],
);

export const inventoryAdjustmentEvents = sqliteTable(
  "inventory_adjustment_events",
  {
    id: text("id").primaryKey(),
    ownerId: ownerId(),
    inventoryPartId: text("inventory_part_id").notNull(),
    eventType: text("event_type").notNull(),
    quantityBefore: integer("quantity_before").notNull(),
    quantityRemoved: integer("quantity_removed").notNull(),
    quantityAfter: integer("quantity_after").notNull(),
    createdAt: createdAt(),
  },
  (table) => [
    index("idx_inventory_adjustment_events_part_id").on(table.inventoryPartId),
    index("idx_inventory_adjustment_events_owner").on(table.ownerId, table.createdAt),
  ],
);
