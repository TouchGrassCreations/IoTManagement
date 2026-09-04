/**
 * D1 holds the only copy of a cabinet, so an owner needs a way to take the
 * catalogue out and put it back. Parsing and serialising live here as pure
 * functions; the upsert that applies an import lives with its route.
 */

import { INVENTORY_CATEGORIES, normalizeIdentity } from "../identification/validation.ts";
import type { InventoryItem } from "./types.ts";

/** Matches the catalogue's own convention for a part whose model is unknown. */
export const UNKNOWN_MODEL_KEY = "__unknown__";

export const INVENTORY_CSV_COLUMNS = [
  "id",
  "name",
  "model",
  "category",
  "quantity",
  "location",
  "code",
  "description",
  "tags",
  "hasImage",
  "updatedAt",
] as const;

/** A whole import is refused past this, rather than quietly stopping halfway. */
export const MAX_IMPORT_ROWS = 500;
const MAX_TAGS = 10;
const MAX_QUANTITY = 999_999;

export type CsvRowError = { row: number; message: string };

export class CsvImportError extends Error {
  code = "INVALID_PAYLOAD" as const;
  rows: CsvRowError[];
  constructor(message: string, rows: CsvRowError[] = []) {
    super(message);
    this.rows = rows;
  }
}

export type InventoryImportRow = {
  name: string;
  model: string | null;
  category: string;
  quantity: number;
  location: string;
  description: string;
  tags: string[];
  /** The identity an import merges on, matching `idx_inventory_identity`. */
  normalizedName: string;
  modelKey: string;
};

export function modelKeyFor(model: string | null): string {
  return model ? normalizeIdentity(model) : UNKNOWN_MODEL_KEY;
}

