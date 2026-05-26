/**
 * VIN-style SKU generator.
 *
 * Format:  CAT - BRAND - MODEL - COND - YY - SEQ
 *          BD  - FEN   - STR   - U    - 25 - 0042
 *           │     │      │       │      │     │
 *           │     │      │       │      │     └─ 4-digit sequence, per (CAT, YY)
 *           │     │      │       │      └─────── 2-digit year
 *           │     │      │       └────────────── condition: N/U/R/B
 *           │     │      └────────────────────── 3-char model
 *           │     └───────────────────────────── 3-char brand code
 *           └─────────────────────────────────── 2-char category code
 *
 * The sequence number is allocated transactionally per (category, year)
 * via the `sku_sequence` table, so two simultaneous receives can't both
 * grab the same number.
 */

import type { D1Database } from '@cloudflare/workers-types';

export type Condition = 'N' | 'U' | 'R' | 'B';

export function isCondition(value: string): value is Condition {
	return value === 'N' || value === 'U' || value === 'R' || value === 'B';
}

/** Normalise a raw model string into 3 uppercase alphanumeric chars,
 *  right-padded with X if too short. We do this rather than rejecting
 *  short input because Dad shouldn't have to think about it; the SKU is
 *  for scanning, not for him to memorise. */
export function normaliseModelCode(raw: string): string {
	const stripped = raw.replace(/[^A-Za-z0-9]/g, '').toUpperCase();
	if (stripped.length >= 3) return stripped.slice(0, 3);
	return stripped.padEnd(3, 'X');
}

export function normaliseBrandCode(raw: string): string {
	return normaliseModelCode(raw); // same 3-char rules
}

/**
 * Reserve and return the next sequence number for (categoryCode, yearYY).
 *
 * Uses INSERT ON CONFLICT to atomically bump the counter. D1 supports
 * standard SQLite syntax including this UPSERT pattern.
 */
async function allocateSequence(
	db: D1Database,
	categoryCode: string,
	yearYY: number
): Promise<number> {
	// Bump the counter. RETURNING is supported on D1 (SQLite ≥3.35).
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

	if (!row) {
		throw new Error('Failed to allocate SKU sequence — unexpected D1 response.');
	}
	return row.reserved;
}

export interface SkuParts {
	categoryCode: string;
	brandCode: string;
	modelCode: string;
	condition: Condition;
	yearReceived: number; // 4-digit
}

/**
 * Generate a fresh SKU, reserving the sequence number in the same call.
 * The returned string is canonical and ready to be persisted.
 */
export async function generateSku(db: D1Database, parts: SkuParts): Promise<string> {
	const yearYY = parts.yearReceived % 100;
	const seq = await allocateSequence(db, parts.categoryCode, yearYY);

	const brand = normaliseBrandCode(parts.brandCode);
	const model = normaliseModelCode(parts.modelCode);
	const yy = String(yearYY).padStart(2, '0');
	const seqStr = String(seq).padStart(4, '0');

	return `${parts.categoryCode}-${brand}-${model}-${parts.condition}-${yy}-${seqStr}`;
}
