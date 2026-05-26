/**
 * App-wide preferences, stored as TEXT key/value rows in the `preference`
 * table. Currently used for accessibility (font_scale, high_contrast)
 * but designed to take anything that needs cross-device persistence.
 *
 * Typed accessors keep callers away from string-juggling: `getFontScale()`
 * always returns one of the three valid values, defaulting to 'normal'
 * for forward-compatibility if the DB ever contains an unknown value.
 */

import type { D1Database } from '@cloudflare/workers-types';

export type FontScale = 'normal' | 'large' | 'xlarge';

export interface AppPreferences {
	font_scale: FontScale;
	high_contrast: boolean;
}

const DEFAULTS: AppPreferences = {
	font_scale: 'normal',
	high_contrast: false
};

/** Load every preference in one round-trip and project into a typed shape. */
export async function loadPreferences(db: D1Database): Promise<AppPreferences> {
	const { results } = await db
		.prepare(`SELECT key, value FROM preference`)
		.all<{ key: string; value: string | null }>();

	const map = new Map<string, string | null>();
	for (const row of results) map.set(row.key, row.value);

	return {
		font_scale: normaliseFontScale(map.get('font_scale')),
		high_contrast: map.get('high_contrast') === '1'
	};
}

export async function setPreference(
	db: D1Database,
	key: string,
	value: string
): Promise<void> {
	await db
		.prepare(
			`INSERT INTO preference (key, value)
			 VALUES (?, ?)
			 ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')`
		)
		.bind(key, value)
		.run();
}

function normaliseFontScale(raw: string | null | undefined): FontScale {
	if (raw === 'large' || raw === 'xlarge' || raw === 'normal') return raw;
	return DEFAULTS.font_scale;
}
