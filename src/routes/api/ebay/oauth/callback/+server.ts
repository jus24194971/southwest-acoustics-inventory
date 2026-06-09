import type { RequestHandler } from './$types';
import { error, redirect } from '@sveltejs/kit';
import { getDB } from '$lib/server/db';
import { exchangeCodeForTokens, getAccountUsername } from '$lib/server/ebay';
import { storeEbayTokens, resolveEbayCreds } from '$lib/server/ebay_credentials';

/**
 * GET /api/ebay/oauth/callback?code=...&state=...
 *
 * eBay redirects the operator's browser here after consent. We:
 *   1. Verify `state` matches the cookie set in /start (CSRF guard).
 *   2. Exchange the `code` for access + refresh tokens.
 *   3. Persist the refresh token in D1 (app_secret).
 *   4. Best-effort fetch the account username for the Settings display.
 *   5. Redirect to /settings with a status flag.
 *
 * On decline, eBay sends `?error=access_denied` instead of a code.
 *
 * NOTE: this endpoint is hit by the operator's BROWSER (which carries
 * the Cloudflare Access session), so it works behind Access. The
 * separate notifications endpoint, hit server-to-server by eBay,
 * needs an Access bypass — different story.
 */
export const GET: RequestHandler = async (event) => {
	const env = event.platform?.env;
	if (!env) throw error(500, 'platform env missing');

	const url = event.url;
	const declined = url.searchParams.get('error');
	if (declined) {
		throw redirect(303, `/settings?ebay=declined`);
	}

	const code = url.searchParams.get('code');
	const state = url.searchParams.get('state');
	const expectedState = event.cookies.get('ebay_oauth_state');

	// Clear the one-shot state cookie regardless of outcome.
	event.cookies.delete('ebay_oauth_state', { path: '/' });

	if (!code) {
		throw redirect(303, `/settings?ebay=error&reason=${encodeURIComponent('no code returned')}`);
	}
	if (!state || !expectedState || state !== expectedState) {
		throw redirect(
			303,
			`/settings?ebay=error&reason=${encodeURIComponent('state mismatch — try Connect again')}`
		);
	}

	try {
		const db = getDB(event);
		// Resolve creds so the RuName used in the code exchange matches
		// the (clean, D1-sourced) one used to build the consent URL —
		// redirect_uri must be identical across both calls.
		const creds = await resolveEbayCreds(db, env);
		const tokens = await exchangeCodeForTokens(creds, code);

		// Build creds with the fresh refresh token so the username
		// lookup (which needs a user token) works immediately.
		const credsWithToken = { ...creds, EBAY_REFRESH_TOKEN: tokens.refresh_token };
		const username = await getAccountUsername(credsWithToken);

		await storeEbayTokens(db, {
			refreshToken: tokens.refresh_token,
			refreshExpiresInSec: tokens.refresh_token_expires_in,
			accountLabel: username
		});

		throw redirect(303, `/settings?ebay=connected`);
	} catch (err) {
		// Let SvelteKit redirects bubble.
		if (err && typeof err === 'object' && 'status' in err && 'location' in err) throw err;
		const reason = err instanceof Error ? err.message : String(err);
		throw redirect(303, `/settings?ebay=error&reason=${encodeURIComponent(reason.slice(0, 200))}`);
	}
};
