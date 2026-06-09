import type { RequestHandler } from './$types';
import { json, text } from '@sveltejs/kit';
import { getDB } from '$lib/server/db';
import { getEbayVerificationToken } from '$lib/server/ebay_credentials';

/**
 * The exact endpoint URL registered in eBay's dev portal. The challenge
 * hash MUST use this verbatim, and it MUST match what eBay has on file.
 *
 * Hardcoded (not derived from event.url) on purpose: Cloudflare's edge
 * can hand the Worker a request URL with a different protocol/origin
 * than the public one (TLS terminates at the edge), which would
 * silently produce a hash eBay can't reproduce → validation fails with
 * no obvious cause. If the registered URL ever changes (custom domain),
 * update this constant or set EBAY_NOTIFICATION_ENDPOINT to override.
 */
const CANONICAL_ENDPOINT = 'https://sw-acoustics-inventory.pages.dev/api/ebay/notifications';

/**
 * eBay Marketplace Account Deletion / Closure notification endpoint.
 *
 * eBay requires every PRODUCTION app to either subscribe to these
 * notifications with a verified endpoint, or risk having the keyset
 * throttled. There are two interactions:
 *
 * 1. **Validation (GET ?challenge_code=...)** — when you save the
 *    endpoint in the dev portal (and periodically after), eBay calls
 *    it with a challenge code. We must respond with the SHA-256 hash
 *    of (challengeCode + verificationToken + endpointUrl), hex-encoded,
 *    as JSON `{ "challengeResponse": "<hex>" }`.
 *
 * 2. **Notification (POST)** — when an eBay user deletes their account,
 *    eBay POSTs a payload here. We acknowledge with 200. We don't store
 *    eBay buyer PII, so there's nothing to purge — but we log it for
 *    the record and return 200 so eBay considers it delivered.
 *
 * IMPORTANT — Cloudflare Access: this endpoint is hit by eBay's
 * SERVERS (no browser session), so it must be EXEMPT from Cloudflare
 * Access or eBay will get the Access login page instead of our handler.
 * Add a bypass policy for path `/api/ebay/notifications` in
 * Zero Trust → Access → Applications. (The OAuth callback is browser-
 * driven and does NOT need this.)
 *
 * The `verificationToken` is a self-chosen string (stored as the
 * EBAY_VERIFICATION_TOKEN Pages secret) that must match what's entered
 * in the eBay dev portal alongside this endpoint URL.
 */

/** Hex-encode an ArrayBuffer. */
function toHex(buf: ArrayBuffer): string {
	return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export const GET: RequestHandler = async (event) => {
	const challengeCode = event.url.searchParams.get('challenge_code');
	if (!challengeCode) {
		// Not a challenge — just a health check / stray GET.
		return text('eBay notification endpoint is live.', { status: 200 });
	}

	const db = getDB(event);
	const verificationToken = await getEbayVerificationToken(db, event.platform?.env);
	if (!verificationToken) {
		return text('eBay verification token not configured.', { status: 500 });
	}

	// Canonical endpoint URL (override-able), NOT derived from the
	// request — see the constant's comment for why.
	const endpointUrl = event.platform?.env?.EBAY_NOTIFICATION_ENDPOINT ?? CANONICAL_ENDPOINT;

	// eBay's spec: SHA-256 over the concatenation, in this exact order.
	const data = new TextEncoder().encode(challengeCode + verificationToken + endpointUrl);
	const digest = await crypto.subtle.digest('SHA-256', data);
	const challengeResponse = toHex(digest);

	// Must be application/json with this exact key.
	return json({ challengeResponse });
};

export const POST: RequestHandler = async (event) => {
	// Account-deletion notification. We don't persist eBay buyer PII,
	// so there's nothing to erase — acknowledge and move on. Log the
	// notification id for traceability if present.
	try {
		const body = (await event.request.json()) as {
			notification?: { notificationId?: string; data?: { username?: string } };
		};
		console.log('eBay account-deletion notification', {
			notificationId: body?.notification?.notificationId ?? null
		});
	} catch {
		// Some pings have empty/non-JSON bodies — still ack.
	}
	// eBay just needs a 2xx to mark it delivered.
	return new Response(null, { status: 200 });
};
