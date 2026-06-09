/**
 * Resolve an item's 5 attribute slots into (label, contextKey, value)
 * triples with the codes turned into friendly values.
 *
 * The item table stores attribute slots as opaque codes (attr_1..attr_5),
 * the category defines what each slot MEANS (attr_N_label,
 * attr_N_context_key), and the attribute_value table maps
 * (context_key, code) → friendly label. A 'UNQ' code means "one-off,
 * see the free-text unique description" stored in attr_N_unique_desc.
 *
 * This is the shared resolution the eBay aspect mapper, AI prompts,
 * and any future export all need — pulled out so the SELECT + the
 * code→label join logic lives in exactly one place.
 */

import type { D1Database } from '@cloudflare/workers-types';
import type { ResolvedAttribute } from './ebay_aspect_mapper';

interface ItemAttrRow {
	attr_1: string;
	attr_2: string;
	attr_3: string;
	attr_4: string;
	attr_5: string;
	attr_1_unique_desc: string | null;
	attr_2_unique_desc: string | null;
	attr_3_unique_desc: string | null;
	attr_4_unique_desc: string | null;
	attr_5_unique_desc: string | null;
	cat_attr_1_label: string | null;
	cat_attr_2_label: string | null;
	cat_attr_3_label: string | null;
	cat_attr_4_label: string | null;
	cat_attr_5_label: string | null;
	cat_attr_1_context_key: string | null;
	cat_attr_2_context_key: string | null;
	cat_attr_3_context_key: string | null;
	cat_attr_4_context_key: string | null;
	cat_attr_5_context_key: string | null;
}

/**
 * Resolve attributes for one item id. Returns only the slots that are
 * actually set (label present + code not the "unset" sentinel 'XXX').
 * Returns [] for an item with no attributes.
 */
export async function resolveItemAttributes(
	db: D1Database,
	itemId: number
): Promise<ResolvedAttribute[]> {
	const row = await db
		.prepare(
			`SELECT i.attr_1, i.attr_2, i.attr_3, i.attr_4, i.attr_5,
			        i.attr_1_unique_desc, i.attr_2_unique_desc, i.attr_3_unique_desc,
			        i.attr_4_unique_desc, i.attr_5_unique_desc,
			        c.attr_1_label AS cat_attr_1_label, c.attr_2_label AS cat_attr_2_label,
			        c.attr_3_label AS cat_attr_3_label, c.attr_4_label AS cat_attr_4_label,
			        c.attr_5_label AS cat_attr_5_label,
			        c.attr_1_context_key AS cat_attr_1_context_key,
			        c.attr_2_context_key AS cat_attr_2_context_key,
			        c.attr_3_context_key AS cat_attr_3_context_key,
			        c.attr_4_context_key AS cat_attr_4_context_key,
			        c.attr_5_context_key AS cat_attr_5_context_key
			 FROM item i
			 JOIN category c ON c.id = i.category_id
			 WHERE i.id = ?`
		)
		.bind(itemId)
		.first<ItemAttrRow>();
	if (!row) return [];

	// Build the (context_key, code) → friendly label lookup once.
	const { results: attrValues } = await db
		.prepare(`SELECT context_key, code, label FROM attribute_value WHERE is_active = 1`)
		.all<{ context_key: string; code: string; label: string }>();
	const valueLabel = new Map<string, string>();
	for (const v of attrValues) valueLabel.set(`${v.context_key}::${v.code}`, v.label);

	const out: ResolvedAttribute[] = [];
	for (let i = 1; i <= 5; i++) {
		const label = row[`cat_attr_${i}_label` as keyof ItemAttrRow] as string | null;
		const code = row[`attr_${i}` as keyof ItemAttrRow] as string;
		const uniqueDesc = row[`attr_${i}_unique_desc` as keyof ItemAttrRow] as string | null;
		const contextKey = row[`cat_attr_${i}_context_key` as keyof ItemAttrRow] as string | null;
		// Skip unlabeled or unset ('XXX' is the "no value" sentinel) slots.
		if (!label || code === 'XXX' || !code) continue;

		let value: string;
		if (code === 'UNQ' && uniqueDesc) {
			value = uniqueDesc;
		} else {
			const friendly = contextKey ? valueLabel.get(`${contextKey}::${code}`) : null;
			value = friendly ?? code;
		}
		out.push({ label, contextKey, value });
	}
	return out;
}
