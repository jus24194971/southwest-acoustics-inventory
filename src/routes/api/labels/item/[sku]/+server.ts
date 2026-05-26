import type { RequestHandler } from './$types';
import { error } from '@sveltejs/kit';
import { getDB } from '$lib/server/db';
import { buildLabelsPdf, type LabelTemplateCode } from '$lib/server/labels';

/**
 * GET /api/labels/item/<sku>?copies=N&template=LW_DURABLE_19x64
 *
 * Reprint label for an existing item. Used by the "Print label" button
 * on the item detail page, and by anything else that needs the same
 * SKU back as a PDF.
 */
export const GET: RequestHandler = async (event) => {
	const db = getDB(event);
	const sku = event.params.sku;
	const copies = Math.max(1, parseInt(event.url.searchParams.get('copies') ?? '1', 10) || 1);
	const template = (event.url.searchParams.get('template') ?? 'LW_DURABLE_19x64') as LabelTemplateCode;

	const item = await db
		.prepare(`SELECT sku, title FROM item WHERE sku = ? AND deleted_at IS NULL`)
		.bind(sku)
		.first<{ sku: string; title: string }>();
	if (!item) throw error(404, `No item with SKU ${sku}`);

	const pdf = await buildLabelsPdf(
		[
			{
				kind: 'item',
				sku: item.sku,
				title: item.title,
				url: `${event.url.origin}/items/${encodeURIComponent(item.sku)}`
			}
		],
		{ template, copiesPerLabel: copies }
	);

	return new Response(new Blob([pdf as unknown as ArrayBuffer], { type: 'application/pdf' }), {
		headers: {
			'content-type': 'application/pdf',
			'content-disposition': `inline; filename="${item.sku}.pdf"`
		}
	});
};
