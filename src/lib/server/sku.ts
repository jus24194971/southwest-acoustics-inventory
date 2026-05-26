/**
 * VIN-style SKU generator.
 *
 * Format (40 characters, fixed length):
 *
 *   CAT - BRAND - MODEL - COND - YY - SEQ  - A1  - A2  - A3  - A4  - A5
 *    2     3       3       1     2    4      3     3     3     3     3
 *
 * Example for a chrome tuner: `HW-XXX-TUN-N-26-0001-CHR-XXX-XXX-XXX-XXX`
 *
 * Example for an SA Telecaster build with black body / silver hardware
 * / humbucker pickups / 50s wiring / standard variant:
 *   `SA-XXX-TEL-N-26-0001-BLK-SLV-HUM-50S-STD`
 *
 * Attribute meaning is per-category, defined by category.attr_N_label.
 * The reserved value `XXX` means "no value / not meaningful for this
 * category." The reserved value `UNQ` means "one-of-a-kind — see
 * item.attr_N_unique_desc for the freeform description."
 *
 * The sequence number is allocated transactionally per (category, year)
 * via the sku_sequence table.
 */

import type { D1Database } from '@cloudflare/workers-types';

export type Condition = 'N' | 'U' | 'R' | 'B';

export function isCondition(value: string): value is Condition {
	return value === 'N' || value === 'U' || value === 'R' || value === 'B';
}

/** Normalise a raw 3-char-ish input into 3 uppercase alphanumeric chars,
 *  right-padded with X if too short. We pad rather than reject because
 *  the SKU is for scanning, not for the user to recite by heart. */
export function normaliseModelCode(raw: string): string {
	const stripped = raw.replace(/[^A-Za-z0-9]/g, '').toUpperCase();
	if (stripped.length >= 3) return stripped.slice(0, 3);
	return stripped.padEnd(3, 'X');
}

export function normaliseBrandCode(raw: string): string {
	return normaliseModelCode(raw); // same 3-char rules
}

/** Normalise an attribute slot value. Empty / null becomes the reserved
 *  'XXX' (no value). Otherwise: strip non-alphanum, uppercase, pad/trim
 *  to exactly 3 chars. */
export function normaliseAttr(raw: string | null | undefined): string {
	if (raw == null) return 'XXX';
	const stripped = raw.replace(/[^A-Za-z0-9]/g, '').toUpperCase();
	if (stripped.length === 0) return 'XXX';
	return stripped.padEnd(3, 'X').slice(0, 3);
}

/** Reserved attribute values. UNQ means "see _unique_desc"; XXX means
 *  "no value here." */
export const ATTR_UNIQUE = 'UNQ';
export const ATTR_EMPTY = 'XXX';

/**
 * Reserve and return the next sequence number for (categoryCode, yearYY).
 * UPSERT pattern with RETURNING — atomic on D1.
 */
async function allocateSequence(
	db: D1Database,
	categoryCode: string,
	yearYY: number
): Promise<number> {
	const row = await db
		.prepare(
			`INSERT INTO sku_sequence (category_code, year_yy, next_value)
			 VALUES (?, ?, 2)
			 ON CONFLICT(category_code, year_yy)
			 DO UPDATE SET next_value = next_value + 1
			 RETURNING next_value - 1 AS reserved`
		)
		.bind(categoryCode, yearYY)
		.first<{ reserved: number }>();

	if (!row) throw new Error('Failed to allocate SKU sequence — unexpected D1 response.');
	return row.reserved;
}

export interface SkuParts {
	categoryCode: string;
	brandCode: string;
	modelCode: string;
	condition: Condition;
	yearReceived: number; // 4-digit
	/** Five category-specific attribute slots. Each must be 3 chars after
	 *  normaliseAttr(). Pass undefined / empty string / null for a slot
	 *  to use the reserved 'XXX' (no value). */
	attr1?: string | null;
	attr2?: string | null;
	attr3?: string | null;
	attr4?: string | null;
	attr5?: string | null;
}

/**
 * Generate a fresh SKU, reserving the sequence number in the same call.
 * The returned string is canonical, 40 chars long, ready to persist.
 */
export async function generateSku(db: D1Database, parts: SkuParts): Promise<string> {
	const yearYY = parts.yearReceived % 100;
	const seq = await allocateSequence(db, parts.categoryCode, yearYY);

	const brand = normaliseBrandCode(parts.brandCode);
	const model = normaliseModelCode(parts.modelCode);
	const yy = String(yearYY).padStart(2, '0');
	const seqStr = String(seq).padStart(4, '0');
	const a1 = normaliseAttr(parts.attr1);
	const a2 = normaliseAttr(parts.attr2);
	const a3 = normaliseAttr(parts.attr3);
	const a4 = normaliseAttr(parts.attr4);
	const a5 = normaliseAttr(parts.attr5);

	return `${parts.categoryCode}-${brand}-${model}-${parts.condition}-${yy}-${seqStr}-${a1}-${a2}-${a3}-${a4}-${a5}`;
}
