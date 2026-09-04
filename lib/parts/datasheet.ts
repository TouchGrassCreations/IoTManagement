/**
 * Datasheets live wherever the manufacturer put them, and a guessed vendor URL
 * built from a model number 404s as often as it resolves. A search always
 * lands somewhere useful, so that is what a part card links to.
 */

const SEARCH_ENDPOINT = "https://www.google.com/search?q=";

export type DatasheetSubject = { name: string; model: string | null };

function collapse(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

/** Searches on the confirmed model, falling back to the part's name when there is none. */
export function datasheetQuery(part: DatasheetSubject): string | null {
  const subject = collapse(part.model ?? "") || collapse(part.name);
  return subject ? `${subject} datasheet` : null;
}

export function datasheetSearchUrl(part: DatasheetSubject): string | null {
  const query = datasheetQuery(part);
  return query ? `${SEARCH_ENDPOINT}${encodeURIComponent(query)}` : null;
}
