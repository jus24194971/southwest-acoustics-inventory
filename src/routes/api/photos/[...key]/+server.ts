import type { RequestHandler } from './$types';
import { error } from '@sveltejs/kit';

/**
 * GET /api/photos/<r2_key>
 *
 * Proxies an R2 object back to the browser. Used by <img src> on item
 * pages — the R2 bucket itself is private (no public domain), so the
 * only way to render photos is through this endpoint.
 *
 * Cloudflare Access already sits in front of every route on this
 * project, so this endpoint inherits the same email-allowlist gating
 * as the rest of the app. Photos are visible to Dad and Justin, no one
 * else.
 *
 * Caching: we set a 1-hour edge cache. Photos never mutate after
 * upload (a new photo gets a new R2 key), so the cache is safe.
 */
export const GET: RequestHandler = async (event) => {
	const r2 = event.platform?.env?.PHOTOS;
	if (!r2) throw error(500, 'R2 binding PHOTOS missing — check wrangler.toml.');

	const key = event.params.key;
	if (!key) throw error(404, 'No photo key.');

	const obj = await r2.get(key);
	if (!obj) throw error(404, `Photo not found: ${key}`);

	// Build headers from R2 metadata manually rather than via
	// obj.writeHttpMetadata(headers), because the Workers Headers type
	// (which writeHttpMetadata expects) doesn't structurally match
	// SvelteKit's standard-web Headers.
	const headers = new Headers();
	const contentType = obj.httpMetadata?.contentType ?? 'application/octet-stream';
	headers.set('content-type', contentType);
	headers.set('cache-control', 'private, max-age=3600');
	headers.set('etag', obj.httpEtag);

	// Body: read R2 fully into memory and hand off as ArrayBuffer rather
	// than streaming. Trades a bit of latency on first byte for clean
	// types and avoids a Workers/web stream-type mismatch.
	const buf = await obj.arrayBuffer();
	return new Response(buf, { headers });
};
