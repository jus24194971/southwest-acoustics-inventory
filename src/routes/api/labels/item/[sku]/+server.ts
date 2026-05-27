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
 * For large-format templates (Primera LX-610) we also fetch the brand
 * logo from /southwest_logo.png and the item description so the richer
 * layout has the content it needs. Smaller DYMO templates ignore both.
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

	// Fetch the logo lazily — only the LX-610 template uses it, and
	// we don't want to incur a subrequest for every DYMO reprint.
	const logoPng = template.startsWith('PRIMERA_')
		? await fetchLogo(event.fetch, event.url.origin)
		: undefined;

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
		{ template, copiesPerLabel: copies, logoPng }
	);

	return new Response(new Blob([pdf as unknown as ArrayBuffer], { type: 'application/pdf' }), {
		headers: {
			'content-type': 'application/pdf',
			'content-disposition': `inline; filename="${item.sku}.pdf"`
		}
	});
};

async function fetchLogo(
	fetchFn: typeof fetch,
	origin: string
): Promise<Uint8Array | undefined> {
	try {
		const res = await fetchFn(`${origin}/southwest_logo.png`);
		if (!res.ok) return undefined;
		const buf = await res.arrayBuffer();
		return new Uint8Array(buf);
	} catch {
		return undefined;
	}
}
