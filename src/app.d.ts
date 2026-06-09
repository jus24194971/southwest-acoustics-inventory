// See https://svelte.dev/docs/kit/types#app.d.ts
// for information about these interfaces
import type { D1Database, R2Bucket } from '@cloudflare/workers-types';

declare global {
	namespace App {
		// interface Error {}
		interface Locals {
			/** Populated by a server hook from the Cloudflare Access JWT.
			 *  Undefined when developing locally without Access in front of us. */
			userEmail?: string;
		}
		// interface PageData {}
		// interface PageState {}
		interface Platform {
			env: {
				/** D1 binding for the inventory database — see wrangler.toml. */
				DB: D1Database;
				/** R2 bucket for photos + label PDFs. */
				PHOTOS: R2Bucket;
				/** Squarespace Commerce API key. Set via `wrangler pages secret put
				 *  SQUARESPACE_API_KEY` for prod, and `.dev.vars` for local. */
				SQUARESPACE_API_KEY?: string;
				/** Anthropic API key for AI-generated product descriptions. Set
				 *  via `wrangler pages secret put ANTHROPIC_API_KEY`. */
				ANTHROPIC_API_KEY?: string;
				/** Reverb Marketplace API key (Personal Access Token). Set
				 *  via `wrangler pages secret put REVERB_API_KEY`. */
				REVERB_API_KEY?: string;
				/** eBay developer app credentials. Set via
				 *  `wrangler pages secret put EBAY_CLIENT_ID` etc. */
				EBAY_CLIENT_ID?: string;
				EBAY_CLIENT_SECRET?: string;
				/** Long-lived (18mo) refresh token minted via eBay's
				 *  authorization_code consent flow. Required to actually
				 *  push listings; without it, the editor saves drafts
				 *  but disables the Push button. */
				EBAY_REFRESH_TOKEN?: string;
				/** Optional eBay API base URL override — set to
				 *  `https://api.sandbox.ebay.com` to point at the
				 *  sandbox environment. Defaults to prod. */
				EBAY_API_BASE?: string;
				/** eBay merchant location key — references a warehouse.
				 *  Usually created via the in-app "Create location" flow
				 *  and stored in D1; this env var is a fallback override. */
				EBAY_MERCHANT_LOCATION_KEY?: string;
				/** eBay RuName — the redirect identifier registered in
				 *  the dev portal, used as redirect_uri in the OAuth flow. */
				EBAY_RU_NAME?: string;
				/** Self-chosen token for verifying eBay's marketplace
				 *  account-deletion notification challenge. Must match
				 *  what's entered in the eBay dev portal. D1 (app_secret
				 *  key `ebay_verification_token`) is the source of truth;
				 *  this env var is a fallback. */
				EBAY_VERIFICATION_TOKEN?: string;
				/** Optional override for the notification endpoint URL used
				 *  in the challenge hash. Defaults to the hardcoded
				 *  canonical URL. Set if you move to a custom domain. */
				EBAY_NOTIFICATION_ENDPOINT?: string;
				/** Shared secret gating GET /api/listings/heartbeat so an
				 *  external scheduler can trigger the periodic listing
				 *  health check. Unset = heartbeat disabled. */
				LISTING_HEARTBEAT_KEY?: string;
			};
			context: {
				waitUntil(promise: Promise<unknown>): void;
			};
			caches: CacheStorage & { default: Cache };
		}
	}
}

export {};
