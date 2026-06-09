/**
 * Runtime-stored eBay credentials (D1-backed).
 *
 * The OAuth refresh token and the inventory-location key are minted
 * at request time (when Dad clicks Connect / Create location), so they
 * can't live in Pages secrets — those are write-only at deploy time.
 * They go in the `app_secret` K/V table instead (migration 0015).
 *
 * The eBay API client (ebay.ts) is pure-env: it reads
 * EBAY_REFRESH_TOKEN off the creds object you hand it. So the bridge
 * is `resolveEbayCreds(db, env)` — it reads the D1-stored values and
 * returns a creds object with EBAY_REFRESH_TOKEN populated (D1 first,
 * env fallback). Every eBay route calls this and passes the result to
 * the client functions instead of the raw env.
 */

import type { D1Database } from '@cloudflare/workers-types';

const KEY_REFRESH_TOKEN = 'ebay_refresh_token';
const KEY_REFRESH_EXPIRES = 'ebay_refresh_expires_at';
const KEY_ACCOUNT_LABEL = 'ebay_account_label';
const KEY_LOCATION = 'ebay_merchant_location_key';
const KEY_VERIFICATION_TOKEN = 'ebay_verification_token';
const KEY_RU_NAME = 'ebay_ru_name';
// Dad's eBay seller username (user id). Needed for the Browse-API
// listing scrape. We can't always read it from the Identity API (it
// needs an extra OAuth scope), so the reconcile page lets him type it
// once and we stash it here.
const KEY_SELLER_USERNAME = 'ebay_seller_username';

/** Raw env shape we read eBay config from (mirrors app.d.ts). */
export interface EbayEnv {
	EBAY_CLIENT_ID?: string;
	EBAY_CLIENT_SECRET?: string;
	EBAY_REFRESH_TOKEN?: string;
	EBAY_API_BASE?: string;
	EBAY_RU_NAME?: string;
	EBAY_MERCHANT_LOCATION_KEY?: string;
	EBAY_VERIFICATION_TOKEN?: string;
}

async function getSecret(db: D1Database, key: string): Promise<string | null> {
	const row = await db
		.prepare(`SELECT value FROM app_secret WHERE key = ?`)
		.bind(key)
		.first<{ value: string }>();
	return row?.value ?? null;
}

async function setSecret(db: D1Database, key: string, value: string): Promise<void> {
	await db
		.prepare(
			`INSERT INTO app_secret (key, value, updated_at)
			 VALUES (?, ?, datetime('now'))
			 ON CONFLICT (key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')`
		)
		.bind(key, value)
		.run();
}

export async function storeEbayTokens(
	db: D1Database,
	args: { refreshToken: string; refreshExpiresInSec: number; accountLabel?: string | null }
): Promise<void> {
	const expiresAt = new Date(Date.now() + args.refreshExpiresInSec * 1000).toISOString();
	await setSecret(db, KEY_REFRESH_TOKEN, args.refreshToken);
	await setSecret(db, KEY_REFRESH_EXPIRES, expiresAt);
	if (args.accountLabel) await setSecret(db, KEY_ACCOUNT_LABEL, args.accountLabel);
}

export async function storeEbayLocationKey(db: D1Database, key: string): Promise<void> {
	await setSecret(db, KEY_LOCATION, key);
}

export interface ResolvedEbayCreds extends EbayEnv {
	/** True when a refresh token exists (D1 or env). */
	hasRefreshToken: boolean;
	/** The connected account label, if known. */
	accountLabel: string | null;
	refreshExpiresAt: string | null;
	/** Dad's eBay seller username, when set (for the listing scrape). */
	ebaySellerUsername: string | null;
}

/**
 * Merge env config with D1-stored runtime secrets into a single creds
 * object for the eBay client. D1 values win over env (env is only a
 * fallback for local dev / manual override). The returned object is
 * shaped like EbayEnvCreds, so it drops straight into ebay.ts calls.
 */
export async function resolveEbayCreds(
	db: D1Database,
	env: EbayEnv | undefined
): Promise<ResolvedEbayCreds> {
	const e = env ?? {};
	const dbRefresh = await getSecret(db, KEY_REFRESH_TOKEN);
	const dbLocation = await getSecret(db, KEY_LOCATION);
	const accountLabel = await getSecret(db, KEY_ACCOUNT_LABEL);
	const refreshExpiresAt = await getSecret(db, KEY_REFRESH_EXPIRES);
	const dbRuName = await getSecret(db, KEY_RU_NAME);
	const ebaySellerUsername = await getSecret(db, KEY_SELLER_USERNAME);

	const refreshToken = dbRefresh ?? e.EBAY_REFRESH_TOKEN ?? undefined;
	const locationKey = dbLocation ?? e.EBAY_MERCHANT_LOCATION_KEY ?? undefined;
	// RuName: D1 wins over env. The env Pages secret was set via a
	// shell pipe that corrupts the value (trailing newline / encoding),
	// which makes the OAuth redirect_uri invalid; the D1 copy is set
	// via an exact SQL insert and is the trustworthy source.
	const ruName = dbRuName ?? e.EBAY_RU_NAME ?? undefined;

	return {
		...e,
		EBAY_REFRESH_TOKEN: refreshToken,
		EBAY_MERCHANT_LOCATION_KEY: locationKey,
		EBAY_RU_NAME: ruName,
		hasRefreshToken: !!refreshToken,
		accountLabel,
		refreshExpiresAt,
		ebaySellerUsername
	};
}

/** Store Dad's eBay seller username (used by the reconcile listing
 *  scrape). Trimmed; empty clears it. */
export async function setEbaySellerUsername(db: D1Database, username: string): Promise<void> {
	const v = username.trim();
	if (!v) {
		await db.prepare(`DELETE FROM app_secret WHERE key = ?`).bind(KEY_SELLER_USERNAME).run();
		return;
	}
	await db
		.prepare(
			`INSERT INTO app_secret (key, value, updated_at)
			 VALUES (?, ?, datetime('now'))
			 ON CONFLICT (key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')`
		)
		.bind(KEY_SELLER_USERNAME, v)
		.run();
}

/**
 * The marketplace-deletion-notification verification token. D1 is the
 * source of truth (set via an exact SQL insert — no shell-pipe newline
 * risk); env is a fallback. The notifications endpoint and the Settings
 * display both read through here so they always agree on the value
 * eBay must be given.
 */
export async function getEbayVerificationToken(
	db: D1Database,
	env: EbayEnv | undefined
): Promise<string | null> {
	const fromDb = await getSecret(db, KEY_VERIFICATION_TOKEN);
	return fromDb ?? env?.EBAY_VERIFICATION_TOKEN ?? null;
}

/** Forget the stored eBay connection (Disconnect button). */
export async function clearEbayTokens(db: D1Database): Promise<void> {
	await db
		.prepare(
			`DELETE FROM app_secret WHERE key IN (?, ?, ?)`
		)
		.bind(KEY_REFRESH_TOKEN, KEY_REFRESH_EXPIRES, KEY_ACCOUNT_LABEL)
		.run();
}
