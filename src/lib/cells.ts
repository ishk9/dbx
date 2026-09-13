// Grid cell helpers: render a jsonb-derived value for display, and coerce a
// user's text edit back into the right JSON type so jsonb_populate_record can
// bind it to the real column type (a number for int columns, a parsed object
// for jsonb, etc.).

/** Display form of a value that came from `to_jsonb`. */
export function renderCell(v: unknown): string {
  if (v === null || v === undefined) return "";
  if (typeof v === "object") return JSON.stringify(v);
  return String(v);
}

/** True for NULL, so the grid can style it distinctly from an empty string. */
export function isNull(v: unknown): boolean {
  return v === null || v === undefined;
}

const NUMERIC = /(int|serial|numeric|decimal|real|double|money)/i;
const JSONISH = /(json|jsonb)/i;
const ARRAYISH = /(\[\]|ARRAY)/i;
const BOOLISH = /bool/i;

/** Coerce a text edit into the JSON type appropriate for `dataType`.
 *  Empty input becomes NULL. Throws on malformed json/array input so the caller
 *  can surface a clear error instead of writing garbage. */
export function coerceInput(dataType: string, input: string): unknown {
  const t = input.trim();
  if (t === "") return null;
  if (BOOLISH.test(dataType)) return t === "true" || t === "t" || t === "1";
  if (NUMERIC.test(dataType)) {
    const n = Number(t);
    if (Number.isNaN(n)) throw new Error(`"${input}" is not a valid number`);
    return n;
  }
  if (JSONISH.test(dataType) || ARRAYISH.test(dataType)) {
    try {
      return JSON.parse(t);
    } catch {
      throw new Error(`"${input}" is not valid JSON`);
    }
  }
  return input; // text-like: keep as-is (don't trim — trailing spaces may matter)
}
