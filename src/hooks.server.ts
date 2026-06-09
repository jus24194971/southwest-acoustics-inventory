import type { Handle } from '@sveltejs/kit';

/**
 * Capture the Cloudflare Access identity on every request.
 *
 * Once an Access policy sits in front of the app (it does), Cloudflare
 * injects the authenticated user's email as a request header on every
 * forwarded request — regardless of WHICH login method they used
 * (one-time PIN today, Google OAuth once you add it as an identity
 * provider). We read it into `event.locals.userEmail` so the rest of
 * the app can:
 *   - stamp the real person on movements (actor), not "system"
 *   - show a "signed in as …" indicator
 *   - gate actions by user later (role logic) if wanted
 *
 * Security note: we trust the header because the app is only reachable
 * THROUGH Access — Cloudflare strips any client-supplied copy and sets
 * its own. If we ever expose a path outside Access, switch to verifying
 * the signed `Cf-Access-Jwt-Assertion` JWT instead of the plain header.
 */
export const handle: Handle = async ({ event, resolve }) => {
	const email = event.request.headers.get('cf-access-authenticated-user-email');
	if (email) event.locals.userEmail = email;
	return resolve(event);
};
