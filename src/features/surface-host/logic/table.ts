/**
 * Pure parser for the `rendererId: "table"` custom-field payload.
 *
 * This is the FRONTEND-side renderer contract for tabular custom fields: a
 * backend that wants a table emits a `custom` field with `rendererId: "table"`
 * and a payload of `{ columns: string[]; rows: (string|number)[][] }`. Cells are
 * coerced to strings. Anything that does not match the shape returns `null`, so
 * the renderer gracefully skips it (never throws on hostile/partial data).
 */

export interface TableData {
	readonly columns: readonly string[];
	readonly rows: readonly (readonly string[])[];
}

function isStringArray(v: unknown): v is unknown[] {
	return Array.isArray(v);
}

function coerceCell(v: unknown): string | null {
	if (typeof v === "string") return v;
	if (typeof v === "number" && Number.isFinite(v)) return String(v);
	if (typeof v === "boolean") return String(v);
	return null;
}

export function parseTablePayload(payload: unknown): TableData | null {
	if (typeof payload !== "object" || payload === null) return null;
	const obj = payload as Record<string, unknown>;

	const rawColumns = obj.columns;
	const rawRows = obj.rows;
	if (!isStringArray(rawColumns) || !isStringArray(rawRows)) return null;

	const columns: string[] = [];
	for (const col of rawColumns) {
		if (typeof col !== "string") return null;
		columns.push(col);
	}

	const rows: string[][] = [];
	for (const row of rawRows) {
		if (!Array.isArray(row)) return null;
		const cells: string[] = [];
		for (const cell of row) {
			const c = coerceCell(cell);
			if (c === null) return null;
			cells.push(c);
		}
		rows.push(cells);
	}

	return { columns, rows };
}
