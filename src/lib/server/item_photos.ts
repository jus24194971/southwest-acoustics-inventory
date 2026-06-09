/**
 * Shared item-photo upload: validate browser-uploaded files, store the
 * accepted ones in R2, and append item_photo rows. Used by both the item
 * detail page and the Squarespace listing editor so "add photos" behaves
 * identically wherever Dad does it.
 *
 * Soft rules mirror the original item-page action: common web image types
 * only (HEIC excluded — browsers can't render it), 15 MB per file. Returns
 * what was added + a human-readable reason for anything skipped, so the
 * caller can surface a flash message.
 */
import type { D1Database, R2Bucket } from '@cloudflare/workers-types';

const ALLOWED: Record<string, string> = {
	'image/jpeg': 'jpg',
	'image/jpg': 'jpg',
	'image/png': 'png',
	'image/webp': 'webp',
	'image/gif': 'gif'
};
const MAX_BYTES = 15 * 1024 * 1024; // 15 MB per photo

/** Max files accepted in a single upload — keeps us under the Worker's
 *  per-request subrequest budget (one R2 put each, plus a batched insert). */
export const MAX_PHOTOS_PER_UPLOAD = 20;

export interface PhotoUploadResult {
	added: number;
	rejected: string[];
}

export async function saveUploadedItemPhotos(
	db: D1Database,
	r2: R2Bucket,
	itemId: number,
	files: File[]
): Promise<PhotoUploadResult> {
	const rejected: string[] = [];
	const accepted: Array<{ file: File; key: string }> = [];

	for (const file of files) {
		const ct = (file.type || '').toLowerCase();
		const ext = ALLOWED[ct];
		if (!ext) {
			rejected.push(`${file.name}: unsupported type (${ct || 'unknown'})`);
			continue;
		}
		if (file.size > MAX_BYTES) {
			rejected.push(`${file.name}: ${(file.size / (1024 * 1024)).toFixed(1)}MB > 15MB limit`);
			continue;
		}
		// crypto.randomUUID() is available on Cloudflare Workers.
		accepted.push({ file, key: `items/${itemId}/${crypto.randomUUID()}.${ext}` });
	}

	if (accepted.length === 0) return { added: 0, rejected };

	// Append after any photos already on the item (preserve order + primary).
	const maxRow = await db
		.prepare(
			`SELECT COALESCE(MAX(position), -1) AS p
			 FROM item_photo WHERE item_id = ? AND deleted_at IS NULL`
		)
		.bind(itemId)
		.first<{ p: number }>();
	let nextPos = (maxRow?.p ?? -1) + 1;

	// Sequential R2 puts — each is a subrequest; the MAX_PHOTOS_PER_UPLOAD
	// ceiling keeps us comfortably under the cap.
	for (const a of accepted) {
		const bytes = await a.file.arrayBuffer();
		await r2.put(a.key, bytes, { httpMetadata: { contentType: a.file.type } });
	}

	// One batched insert — fewer round-trips than per-file.
	const inserts = accepted.map((a) =>
		db
			.prepare(
				`INSERT INTO item_photo
					(item_id, r2_key, position, alt_text, bytes, content_type)
				 VALUES (?, ?, ?, ?, ?, ?)`
			)
			.bind(itemId, a.key, nextPos++, null, a.file.size, a.file.type)
	);
	await db.batch(inserts);

	return { added: accepted.length, rejected };
}
