import type { RequestHandler } from './$types';
import { error, redirect } from '@sveltejs/kit';
import { getDB } from '$lib/server/db';
import { buildConsentUrl } from '$lib/server/ebay';
import { resolveEbayCreds } from '$lib/server/ebay_credentials';

/**
 * GET /api/ebay/oauth/start
 *
 * Kicks off the eBay consent flow. Builds the authorize URL and 302s
 * the browser to eBay. A random `state` is stashed in a short-lived
 * cookie and echoed by eBay to the callback, where we compare them as
 * a CSRF guard.
 *
 * The whole app sits behind Cloudflare Access, so only an authenticated
 * operator can even reach this — but the state check is cheap belt-and-
 * suspenders against a stray cross-site redirect.
 */
export const GET: RequestHandler = async (event) => {
	const env = event.platform?.env;
	const db = getDB(event);
	// Resolve creds so EBAY_RU_NAME comes from D1 (clean) rather than the
	// shell-pipe-corrupted Pages secret.
	const creds = await resolveEbayCreds(db, env);
	if (!creds.EBAY_CLIENT_ID || !creds.EBAY_RU_NAME) {
		throw error(
			400,
			'eBay is not configured for OAuth — need EBAY_CLIENT_ID (Pages secret) and the RuName (stored in the app).'
		);
	}

	// Random opaque state. crypto.randomUUID is available in Workers.
	const state = crypto.randomUUID();
	event.cookies.set('ebay_oauth_state', state, {
		path: '/',
		httpOnly: true,
		secure: true,
		sameSite: 'lax',
		maxAge: 600 // 10 minutes — plenty for the consent round-trip
	});

	const consentUrl = buildConsentUrl(creds, state);
	throw redirect(302, consentUrl);
};
