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
 *
 * The PDF renderer adapts to every label size (DYMO 19mm through
 * Primera 2"×3") and draws the SA monogram + QR + content
 * dynamically — no asset fetches needed.
 */
export const GET: RequestHandler = async (event) => {
	const db = getDB(event);
	const sku = event.params.sku;
	const copies = Math.max(1, parseInt(event.url.searchParams.get('copies') ?? '1', 10) || 1);
	const template = (event.url.searchParams.get('template') ?? 'LW_DURABLE_19x64') as LabelTemplateCode;

	const item = await db
		.prepare(
			`SELECT sku, title, description FROM item WHERE sku = ? AND deleted_at IS NULL`
		)
		.bind(sku)
		.first<{ sku: string; title: string; description: string | null }>();
	if (!item) throw error(404, `No item with SKU ${sku}`);

	const pdf = await buildLabelsPdf(
		[
			{
				kind: 'item',
				sku: item.sku,
				title: item.title,
				description: item.description,
				url: `${event.url.origin}/items/${encodeURIComponent(item.sku)}`
			}
		],
		{ template, copiesPerLabel: copies }
	);

	return new Response(new Blob([pdf as unknown as ArrayBuffer], { type: 'application/pdf' }), {
		headers: {
			'content-type': 'application/pdf',
			'content-disposition': `inline; filename="${item.sku}.pdf"`,
			// PDFs default to aggressive browser caching when no Cache-Control
			// header is present. That bites us every time the renderer
			// changes — a "reprint" returns the old cached PDF even though
			// the server would have generated something different. Force
			// fresh fetches so layout changes show up immediately.
			'cache-control': 'no-store, no-cache, must-revalidate',
			pragma: 'no-cache'
		}
	});
};
