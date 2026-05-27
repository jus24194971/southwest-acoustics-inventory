import type { RequestHandler } from './$types';
import { error } from '@sveltejs/kit';
import { getDB } from '$lib/server/db';
import { buildLabelsPdf, type LabelTemplateCode } from '$lib/server/labels';

/**
 * GET /api/labels/bin/<id>?copies=N&template=...
 *
 * Prints a label for one bin/drawer/cabinet — used by the "Print
 * label" button next to each row in the bin tree. The QR encodes a
 * link to /bins/<id> so scanning the label opens that bin's detail
 * page on a phone.
 *
 * Recursive CTE here so the printed path matches what the bin
 * picker shows ("GAR / Main Cabinet / Drawer 1 / A-12").
 */
export const GET: RequestHandler = async (event) => {
	const db = getDB(event);
	const id = parseInt(event.params.id, 10);
	if (!Number.isInteger(id)) throw error(404, 'Bad bin id');

	const copies = Math.max(1, parseInt(event.url.searchParams.get('copies') ?? '1', 10) || 1);
	const template = (event.url.searchParams.get('template') ?? 'LW_DURABLE_19x64') as LabelTemplateCode;

	const bin = await db
		.prepare(
			`WITH RECURSIVE bin_path(id, parent_bin_id, code, name, path) AS (
				SELECT b.id, b.parent_bin_id, b.code, b.name,
				       loc.code || ' / ' || b.code AS path
				FROM bin b
				JOIN location loc ON loc.id = b.location_id
				WHERE b.id = ? AND b.deleted_at IS NULL

				UNION ALL

				-- Walk up the tree gathering ancestors, prepending each
				-- code to the path. (UNION ALL with the parent as the
				-- recursive case.)
				SELECT parent.id, parent.parent_bin_id, parent.code, parent.name,
				       loc.code || ' / ' || parent.code || ' / ' ||
				         substr(bp.path, instr(bp.path, ' / ') + 3)
				FROM bin parent
				JOIN bin_path bp ON parent.id = bp.parent_bin_id
				JOIN location loc ON loc.id = parent.location_id
				WHERE parent.deleted_at IS NULL
			)
			SELECT code, name, path FROM bin_path WHERE parent_bin_id IS NULL`
		)
		.bind(id)
		.first<{ code: string; name: string | null; path: string }>();
	if (!bin) throw error(404, `Bin ${id} not found`);

	// Large-format templates (Primera LX-610) render the brand logo —
	// fetch it from the bundled asset. Small DYMO templates skip the
	// subrequest.
	let logoPng: Uint8Array | undefined;
	if (template.startsWith('PRIMERA_')) {
		try {
			const res = await event.fetch(`${event.url.origin}/southwest_logo.png`);
			if (res.ok) logoPng = new Uint8Array(await res.arrayBuffer());
		} catch {
			// fall through — renderer uses text wordmark
		}
	}

	const pdf = await buildLabelsPdf(
		[
			{
				kind: 'bin',
				code: bin.code,
				name: bin.name,
				path: bin.path,
				url: `${event.url.origin}/bins/${id}`
			}
		],
		{ template, copiesPerLabel: copies, logoPng }
	);

	return new Response(new Blob([pdf as unknown as ArrayBuffer], { type: 'application/pdf' }), {
		headers: {
			'content-type': 'application/pdf',
			'content-disposition': `inline; filename="bin-${bin.code}.pdf"`
		}
	});
};
