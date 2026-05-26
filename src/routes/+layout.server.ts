import type { LayoutServerLoad } from './$types';
import { loadPreferences } from '$lib/server/preferences';
import { getDB } from '$lib/server/db';

/**
 * Layout-level load: runs on every page. Reads accessibility prefs so
 * the body classes can be set on the very first render — no flash of
 * unstyled / unscaled content after hydration.
 *
 * Fails open: if the DB binding isn't available (dev without wrangler),
 * we fall back to defaults instead of throwing the whole app.
 */
export const load: LayoutServerLoad = async (event) => {
	try {
		const db = getDB(event);
		const preferences = await loadPreferences(db);
		return { preferences };
	} catch {
		return {
			preferences: {
				font_scale: 'normal' as const,
				high_contrast: false
			}
		};
	}
};
