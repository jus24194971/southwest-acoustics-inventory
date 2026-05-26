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
			};
			context: {
				waitUntil(promise: Promise<unknown>): void;
			};
			caches: CacheStorage & { default: Cache };
		}
	}
}

export {};
