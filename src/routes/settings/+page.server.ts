import type { Actions, PageServerLoad } from './$types';
import { fail, redirect } from '@sveltejs/kit';
import { getDB } from '$lib/server/db';
import { loadPreferences } from '$lib/server/preferences';
import { listProducts, SquarespaceError } from '$lib/server/squarespace';
import { checkConnection, createInventoryLocation, EbayError } from '$lib/server/ebay';
import {
	resolveEbayCreds,
	clearEbayTokens,
	storeEbayLocationKey,
	getEbayVerificationToken
} from '$lib/server/ebay_credentials';

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
	const [squarespace, anthropic, r2Status, d1Status] = await Promise.all([
		probeSquarespace(event.platform?.env?.SQUARESPACE_API_KEY),
		probeAnthropic(event.platform?.env?.ANTHROPIC_API_KEY),
		probeR2(event.platform?.env?.PHOTOS),
		probeD1(db)
	]);

	// eBay is richer than a one-line status — it has a Connect/Disconnect
	// lifecycle + a location setup step, so it gets its own structured
	// block rather than a row in the generic connections list.
	const ebay = await probeEbay(db, event.platform?.env);

	// Values the operator pastes into eBay's dev portal when registering
	// the marketplace-deletion notification. Surfaced here (behind Access)
	// with copy buttons so they don't have to be hunted down. The
	// endpoint is derived from the current origin so it matches whatever
	// domain you're browsing — same string eBay will hash against.
	const ebayNotify = {
		// Show the canonical registered URL (what the hash uses), not the
		// request-derived one, so the copy button always gives eBay the
		// exact value the endpoint hashes against.
		endpoint:
			event.platform?.env?.EBAY_NOTIFICATION_ENDPOINT ??
			'https://sw-acoustics-inventory.pages.dev/api/ebay/notifications',
		verificationToken: await getEbayVerificationToken(db, event.platform?.env)
	};

	return {
		preferences,
		connections: [squarespace, anthropic, r2Status, d1Status] as ConnectionStatus[],
		ebay,
		ebayNotify
	};
};

interface EbayStatus {
	appConfigured: boolean;
	ruNameConfigured: boolean;
	appTokenOk: boolean;
	userConnected: boolean;
	accountLabel: string | null;
	refreshExpiresAt: string | null;
	locationKey: string | null;
	error: string | null;
}

async function probeEbay(
	db: ReturnType<typeof getDB>,
	env: App.Platform['env'] | undefined
): Promise<EbayStatus> {
	const appConfigured = !!(env?.EBAY_CLIENT_ID && env?.EBAY_CLIENT_SECRET);
	// Resolve creds up front so the RuName check reflects the D1-stored
	// value (the env Pages secret is shell-pipe-corrupted and unreliable).
	const creds = await resolveEbayCreds(db, env);
	const ruNameConfigured = !!creds.EBAY_RU_NAME;
	if (!appConfigured) {
		return {
			appConfigured: false,
			ruNameConfigured,
			appTokenOk: false,
			userConnected: false,
			accountLabel: null,
			refreshExpiresAt: null,
			locationKey: null,
			error: null
		};
	}

	const conn = await checkConnection(creds);
	return {
		appConfigured,
		ruNameConfigured,
		appTokenOk: conn.app,
		userConnected: conn.user,
		accountLabel: creds.accountLabel,
		refreshExpiresAt: creds.refreshExpiresAt,
		locationKey: creds.EBAY_MERCHANT_LOCATION_KEY ?? null,
		error: conn.error ?? null
	};
}

async function probeAnthropic(apiKey: string | undefined): Promise<ConnectionStatus> {
	if (!apiKey) {
		return {
			name: 'Anthropic (AI descriptions)',
			state: 'missing',
			detail:
				'API key not set — run `wrangler pages secret put ANTHROPIC_API_KEY`. The "Suggest description" button on listings stays disabled without it.'
		};
	}
	// Key-shape sanity check — actually pinging Anthropic on every
	// settings page load would burn tokens for no reason.
	if (!apiKey.startsWith('sk-ant-')) {
		return {
			name: 'Anthropic (AI descriptions)',
			state: 'error',
			detail: 'Key is set but doesn\'t look like an Anthropic key (expected sk-ant-… prefix).'
		};
	}
	return {
		name: 'Anthropic (AI descriptions)',
		state: 'ok',
		detail: 'API key configured · used for AI-suggested product descriptions (Haiku 4.5)'
	};
}

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
	},

	// Forget the stored eBay connection. Doesn't revoke on eBay's side
	// (Dad can do that in his eBay account security settings) — just
	// drops our refresh token so the next Connect starts fresh.
	disconnectEbay: async (event) => {
		const db = getDB(event);
		await clearEbayTokens(db);
		throw redirect(303, '/settings?ebay=disconnected');
	},

	// Create (or ensure) the eBay inventory location every offer needs.
	// Collects a minimal address; eBay requires at least country +
	// postal code for shipping calculation.
	createEbayLocation: async (event) => {
		const db = getDB(event);
		const env = event.platform?.env;
		if (!env) return fail(500, { ebayError: 'platform env missing' });

		const creds = await resolveEbayCreds(db, env);
		if (!creds.hasRefreshToken) {
			return fail(400, {
				ebayError: 'Connect your eBay account first — creating a location needs the user token.'
			});
		}

		const form = await event.request.formData();
		const postalCode = (form.get('postal_code') ?? '').toString().trim();
		const country = (form.get('country') ?? 'US').toString().trim().toUpperCase();
		const addressLine1 = (form.get('address_line1') ?? '').toString().trim() || undefined;
		const city = (form.get('city') ?? '').toString().trim() || undefined;
		const stateOrProvince = (form.get('state') ?? '').toString().trim() || undefined;
		const name = (form.get('location_name') ?? 'Southwest Acoustics').toString().trim();

		if (!postalCode) {
			return fail(400, { ebayError: 'Postal code is required for the eBay location.' });
		}

		// Stable key so re-running just updates the same location.
		const key = 'sw-acoustics-main';
		try {
			await createInventoryLocation(creds, key, name, {
				addressLine1,
				city,
				stateOrProvince,
				postalCode,
				country
			});
			await storeEbayLocationKey(db, key);
			throw redirect(303, '/settings?ebay=location_created');
		} catch (err) {
			if (err && typeof err === 'object' && 'status' in err && 'location' in err) throw err;
			const message =
				err instanceof EbayError
					? `HTTP ${err.httpStatus} from eBay: ${err.body.slice(0, 300)}`
					: err instanceof Error
						? err.message
						: String(err);
			return fail(500, { ebayError: message });
		}
	}
};