function escapeField(value: string): string {
  return /["\r\n,]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

export function toCsvRow(fields: string[]): string {
  return fields.map(escapeField).join(",");
}

/**
 * RFC 4180 reader: a quoted field may hold commas, newlines and doubled quotes.
 * Records are returned in file order; the caller counts the header as row 1.
 */
export function parseCsv(source: string): string[][] {
  const text = source.charCodeAt(0) === 0xfeff ? source.slice(1) : source;
  const records: string[][] = [];
  let record: string[] = [];
  let field = "";
  let quoted = false;
  let opened = false;

  const endField = () => {
    record.push(field);
    field = "";
    opened = false;
  };
  const endRecord = () => {
    endField();
    records.push(record);
    record = [];
  };

  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (quoted) {
      if (character !== '"') field += character;
      else if (text[index + 1] === '"') {
        field += '"';
        index += 1;
      } else quoted = false;
      continue;
    }
    if (character === '"' && field === "") {
      quoted = true;
      opened = true;
    } else if (character === ",") endField();
    else if (character === "\n") endRecord();
    else if (character === "\r") {
      if (text[index + 1] === "\n") index += 1;
      endRecord();
    } else field += character;
  }
  if (quoted) throw new CsvImportError("The file ends inside a quoted field, so it cannot be read as CSV.");
  if (field !== "" || opened || record.length > 0) endRecord();
  return records;
}

export function inventoryCsvHeader(): string {
  return toCsvRow([...INVENTORY_CSV_COLUMNS]);
}

export function inventoryCsvRow(item: InventoryItem): string {
  return toCsvRow([
    item.id,
    item.name,
    item.model ?? "",
    item.category,
    String(item.quantity),
    item.location,
    item.code,
    item.description,
    item.tags.join(", "),
    item.hasImage ? "true" : "false",
    item.updatedAt,
  ]);
}

/** The catalogue as one document. Photos stay behind; `hasImage` reports who has one. */
export function inventoryToCsv(items: InventoryItem[]): string {
  return [inventoryCsvHeader(), ...items.map(inventoryCsvRow)].map((line) => `${line}\r\n`).join("");
}

function headerKey(value: string): string {
  return value.trim().toLowerCase().replace(/[^a-z0-9]/g, "");
}

/** Columns an import reads. `id`, `code`, `hasImage` and `updatedAt` export but never import. */
const IMPORTED_COLUMNS = ["name", "model", "category", "quantity", "location", "description", "tags"] as const;
const REQUIRED_COLUMNS = ["name", "category"] as const;

type ImportedColumn = (typeof IMPORTED_COLUMNS)[number];
type Columns = Partial<Record<ImportedColumn, number>>;

function readColumns(header: string[]): Columns {
  const columns: Columns = {};
  header.forEach((raw, index) => {
    const key = headerKey(raw);
    const known = IMPORTED_COLUMNS.find((column) => column === key);
    if (known && columns[known] === undefined) columns[known] = index;
  });
  const missing = REQUIRED_COLUMNS.filter((column) => columns[column] === undefined);
  if (missing.length > 0) {
    throw new CsvImportError(`The file needs a header row with these columns: ${missing.join(", ")}.`);
  }
  return columns;
}

function cell(record: string[], columns: Columns, column: ImportedColumn): string {
  const index = columns[column];
  return index === undefined ? "" : (record[index] ?? "").trim();
}

function bounded(value: string, label: string, max: number): string {
  if (value.length > max) throw new Error(`${label} must be ${max} characters or fewer.`);
  return value;
}

function readRow(record: string[], columns: Columns): InventoryImportRow {
  const name = bounded(cell(record, columns, "name"), "Name", 120);
  if (!name) throw new Error("Name is required.");

  const category = cell(record, columns, "category");
  if (!INVENTORY_CATEGORIES.includes(category as (typeof INVENTORY_CATEGORIES)[number])) {
    throw new Error(`Category "${category}" is not one of the known categories.`);
  }

  const rawQuantity = cell(record, columns, "quantity");
  const quantity = rawQuantity === "" ? 1 : Number(rawQuantity);
  if (!Number.isInteger(quantity) || quantity < 1 || quantity > MAX_QUANTITY) {
    throw new Error("Quantity must be a whole number of at least 1.");
  }

  const model = bounded(cell(record, columns, "model"), "Model", 120) || null;
  const tags = cell(record, columns, "tags").split(",").map((tag) => tag.trim()).filter(Boolean);
  if (tags.length > MAX_TAGS) throw new Error(`A part may carry ${MAX_TAGS} tags at most.`);
  for (const tag of tags) bounded(tag, "Each tag", 120);

  return {
    name,
    model,
    category,
    quantity,
    location: bounded(cell(record, columns, "location"), "Storage location", 120) || "Unsorted",
    description: bounded(cell(record, columns, "description"), "Description", 500),
    tags,
    normalizedName: normalizeIdentity(name),
    modelKey: modelKeyFor(model),
  };
}

export type ParsedInventoryCsv = { rows: InventoryImportRow[]; errors: CsvRowError[] };

/**
 * Validates every row and reports failures against the row they came from. A
 * file past the cap is refused whole rather than imported up to the limit.
 */
export function parseInventoryCsv(text: string): ParsedInventoryCsv {
  const records = parseCsv(text);
  const header = records[0];
  if (!header) throw new CsvImportError("That file is empty.");
  const columns = readColumns(header);

  const body = records.slice(1).map((record, index) => ({ record, row: index + 2 }));
  const filled = body.filter((entry) => entry.record.some((value) => value.trim() !== ""));
  if (filled.length === 0) throw new CsvImportError("That file has a header but no parts.");
  if (filled.length > MAX_IMPORT_ROWS) {
    throw new CsvImportError(
      `That file holds ${filled.length} parts and ${MAX_IMPORT_ROWS} is the most one import may carry.`,
    );
  }

  const rows: InventoryImportRow[] = [];
  const errors: CsvRowError[] = [];
  const seen = new Map<string, number>();

  for (const entry of filled) {
    try {
      const row = readRow(entry.record, columns);
      const identity = `${row.normalizedName}\u0000${row.modelKey}`;
      const duplicate = seen.get(identity);
      if (duplicate !== undefined) throw new Error(`The same part is already on row ${duplicate}.`);
      seen.set(identity, entry.row);
      rows.push(row);
    } catch (failure) {
      errors.push({
        row: entry.row,
        message: failure instanceof Error ? failure.message : "This row could not be read.",
      });
    }
  }

  return { rows, errors };
}
