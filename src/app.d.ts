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
			};
			context: {
				waitUntil(promise: Promise<unknown>): void;
			};
			caches: CacheStorage & { default: Cache };
		}
	}
}

export {};
