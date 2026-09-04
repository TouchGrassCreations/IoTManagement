import type { D1Like } from "../../../../lib/identification/persistence.ts";
import { partCode } from "../../../../lib/identification/validation.ts";
import { domainErrorResponse, respond } from "../../../../lib/http/respond.ts";
import { routeContext } from "../../../../lib/http/context.ts";
import { CsvImportError, parseInventoryCsv, type InventoryImportRow } from "../../../../lib/inventory/csv.ts";

/** Roughly a full 500-row export with long descriptions, and far short of a worker's limits. */
const MAX_UPLOAD_BYTES = 1_000_000;

export type InventoryImportSummary = { imported: number; created: number; merged: number };

type Dependencies = { apply: (rows: InventoryImportRow[]) => Promise<InventoryImportSummary> };

async function countParts(ownerId: string, db: D1Like): Promise<number> {
  const row = await db
    .prepare("SELECT COUNT(*) AS parts FROM inventory_parts WHERE owner_id = ?")
    .bind(ownerId)
    .first<{ parts: number }>();
  return row?.parts ?? 0;
}

/**
 * Upserts on `(owner_id, normalized_name, model_key)` — the identity the
 * catalogue already merges on — so re-importing a part adds its stock to the
 * row that is already there instead of creating a second one. Blank optional
 * cells leave what is stored alone; a sparse hand-written file must not wipe a
 * description or a bin.
 */
export async function applyInventoryImport(
  rows: InventoryImportRow[],
  ownerId: string,
  db: D1Like,
): Promise<InventoryImportSummary> {
  if (rows.length === 0) return { imported: 0, created: 0, merged: 0 };

  const before = await countParts(ownerId, db);
  const statements = rows.flatMap((row) => [
    db
      .prepare(
        `INSERT INTO inventory_parts
           (id,owner_id,name,normalized_name,model,model_key,category,quantity,location,code,description,tags)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?)
         ON CONFLICT(owner_id,normalized_name,model_key) DO UPDATE SET
           quantity = quantity + excluded.quantity,
           name = excluded.name,
           category = excluded.category,
           location = COALESCE(NULLIF(excluded.location,'Unsorted'),inventory_parts.location),
           code = COALESCE(NULLIF(excluded.code,'MODEL-UNKNOWN'),inventory_parts.code),
           description = COALESCE(NULLIF(excluded.description,''),inventory_parts.description),
           tags = CASE WHEN excluded.tags = '[]' THEN inventory_parts.tags ELSE excluded.tags END,
           updated_at = CURRENT_TIMESTAMP`,
      )
      .bind(
        crypto.randomUUID(),
        ownerId,
        row.name,
        row.normalizedName,
        row.model,
        row.modelKey,
        row.category,
        row.quantity,
        row.location,
        partCode(row.model),
        row.description,
        JSON.stringify(row.tags),
      ),
    // Reading the stock back inside the same batch keeps the audit trail exact:
    // the row's quantity is post-import, so subtracting what arrived gives the
    // level it was at beforehand without a second read that could race.
    db
      .prepare(
        `INSERT INTO inventory_adjustment_events
           (id,owner_id,inventory_part_id,event_type,quantity_before,quantity_removed,quantity_after)
         SELECT ?,?,id,'csv_imported',quantity - ?,0,quantity
         FROM inventory_parts WHERE owner_id = ? AND normalized_name = ? AND model_key = ?`,
      )
      .bind(crypto.randomUUID(), ownerId, row.quantity, ownerId, row.normalizedName, row.modelKey),
  ]);

  await db.batch(statements);
  const created = Math.max(0, Math.min(rows.length, (await countParts(ownerId, db)) - before));
  return { imported: rows.length, created, merged: rows.length - created };
}

/**
 * An import is all or nothing: a file with a single unreadable row changes
 * nothing and reports every problem with the row it came from.
 */
export async function handleInventoryImport(request: Request, deps: Dependencies): Promise<Response> {
  try {
    // Checked from the header first: reading the body to measure it would mean
    // buffering the very upload the cap exists to refuse.
    const declared = Number(request.headers.get("content-length"));
    if (Number.isFinite(declared) && declared > MAX_UPLOAD_BYTES) {
      throw new CsvImportError("That file is too large to import.");
    }
    const text = await request.text();
    if (new Blob([text]).size > MAX_UPLOAD_BYTES) throw new CsvImportError("That file is too large to import.");
    const { rows, errors } = parseInventoryCsv(text);
    if (errors.length > 0) {
      throw new CsvImportError(
        `${errors.length} ${errors.length === 1 ? "row" : "rows"} could not be read, so nothing was imported.`,
        errors,
      );
    }
    return Response.json(await deps.apply(rows));
  } catch (error) {
    const rows = error instanceof CsvImportError && error.rows.length > 0 ? { rows: error.rows } : undefined;
    const mapped = domainErrorResponse(error, rows);
    if (mapped) return mapped;
    console.error("Inventory import failed", error);
    return Response.json({ error: "The file could not be imported. Please retry." }, { status: 500 });
  }
}

export async function POST(request: Request): Promise<Response> {
  return respond("Inventory import", async () => {
    const { ownerId, db } = await routeContext(request);
    return handleInventoryImport(request, { apply: (rows) => applyInventoryImport(rows, ownerId, db) });
  });
}
