/**
 * Thin helper around the D1 binding.
 *
 * Why this exists rather than calling `platform.env.DB` everywhere:
 *   - In `vite dev` (without `wrangler pages dev`), there's no platform
 *     object at all. We want a clear, single error message that points
 *     the developer at the right command instead of a "cannot read
 *     properties of undefined" stack trace.
 *   - Centralising the binding lookup gives us one place to swap to a
 *     mock in tests later.
 */

import type { D1Database } from '@cloudflare/workers-types';
import type { RequestEvent } from '@sveltejs/kit';
import { error } from '@sveltejs/kit';

export function getDB(event: RequestEvent): D1Database {
	const db = event.platform?.env?.DB;
	if (!db) {
		throw error(
			500,
			'No D1 binding. Run `npm run preview` (which uses `wrangler pages dev`) ' +
				'instead of `npm run dev` — vite alone does not provide Cloudflare bindings.'
		);
	}
	return db;
}
