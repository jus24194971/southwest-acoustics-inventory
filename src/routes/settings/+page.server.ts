import type { Actions, PageServerLoad } from './$types';
import { fail, redirect } from '@sveltejs/kit';
import { getDB } from '$lib/server/db';
import { loadPreferences } from '$lib/server/preferences';
import { listProducts, SquarespaceError } from '$lib/server/squarespace';

/**
 * Settings page — accessibility prefs + connection status.
 *
 * Two distinct concerns side-by-side:
 *   - Accessibility (font scale, high contrast) lives in the
 *     `preference` table and is editable here.
 *   - Connections (Squarespace API key, R2 bucket, D1 database)
 *     are env / binding state. We probe each one and report status.
 *     Setting them lives in `wrangler pages secret put` / wrangler.toml,
 *     not in the UI — this page just shows whether they're working.
 */

interface ConnectionStatus {
	name: string;
	state: 'ok' | 'missing' | 'error';
	detail: string;
}

export const load: PageServerLoad = async (event) => {
	const db = getDB(event);
	const preferences = await loadPreferences(db);

	// Probe each external service we depend on. These run in parallel.
	const [squarespace, r2Status, d1Status] = await Promise.all([
		probeSquarespace(event.platform?.env?.SQUARESPACE_API_KEY),
		probeR2(event.platform?.env?.PHOTOS),
		probeD1(db)
	]);

	return {
		preferences,
		connections: [squarespace, r2Status, d1Status] as ConnectionStatus[]
	};
};

async function probeSquarespace(apiKey: string | undefined): Promise<ConnectionStatus> {
	if (!apiKey) {
		return {
			name: 'Squarespace',
			state: 'missing',
			detail: 'API key not set — run `wrangler pages secret put SQUARESPACE_API_KEY`.'
		};
	}
	try {
		// Cheap probe: list page 1 (we don't read it; we just confirm
		// the API accepts the credential).
		const page = await listProducts(apiKey);
		return {
			name: 'Squarespace',
			state: 'ok',
			detail: `Connected · ${page.products?.length ?? 0} products on page 1${
				page.pagination?.hasNextPage ? ' (more pages exist)' : ''
			}`
		};
	} catch (err) {
		if (err instanceof SquarespaceError) {
			return {
				name: 'Squarespace',
				state: 'error',
				detail: `HTTP ${err.httpStatus} — check API key scopes (needs Products read).`
			};
		}
		return {
			name: 'Squarespace',
			state: 'error',
			detail: err instanceof Error ? err.message : String(err)
		};
	}
}

async function probeR2(r2: unknown): Promise<ConnectionStatus> {
	if (!r2) {
		return {
			name: 'R2 (photo storage)',
			state: 'missing',
			detail: 'PHOTOS binding missing — check wrangler.toml.'
		};
	}
	return {
		name: 'R2 (photo storage)',
		state: 'ok',
		detail: 'sw-acoustics-photos bucket bound · photos serve via /api/photos/...'
	};
}

async function probeD1(db: ReturnType<typeof getDB>): Promise<ConnectionStatus> {
	try {
		const row = await db
			.prepare(`SELECT COUNT(*) AS n FROM item`)
			.first<{ n: number }>();
		return {
			name: 'D1 (inventory database)',
			state: 'ok',
			detail: `Connected · ${row?.n ?? 0} items in the catalogue`
		};
	} catch (err) {
		return {
			name: 'D1 (inventory database)',
			state: 'error',
			detail: err instanceof Error ? err.message : String(err)
		};
	}
}

export const actions: Actions = {
	updatePreferences: async (event) => {
		const db = getDB(event);
		const form = await event.request.formData();

		const fontScale = (form.get('font_scale') ?? 'normal').toString();
		const highContrast = form.get('high_contrast') === 'on' ? '1' : '0';

		if (fontScale !== 'normal' && fontScale !== 'large' && fontScale !== 'xlarge') {
			return fail(400, { prefError: 'Invalid font scale.' });
		}

		await db.batch([
			db
				.prepare(
					`INSERT INTO preference (key, value) VALUES ('font_scale', ?)
					 ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')`
				)
				.bind(fontScale),
			db
				.prepare(
					`INSERT INTO preference (key, value) VALUES ('high_contrast', ?)
					 ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')`
				)
				.bind(highContrast)
		]);

		throw redirect(303, '/settings?saved=1');
	}
};

