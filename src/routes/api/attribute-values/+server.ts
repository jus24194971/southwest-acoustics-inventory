import type { RequestHandler } from './$types';
import { json, error } from '@sveltejs/kit';
import { getDB } from '$lib/server/db';

/**
 * GET /api/attribute-values?context=<key>
 *   → { values: [{ id, context_key, code, label, sort_order }, ...] }
 *
 * POST /api/attribute-values  body: { context_key, code, label, notes? }
 *   → 201 { value: {...} }
 *
 * Powers the "Black (BLK)" dropdowns in the item forms — list endpoint
 * for the initial render, create endpoint for the inline "+ Add new"
 * affordance so Dad can grow the vocabulary as he encounters new
 * finishes / configs.
 */

interface ValueRow {
	id: number;
	context_key: string;
	code: string;
	label: string;
	sort_order: number;
}

export const GET: RequestHandler = async (event) => {
	const context = event.url.searchParams.get('context');
	if (!context) throw error(400, 'context query param required');

	const db = getDB(event);
	const { results } = await db
		.prepare(
			`SELECT id, context_key, code, label, sort_order
			 FROM attribute_value
			 WHERE context_key = ? AND is_active = 1
			 ORDER BY sort_order, label`
		)
		.bind(context)
		.all<ValueRow>();

	return json({ values: results });
};

export const POST: RequestHandler = async (event) => {
	let body: Record<string, unknown>;
	try {
		body = (await event.request.json()) as Record<string, unknown>;
	} catch {
		throw error(400, 'invalid JSON body');
	}

	const contextKey = String(body.context_key ?? '').trim();
	const codeRaw = String(body.code ?? '')
		.trim()
		.toUpperCase()
		.replace(/[^A-Z0-9]/g, '');
	const label = String(body.label ?? '').trim();
	const notes = body.notes ? String(body.notes).trim() || null : null;

	if (!contextKey) throw error(400, 'context_key required');
	if (codeRaw.length === 0 || codeRaw.length > 3) {
		throw error(400, 'code must be 1-3 alphanumeric characters');
	}
	if (!label) throw error(400, 'label required');

	// Pad to exactly 3 chars so the SKU embedding stays uniform.
	const code = codeRaw.padEnd(3, 'X');

	const db = getDB(event);
	try {
		const row = await db
			.prepare(
				`INSERT INTO attribute_value (context_key, code, label, notes, sort_order)
				 VALUES (?, ?, ?, ?, 500)
				 RETURNING id, context_key, code, label, sort_order`
			)
			.bind(contextKey, code, label, notes)
			.first<ValueRow>();

		return json({ value: row }, { status: 201 });
	} catch (err) {
		const msg = err instanceof Error ? err.message : String(err);
		if (msg.includes('UNIQUE')) {
			throw error(409, `${code} already exists for ${contextKey}`);
		}
		throw error(500, msg);
	}
};
